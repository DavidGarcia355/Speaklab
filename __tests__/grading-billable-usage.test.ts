import { describe, expect, it } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { DirectAudioOutputError, type DirectAudioGrade } from "@/lib/grading/audio";
import {
  runDirectAudioGradingPipeline,
  type AudioGrader,
} from "@/lib/grading/audio-pipeline";
import { getGradingConfig, type GradingConfig } from "@/lib/grading/config";
import type {
  GradingInput,
  GradingProvider,
  GradingResult,
  ProviderGradeResponse,
  TokenUsage,
} from "@/lib/grading/contracts";
import {
  runGradingPipeline,
  type GradingPipelineStore,
} from "@/lib/grading/pipeline";

const EMPTY_USAGE: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
const ANSWER = "The response includes exact supporting evidence.";

const gradingInput: GradingInput = {
  submissionId: "submission-billable-usage",
  teacherEmail: "teacher@example.com",
  assignment: {
    id: "assignment-billable-usage",
    type: "short_answer",
    question: "Explain the claim.",
    instructions: "Use supporting details.",
    maximumScore: 10,
    version: "assignment-v1",
    rubric: null,
  },
  studentAnswer: ANSWER,
};

const audioGradingInput: Omit<GradingInput, "studentAnswer"> = {
  submissionId: gradingInput.submissionId,
  teacherEmail: gradingInput.teacherEmail,
  assignment: gradingInput.assignment,
};

function testConfig(): GradingConfig {
  return {
    ...getGradingConfig(),
    enabled: true,
    defaultModel: { provider: "mock", model: "cheap-model" },
    escalationModel: { provider: "openai", model: "escalation-model" },
    confidenceThreshold: 0.8,
    scoreDisagreementThreshold: 2,
    formattingRetries: 1,
    audioModel: { provider: "google", model: "audio-cheap-model" },
    audioEscalationModel: { provider: "google", model: "audio-escalation-model" },
  };
}

function result(confidence = 0.95): GradingResult {
  return {
    score: 8,
    maximum_score: 10,
    confidence,
    rubric_results: [
      {
        criterion_id: "overall",
        points_awarded: 8,
        points_possible: 10,
        evidence: "supporting evidence",
        reason: "The answer supports its claim.",
      },
    ],
    feedback: "The answer is supported by relevant evidence.",
    requires_teacher_review: false,
    review_reason: null,
  };
}

function response(output: unknown, usage: TokenUsage): ProviderGradeResponse {
  return { output, usage, latencyMs: 1 };
}

function queuedProvider(id: string, responses: ProviderGradeResponse[]): GradingProvider {
  let index = 0;
  return {
    id,
    async grade() {
      const next = responses[index++];
      if (!next) throw new Error(`Unexpected ${id} provider call.`);
      return next;
    },
  };
}

function addUsage(...items: TokenUsage[]): TokenUsage {
  return items.reduce(
    (total, item) => ({
      inputTokens: total.inputTokens + item.inputTokens,
      cachedInputTokens: total.cachedInputTokens + item.cachedInputTokens,
      outputTokens: total.outputTokens + item.outputTokens,
    }),
    { ...EMPTY_USAGE },
  );
}

function memoryStore() {
  let cached: { result: unknown; provider: string; model: string } | null = null;
  const store: GradingPipelineStore = {
    async findCached() {
      return cached;
    },
    async saveCached(entry) {
      cached = { result: entry.result, provider: entry.provider, model: entry.model };
    },
    async recordRequest() {},
  };
  return store;
}

function directGrade(usage: TokenUsage, confidence = 0.95): DirectAudioGrade {
  return {
    transcript: ANSWER,
    detectedLanguage: "en",
    transcriptQuality: "good",
    durationSeconds: 42,
    result: result(confidence),
    usage,
    audioInputTokens: 100,
    textInputTokens: Math.max(0, usage.inputTokens - 100),
    latencyMs: 1,
  };
}

describe("grading billable usage", () => {
  it("bills only the schema-valid formatting retry while preserving aggregate usage", async () => {
    const failedUsage = { inputTokens: 10, cachedInputTokens: 1, outputTokens: 2 };
    const selectedUsage = { inputTokens: 20, cachedInputTokens: 3, outputTokens: 4 };
    const providers = new Map<string, GradingProvider>([
      [
        "mock",
        queuedProvider("mock", [
          response("invalid", failedUsage),
          response(result(), selectedUsage),
        ]),
      ],
    ]);

    const outcome = await runGradingPipeline(gradingInput, {
      config: testConfig(),
      providers,
      bypassPersistence: true,
      forceAi: true,
    });

    expect(outcome.billableUsage).toEqual(selectedUsage);
    expect(outcome.usage).toEqual(addUsage(failedUsage, selectedUsage));
    expect(outcome.retries).toBe(1);
  });

  it("retries a structured result cut off by the provider token limit", async () => {
    const selectedUsage = { inputTokens: 20, cachedInputTokens: 3, outputTokens: 4 };
    let calls = 0;
    const provider: GradingProvider = {
      id: "mock",
      async grade() {
        calls += 1;
        if (calls === 1) {
          throw new NoObjectGeneratedError({
            response: { id: "cut-off-response", timestamp: new Date(), modelId: "cheap-model" },
            usage: {
              inputTokens: 100,
              inputTokenDetails: {
                noCacheTokens: 100,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
              outputTokens: 200,
              outputTokenDetails: { textTokens: 100, reasoningTokens: 100 },
              totalTokens: 300,
            },
            finishReason: "length",
            text: '{"score":8',
          });
        }
        return response(result(), selectedUsage);
      },
    };

    const outcome = await runGradingPipeline(gradingInput, {
      config: testConfig(),
      providers: new Map([["mock", provider]]),
      bypassPersistence: true,
      forceAi: true,
    });

    expect(calls).toBe(2);
    expect(outcome.retries).toBe(1);
    expect(outcome.result.score).toBe(8);
    expect(outcome.billableUsage).toEqual(selectedUsage);
    expect(outcome.usage).toEqual({ inputTokens: 120, cachedInputTokens: 3, outputTokens: 204 });
  });

  it("bills only the selected escalation call", async () => {
    const cheapUsage = { inputTokens: 30, cachedInputTokens: 2, outputTokens: 5 };
    const escalationUsage = { inputTokens: 40, cachedInputTokens: 4, outputTokens: 7 };
    const providers = new Map<string, GradingProvider>([
      ["mock", queuedProvider("mock", [response(result(0.3), cheapUsage)])],
      ["openai", queuedProvider("openai", [response(result(), escalationUsage)])],
    ]);

    const outcome = await runGradingPipeline(gradingInput, {
      config: testConfig(),
      providers,
      bypassPersistence: true,
      forceAi: true,
    });

    expect(outcome.billableUsage).toEqual(escalationUsage);
    expect(outcome.usage).toEqual(addUsage(cheapUsage, escalationUsage));
    expect(outcome.escalated).toBe(true);
  });

  it("returns empty billable usage for cache, deterministic, and terminal failure results", async () => {
    const selectedUsage = { inputTokens: 25, cachedInputTokens: 0, outputTokens: 6 };
    const store = memoryStore();
    const provider = queuedProvider("mock", [response(result(), selectedUsage)]);
    const providers = new Map<string, GradingProvider>([["mock", provider]]);
    const config = testConfig();

    const first = await runGradingPipeline(gradingInput, {
      config,
      providers,
      store,
      forceAi: true,
    });
    const cached = await runGradingPipeline(gradingInput, {
      config,
      providers,
      store,
      forceAi: true,
    });
    expect(first.billableUsage).toEqual(selectedUsage);
    expect(cached.source).toBe("cache");
    expect(cached.billableUsage).toEqual(EMPTY_USAGE);
    expect(cached.usage).toEqual(EMPTY_USAGE);

    const deterministic = await runGradingPipeline(
      {
        ...gradingInput,
        assignment: {
          ...gradingInput.assignment,
          gradingRules: {
            rules: [
              {
                id: "overall",
                type: "exact_match",
                expected: ANSWER,
                pointsPossible: 10,
              },
            ],
          },
        },
      },
      { config, bypassPersistence: true },
    );
    expect(deterministic.source).toBe("deterministic");
    expect(deterministic.billableUsage).toEqual(EMPTY_USAGE);

    const invalidOne = { inputTokens: 11, cachedInputTokens: 0, outputTokens: 1 };
    const invalidTwo = { inputTokens: 12, cachedInputTokens: 0, outputTokens: 2 };
    const invalidThree = { inputTokens: 13, cachedInputTokens: 0, outputTokens: 3 };
    const failingProviders = new Map<string, GradingProvider>([
      [
        "mock",
        queuedProvider("mock", [
          response("invalid-one", invalidOne),
          response("invalid-two", invalidTwo),
        ]),
      ],
      ["openai", queuedProvider("openai", [response("invalid-three", invalidThree)])],
    ]);
    const failed = await runGradingPipeline(gradingInput, {
      config,
      providers: failingProviders,
      bypassPersistence: true,
      forceAi: true,
    });
    expect(failed.failureCode).toBe("no_valid_provider_result");
    expect(failed.billableUsage).toEqual(EMPTY_USAGE);
    expect(failed.usage).toEqual(addUsage(invalidOne, invalidTwo, invalidThree));
  });

  it("uses only the selected direct-audio retry or escalation usage", async () => {
    const retryFailureUsage = { inputTokens: 50, cachedInputTokens: 5, outputTokens: 8 };
    const retrySelectedUsage = { inputTokens: 60, cachedInputTokens: 6, outputTokens: 9 };
    let retryCalls = 0;
    const retryGrader: AudioGrader = async () => {
      retryCalls += 1;
      if (retryCalls === 1) {
        throw new DirectAudioOutputError({
          message: "Invalid provider output.",
          usage: retryFailureUsage,
          audioInputTokens: 100,
          latencyMs: 1,
        });
      }
      return directGrade(retrySelectedUsage);
    };
    const config = testConfig();
    const retried = await runDirectAudioGradingPipeline({
      config,
      gradingInput: audioGradingInput,
      buffer: Buffer.from("retry audio"),
      contentType: "audio/wav",
      upload: "inline",
      initialModel: config.audioModel,
      bypassPersistence: true,
      audioGrader: retryGrader,
    });
    expect(retried.billableUsage).toEqual(retrySelectedUsage);
    expect(retried.billableAudioInputTokens).toBe(100);
    expect(retried.usage).toEqual(addUsage(retryFailureUsage, retrySelectedUsage));

    const cheapUsage = { inputTokens: 70, cachedInputTokens: 7, outputTokens: 10 };
    const escalationUsage = { inputTokens: 80, cachedInputTokens: 8, outputTokens: 11 };
    const escalationGrader: AudioGrader = async ({ model }) =>
      model.model === config.audioModel.model
        ? directGrade(cheapUsage, 0.3)
        : directGrade(escalationUsage);
    const escalated = await runDirectAudioGradingPipeline({
      config,
      gradingInput: audioGradingInput,
      buffer: Buffer.from("escalation audio"),
      contentType: "audio/wav",
      upload: "inline",
      initialModel: config.audioModel,
      bypassPersistence: true,
      audioGrader: escalationGrader,
    });
    expect(escalated.billableUsage).toEqual(escalationUsage);
    expect(escalated.billableAudioInputTokens).toBe(100);
    expect(escalated.usage).toEqual(addUsage(cheapUsage, escalationUsage));
    expect(escalated.escalated).toBe(true);
  });

  it("returns empty billable usage for a direct-audio cache hit", async () => {
    const selectedUsage = { inputTokens: 90, cachedInputTokens: 9, outputTokens: 12 };
    const store = memoryStore();
    let calls = 0;
    const grader: AudioGrader = async () => {
      calls += 1;
      return directGrade(selectedUsage);
    };
    const config = testConfig();
    const request = {
      config,
      gradingInput: audioGradingInput,
      buffer: Buffer.from("cached audio"),
      contentType: "audio/wav",
      upload: "inline" as const,
      initialModel: config.audioModel,
      store,
      audioGrader: grader,
    };

    const first = await runDirectAudioGradingPipeline(request);
    const cached = await runDirectAudioGradingPipeline(request);

    expect(first.billableUsage).toEqual(selectedUsage);
    expect(cached.source).toBe("cache");
    expect(cached.billableUsage).toEqual(EMPTY_USAGE);
    expect(cached.billableAudioInputTokens).toBe(0);
    expect(cached.usage).toEqual(EMPTY_USAGE);
    expect(calls).toBe(1);
  });
});

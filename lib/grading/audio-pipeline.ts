import { createHash } from "node:crypto";
import {
  DirectAudioOutputError,
  gradeAudioWithGemini,
  type DirectAudioGrade,
} from "@/lib/grading/audio";
import type { GradingConfig, GradingModelConfig } from "@/lib/grading/config";
import type { GradingInput, GradingResult, TokenUsage } from "@/lib/grading/contracts";
import { canonicalStringify } from "@/lib/grading/hash";
import { detectPromptInjection } from "@/lib/grading/normalize";
import {
  estimateAudioTokenCostMicrousd,
  modelPricingTableFromConfig,
  resolveModelPricing,
} from "@/lib/grading/pricing";
import {
  validateResultForAssignment,
  type GradingPipelineStore,
  type GradingRequestRecord,
} from "@/lib/grading/pipeline";
import { validateGradingResult } from "@/lib/grading/schema";

const EMPTY_USAGE: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

export type AudioGrader = typeof gradeAudioWithGemini;

export type DirectAudioPipelineResult = {
  result: GradingResult;
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: "good" | "uncertain" | "poor";
  durationSeconds: number;
  source: "cache" | "direct_audio" | "escalation" | "teacher_review";
  provider: string;
  model: string;
  /** Usage from the final schema-valid provider call selected for the result. */
  billableUsage: TokenUsage;
  /** Audio tokens reported for the final selected provider call only. */
  billableAudioInputTokens: number;
  /** Aggregate provider usage across retries and escalation attempts. */
  usage: TokenUsage;
  audioInputTokens: number;
  estimatedCostMicrousd: number;
  costKnown: boolean;
  latencyMs: number;
  retries: number;
  escalated: boolean;
  escalationReason: string;
  schemaFailures: number;
  cacheHit: boolean;
  cacheKey: string;
  calls: GradingRequestRecord[];
};

type CachedAudioGrade = {
  kind: "direct-audio-v1";
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: "good" | "uncertain" | "poor";
  durationSeconds: number;
  result: GradingResult;
};

function audioCacheKey(input: {
  buffer: Buffer;
  contentType: string;
  gradingInput: Omit<GradingInput, "studentAnswer">;
  promptVersion: string;
  model: GradingModelConfig;
  escalationModel: GradingModelConfig;
}) {
  const metadata = canonicalStringify({
    contentType: input.contentType,
    assignmentVersion: input.gradingInput.assignment.version,
    rubricVersion: input.gradingInput.assignment.rubric?.version ?? "none",
    promptVersion: input.promptVersion,
    model: input.model,
    escalationModel: input.escalationModel,
    schemaVersion: "direct-audio-v1",
  });
  return createHash("sha256").update(metadata, "utf8").update(input.buffer).digest("hex");
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

function requireReview(result: GradingResult, reason: string): GradingResult {
  return {
    ...result,
    requires_teacher_review: true,
    review_reason: [result.review_reason, reason].filter(Boolean).join(" ").slice(0, 300),
  };
}

function parseCachedAudio(value: unknown, source: Omit<GradingInput, "studentAnswer">) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CachedAudioGrade>;
  if (
    candidate.kind !== "direct-audio-v1" ||
    typeof candidate.transcript !== "string" ||
    typeof candidate.detectedLanguage !== "string" ||
    !["good", "uncertain", "poor"].includes(candidate.transcriptQuality ?? "") ||
    typeof candidate.durationSeconds !== "number"
  ) {
    return null;
  }
  try {
    const gradingInput: GradingInput = { ...source, studentAnswer: candidate.transcript };
    const result = validateResultForAssignment(
      validateGradingResult(candidate.result, candidate.transcript),
      gradingInput
    );
    return { ...candidate, result } as CachedAudioGrade;
  } catch {
    return null;
  }
}

function recordForCall(input: {
  gradingInput: Omit<GradingInput, "studentAnswer">;
  stage: GradingRequestRecord["stage"];
  model: GradingModelConfig;
  grade?: DirectAudioGrade;
  error?: unknown;
  retries: number;
  escalated: boolean;
  escalationReason: string;
  config: GradingConfig;
  startedAt: number;
}): GradingRequestRecord & { audioInputTokens: number } {
  const outputError = input.error instanceof DirectAudioOutputError ? input.error : undefined;
  const usage = input.grade?.usage ?? outputError?.usage ?? EMPTY_USAGE;
  const audioInputTokens = input.grade?.audioInputTokens ?? outputError?.audioInputTokens ?? 0;
  const pricing = resolveModelPricing(
    modelPricingTableFromConfig(input.config.pricingJson),
    input.model
  );
  const estimatedCostMicrousd = pricing
    ? estimateAudioTokenCostMicrousd(usage, Math.min(audioInputTokens, usage.inputTokens), pricing)
        .totalMicrousd
    : 0;
  return {
    submissionId: input.gradingInput.submissionId,
    teacherEmail: input.gradingInput.teacherEmail,
    stage: input.stage,
    provider: input.model.provider,
    model: input.model.model,
    providerRequestId: input.grade?.providerRequestId ?? outputError?.providerRequestId,
    status: input.grade ? "completed" : "failed",
    usage,
    latencyMs:
      input.grade?.latencyMs ?? outputError?.latencyMs ?? Math.max(0, Date.now() - input.startedAt),
    retries: input.retries,
    escalated: input.escalated,
    escalationReason: input.escalationReason,
    estimatedCostMicrousd,
    costKnown: Boolean(pricing),
    promptVersion: input.gradingInput.promptVersion ?? input.config.promptVersion,
    errorCode: outputError ? "invalid_provider_output" : input.error ? "provider_error" : undefined,
    audioInputTokens,
  };
}

/** Direct Gemini audio path with bounded schema retry, escalation, cache, and accounting. */
export async function runDirectAudioGradingPipeline(input: {
  config: GradingConfig;
  gradingInput: Omit<GradingInput, "studentAnswer">;
  buffer: Buffer;
  contentType: string;
  upload: "inline" | "files_api";
  initialModel: GradingModelConfig;
  startsEscalated?: boolean;
  routingReasons?: string[];
  store?: GradingPipelineStore;
  bypassPersistence?: boolean;
  audioGrader?: AudioGrader;
  now?: number;
}): Promise<DirectAudioPipelineResult> {
  const now = input.now ?? Date.now();
  const promptVersion = input.gradingInput.promptVersion ?? input.config.promptVersion;
  const store = input.bypassPersistence ? undefined : input.store;
  const cacheKey = audioCacheKey({
    buffer: input.buffer,
    contentType: input.contentType,
    gradingInput: input.gradingInput,
    promptVersion,
    model: input.initialModel,
    escalationModel: input.config.audioEscalationModel,
  });

  if (store && input.gradingInput.submissionId && input.gradingInput.teacherEmail) {
    const cached = await store.findCached({
      cacheKey,
      teacherEmail: input.gradingInput.teacherEmail,
      now,
    });
    const parsed = cached ? parseCachedAudio(cached.result, input.gradingInput) : null;
    if (parsed) {
      return {
        result: parsed.result,
        transcript: parsed.transcript,
        detectedLanguage: parsed.detectedLanguage,
        transcriptQuality: parsed.transcriptQuality,
        durationSeconds: parsed.durationSeconds,
        source: "cache",
        provider: cached!.provider,
        model: cached!.model,
        billableUsage: EMPTY_USAGE,
        billableAudioInputTokens: 0,
        usage: EMPTY_USAGE,
        audioInputTokens: 0,
        estimatedCostMicrousd: 0,
        costKnown: true,
        latencyMs: 0,
        retries: 0,
        escalated: false,
        escalationReason: "",
        schemaFailures: 0,
        cacheHit: true,
        cacheKey,
        calls: [],
      };
    }
  }

  const grader = input.audioGrader ?? gradeAudioWithGemini;
  const calls: Array<GradingRequestRecord & { audioInputTokens: number }> = [];
  let retries = 0;
  let schemaFailures = 0;
  let escalated = Boolean(input.startsEscalated);
  let escalationReason = (input.routingReasons ?? []).join(",");

  const call = async (
    model: GradingModelConfig,
    stage: GradingRequestRecord["stage"],
    retryCount: number,
    isEscalated: boolean,
    reason: string
  ) => {
    if (store && input.gradingInput.teacherEmail) {
      await store.assertProviderCallAllowed?.({
        teacherEmail: input.gradingInput.teacherEmail,
        stage,
        config: input.config,
        now,
      });
    }
    const startedAt = Date.now();
    let grade: DirectAudioGrade | undefined;
    let error: unknown;
    try {
      grade = await grader({
        config: input.config,
        model,
        assignment: input.gradingInput.assignment,
        promptVersion,
        buffer: input.buffer,
        contentType: input.contentType,
        upload: input.upload,
      });
      validateResultForAssignment(
        grade.result,
        { ...input.gradingInput, studentAnswer: grade.transcript }
      );
    } catch (caught) {
      error = caught;
      grade = undefined;
    }
    const record = recordForCall({
      gradingInput: input.gradingInput,
      stage,
      model,
      grade,
      error,
      retries: retryCount,
      escalated: isEscalated,
      escalationReason: reason,
      config: input.config,
      startedAt,
    });
    calls.push(record);
    await store?.recordRequest(record);
    if (error instanceof DirectAudioOutputError) schemaFailures += 1;
    return { grade, error };
  };

  let first = await call(
    input.initialModel,
    input.startsEscalated ? "escalation" : "cheap",
    0,
    Boolean(input.startsEscalated),
    escalationReason
  );
  if (
    !first.grade &&
    first.error instanceof DirectAudioOutputError &&
    !input.startsEscalated &&
    input.config.formattingRetries > 0
  ) {
    retries = 1;
    first = await call(input.initialModel, "format_retry", 1, false, "invalid_provider_output");
  }

  let selected = first.grade;
  let selectedModel = input.initialModel;
  let source: DirectAudioPipelineResult["source"] = input.startsEscalated
    ? "escalation"
    : "direct_audio";
  const injection = selected ? detectPromptInjection(selected.transcript) : { detected: false, signals: [] };
  const escalationReasons = [
    ...(!selected ? ["direct_audio_model_failed"] : []),
    ...(selected && selected.result.confidence < input.config.confidenceThreshold
      ? ["low_confidence"]
      : []),
    ...(selected?.result.requires_teacher_review ? ["model_requested_teacher_review"] : []),
    ...(injection.detected ? ["prompt_injection_detected"] : []),
  ];

  if (!input.startsEscalated && escalationReasons.length > 0) {
    escalationReason = [...new Set(escalationReasons)].join(",");
    let allowed = true;
    if (store && input.gradingInput.teacherEmail) {
      allowed = (await store.canEscalate?.({
        teacherEmail: input.gradingInput.teacherEmail,
        config: input.config,
        now,
      })) ?? true;
    }
    if (allowed) {
      escalated = true;
      const second = await call(
        input.config.audioEscalationModel,
        "escalation",
        0,
        true,
        escalationReason
      );
      if (second.grade) {
        if (
          selected &&
          Math.abs(selected.result.score - second.grade.result.score) >
            input.config.scoreDisagreementThreshold
        ) {
          second.grade.result = requireReview(
            second.grade.result,
            "The audio grading models materially disagreed."
          );
          source = "teacher_review";
          escalationReason = `${escalationReason},model_disagreement`;
        } else {
          source = "escalation";
        }
        selected = second.grade;
        selectedModel = input.config.audioEscalationModel;
      } else if (selected) {
        selected.result = requireReview(selected.result, "Audio verification failed; teacher review is required.");
        source = "teacher_review";
      }
    } else if (selected) {
      selected.result = requireReview(
        selected.result,
        "Escalation budget/rate limit reached; teacher review is required."
      );
      source = "teacher_review";
      escalationReason = `${escalationReason},escalation_rate_limit`;
    }
  }

  if (!selected) throw new Error("Direct Gemini audio grading did not return a valid result.");
  const finalInjection = detectPromptInjection(selected.transcript);
  if (finalInjection.detected) {
    selected.result = requireReview(
      selected.result,
      `Possible prompt injection detected (${finalInjection.signals.join(", ")}).`
    );
    source = "teacher_review";
  }
  if (selected.result.confidence < input.config.confidenceThreshold) {
    selected.result = requireReview(
      selected.result,
      "Confidence remains below the configured threshold."
    );
    source = "teacher_review";
  }

  const persisted: CachedAudioGrade = {
    kind: "direct-audio-v1",
    transcript: selected.transcript,
    detectedLanguage: selected.detectedLanguage,
    transcriptQuality: selected.transcriptQuality,
    durationSeconds: selected.durationSeconds,
    result: selected.result,
  };
  if (store && input.gradingInput.submissionId && input.gradingInput.teacherEmail) {
    await store.saveCached({
      cacheKey,
      submissionId: input.gradingInput.submissionId,
      teacherEmail: input.gradingInput.teacherEmail,
      result: persisted,
      provider: selectedModel.provider,
      model: selectedModel.model,
      promptVersion,
      now,
      expiresAt: now + input.config.cacheTtlDays * 86_400_000,
    });
  }

  return {
    result: selected.result,
    transcript: selected.transcript,
    detectedLanguage: selected.detectedLanguage,
    transcriptQuality: selected.transcriptQuality,
    durationSeconds: selected.durationSeconds,
    source,
    provider: selectedModel.provider,
    model: selectedModel.model,
    billableUsage: selected.usage,
    billableAudioInputTokens: selected.audioInputTokens,
    usage: calls.reduce((total, item) => addUsage(total, item.usage), EMPTY_USAGE),
    audioInputTokens: calls.reduce((total, item) => total + item.audioInputTokens, 0),
    estimatedCostMicrousd: calls.reduce(
      (total, item) => total + item.estimatedCostMicrousd,
      0
    ),
    costKnown: calls.every((item) => item.costKnown),
    latencyMs: calls.reduce((total, item) => total + item.latencyMs, 0),
    retries,
    escalated,
    escalationReason,
    schemaFailures,
    cacheHit: false,
    cacheKey,
    calls,
  };
}

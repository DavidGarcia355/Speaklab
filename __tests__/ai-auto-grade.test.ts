import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@/lib/ai/config";
import type { SubmissionForAiGradeRow } from "@/lib/db";
import type { DirectAudioPipelineResult } from "@/lib/grading/audio-pipeline";
import type { GradingConfig } from "@/lib/grading/config";
import type { GradingResult } from "@/lib/grading/contracts";
import type { GradingPipelineResult } from "@/lib/grading/pipeline";

const mocks = vi.hoisted(() => {
  const store = {
    findCached: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    saveCached: vi.fn<(...args: unknown[]) => Promise<void>>(),
    recordRequest: vi.fn<(...args: unknown[]) => Promise<void>>(),
    assertProviderCallAllowed: vi.fn<(...args: unknown[]) => Promise<void>>(),
    canEscalate: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  };

  return {
    finalizeAiGradeDelivery: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    markAiGradingAttemptNotApplicable: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    withholdAiGradingAttemptResult: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    createAiGradingAttempt: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    hasAudioTooLongFailure: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    fetchAuthorizedAudioBuffer: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    toPublicAiError: vi.fn<(...args: unknown[]) => unknown>(),
    transcribeAudio: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    runDirectAudioGradingPipeline: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    getGradingConfig: vi.fn<() => unknown>(),
    runGradingPipeline: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    estimateTranscriptionCostMicrousd: vi.fn<(...args: unknown[]) => unknown>(),
    routeAudioGrading: vi.fn<(...args: unknown[]) => unknown>(),
    createDatabaseGradingStore: vi.fn<() => unknown>(),
    recordDeliveredAiUsageSafely: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    store,
  };
});

vi.mock("@/lib/db", () => ({
  finalizeAiGradeDelivery: mocks.finalizeAiGradeDelivery,
  markAiGradingAttemptNotApplicable: mocks.markAiGradingAttemptNotApplicable,
  withholdAiGradingAttemptResult: mocks.withholdAiGradingAttemptResult,
  createAiGradingAttempt: mocks.createAiGradingAttempt,
  hasAudioTooLongFailure: mocks.hasAudioTooLongFailure,
}));
vi.mock("@/lib/billing", () => ({
  recordDeliveredAiUsageSafely: mocks.recordDeliveredAiUsageSafely,
}));
vi.mock("@/lib/ai/audio", () => ({
  fetchAuthorizedAudioBuffer: mocks.fetchAuthorizedAudioBuffer,
}));
vi.mock("@/lib/ai/errors", () => ({ toPublicAiError: mocks.toPublicAiError }));
vi.mock("@/lib/ai/providers", () => ({ transcribeAudio: mocks.transcribeAudio }));
vi.mock("@/lib/grading/audio-pipeline", () => ({
  runDirectAudioGradingPipeline: mocks.runDirectAudioGradingPipeline,
}));
vi.mock("@/lib/grading/config", () => ({ getGradingConfig: mocks.getGradingConfig }));
vi.mock("@/lib/grading/pipeline", () => ({ runGradingPipeline: mocks.runGradingPipeline }));
vi.mock("@/lib/grading/pricing", () => ({
  estimateTranscriptionCostMicrousd: mocks.estimateTranscriptionCostMicrousd,
}));
vi.mock("@/lib/grading/routing", () => ({ routeAudioGrading: mocks.routeAudioGrading }));
vi.mock("@/lib/grading/store", () => ({
  createDatabaseGradingStore: mocks.createDatabaseGradingStore,
}));

import { gradeOneSubmission } from "@/lib/ai/grade-one";
import { gradingResultToLegacySuggestion } from "@/lib/grading/legacy-adapter";

const aiConfig: AiConfig = {
  enabled: true,
  bulkEnabled: true,
  isDev: true,
  transcriptionProvider: "openai",
  gradingProvider: "mock",
  transcriptionModel: "whisper-1",
  gradingModel: "mock-cheap",
  accessMode: "paid",
  studentDataApproved: true,
  teacherDenylist: new Set(),
  ollamaBaseUrl: "http://127.0.0.1:11434",
  maxAudioSeconds: 300,
  maxGenerationsPerSubmission: 5,
  cooldownSeconds: 0,
  dailyTeacherLimit: 100,
  dailyGlobalLimit: 1_000,
  monthlyBudgetUsd: 100,
  reservedCostUsdPerGeneration: 0.01,
  providerTimeoutMs: 1_000,
  providerMaxRetries: 1,
  gradingMaxOutputTokens: 1_000,
  failureMode: "",
};

const gradingConfig: GradingConfig = {
  enabled: true,
  isDev: true,
  defaultModel: { provider: "mock", model: "mock-cheap" },
  escalationModel: { provider: "mock", model: "mock-escalation" },
  confidenceThreshold: 0.8,
  escalationRateLimit: 0.1,
  unusuallyLongAnswerChars: 5_000,
  scoreDisagreementThreshold: 2,
  maxOutputTokens: 1_000,
  formattingRetries: 1,
  providerTimeoutMs: 1_000,
  providerMaxRetries: 1,
  promptVersion: "test-prompt-v1",
  cacheTtlDays: 30,
  recordRetentionDays: 90,
  dailyTeacherRequestLimit: 100,
  monthlyTeacherRequestLimit: 1_000,
  monthlyTeacherCostLimitUsd: 100,
  monthlyCostTargetUsd: 100,
  transcriptionUsdPerMinute: 0.006,
  pricingJson: "",
  studentDataApproved: true,
  audioStrategy: "auto",
  audioModel: { provider: "google", model: "gemini-audio" },
  audioEscalationModel: { provider: "google", model: "gemini-audio-escalation" },
  audioEscalationSeconds: 120,
  audioMaxOutputTokens: 1_000,
  experimentalGeminiWebm: false,
  deferredBatchEnabled: false,
};

function submission(overrides: Partial<SubmissionForAiGradeRow> = {}): SubmissionForAiGradeRow {
  return {
    submissionId: "submission-1",
    assignmentId: "assignment-1",
    assignmentTitle: "Oral response",
    audioBlobUrl: "private/audio/submission-1.wav",
    description: "Explain the claim.",
    instructions: "Support the claim with evidence.",
    rubric: {
      title: "Response rubric",
      criteria: [
        {
          id: "content",
          name: "Content",
          description: "Explains the claim.",
          maxPoints: 5,
        },
        {
          id: "evidence",
          name: "Evidence",
          description: "Uses relevant evidence.",
          maxPoints: 5,
        },
      ],
    },
    maxPoints: 10,
    finalGrade: null,
    finalFeedback: "",
    ...overrides,
  };
}

function providerResult(overrides: Partial<GradingResult> = {}): GradingResult {
  return {
    score: 7.4,
    maximum_score: 10,
    confidence: 0.93,
    rubric_results: [
      {
        criterion_id: "content",
        points_awarded: 3.6,
        points_possible: 5,
        evidence: "explains the claim",
        reason: "The claim is explained clearly.",
      },
      {
        criterion_id: "evidence",
        points_awarded: 3.8,
        points_possible: 5,
        evidence: "supporting evidence",
        reason: "The answer includes relevant evidence.",
      },
    ],
    feedback: "Clear explanation; make the evidence more specific.",
    requires_teacher_review: false,
    review_reason: null,
    ...overrides,
  };
}

function directResult(result = providerResult()): DirectAudioPipelineResult {
  return {
    result,
    transcript: "The answer explains the claim with supporting evidence.",
    detectedLanguage: "en",
    transcriptQuality: "good",
    durationSeconds: 30,
    source: "direct_audio",
    provider: "google",
    model: "gemini-audio",
    billableUsage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 25 },
    billableAudioInputTokens: 960,
    usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 25 },
    audioInputTokens: 80,
    estimatedCostMicrousd: 20,
    costKnown: true,
    latencyMs: 5,
    retries: 0,
    escalated: false,
    escalationReason: "",
    schemaFailures: 0,
    cacheHit: false,
    cacheKey: "direct-cache-key",
    calls: [],
  };
}

function textResult(
  result = providerResult(),
  overrides: Partial<GradingPipelineResult> = {},
): GradingPipelineResult {
  return {
    result,
    source: "cheap_ai",
    provider: "mock",
    model: "mock-cheap",
    billableUsage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20 },
    usage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20 },
    estimatedCostMicrousd: 10,
    costKnown: true,
    latencyMs: 4,
    retries: 0,
    escalated: false,
    escalationReason: "",
    schemaFailures: 0,
    cacheHit: false,
    cacheKey: "text-cache-key",
    promptVersion: "test-prompt-v1",
    calls: [],
    ...overrides,
  };
}

const expectedRubricScores = [
  {
    criterionId: "content",
    criterionName: "Content",
    maxPoints: 5,
    awarded: 4,
  },
  {
    criterionId: "evidence",
    criterionName: "Evidence",
    maxPoints: 5,
    awarded: 4,
  },
];

function expectAppliedWholePointGrade() {
  expect(mocks.finalizeAiGradeDelivery).toHaveBeenCalledOnce();
  expect(mocks.finalizeAiGradeDelivery).toHaveBeenCalledWith({
    attemptId: "attempt-1",
    ownerEmail: "teacher@example.com",
    priceBookId: "habla-teacher-ai-usd-v2",
    billingCandidate: true,
    allowUnmeteredAccess: false,
  });
}

describe("automatic AI grade persistence", () => {
  beforeEach(() => {
    mocks.getGradingConfig.mockReturnValue(gradingConfig);
    mocks.createDatabaseGradingStore.mockReturnValue(mocks.store);
    mocks.hasAudioTooLongFailure.mockResolvedValue(false);
    mocks.fetchAuthorizedAudioBuffer.mockResolvedValue({
      buffer: Buffer.from("test audio"),
      contentType: "audio/wav",
      storageMode: "private-blob",
    });
    mocks.transcribeAudio.mockResolvedValue({
      transcript: "The answer explains the claim with supporting evidence.",
      detectedLanguage: "en",
      quality: "good",
      durationSeconds: 30,
    });
    mocks.estimateTranscriptionCostMicrousd.mockReturnValue({
      totalMicrousd: 5,
      costKnown: true,
    });
    mocks.finalizeAiGradeDelivery.mockImplementation(async (input) => ({
      status: "applied",
      billingRequired: Boolean((input as { billingCandidate?: boolean }).billingCandidate),
    }));
    mocks.markAiGradingAttemptNotApplicable.mockReset();
    mocks.markAiGradingAttemptNotApplicable.mockResolvedValue(true);
    mocks.withholdAiGradingAttemptResult.mockReset();
    mocks.withholdAiGradingAttemptResult.mockResolvedValue(true);
    mocks.recordDeliveredAiUsageSafely.mockResolvedValue({ status: "disabled", usage: null });
    mocks.createAiGradingAttempt.mockImplementation(async (input) => ({
      id: "attempt-1",
      createdAt: 1,
      completedAt: 1,
      ...(input as Record<string, unknown>),
    }));
    mocks.toPublicAiError.mockReturnValue({ code: "internal_error", message: "AI grading failed." });
    mocks.store.findCached.mockResolvedValue(null);
    mocks.store.saveCached.mockResolvedValue(undefined);
    mocks.store.recordRequest.mockResolvedValue(undefined);
    mocks.store.assertProviderCallAllowed.mockResolvedValue(undefined);
    mocks.store.canEscalate.mockResolvedValue(true);
  });

  it("converts provider totals and rubric awards to the app's whole-point scale", () => {
    const rubricSuggestion = gradingResultToLegacySuggestion({
      result: providerResult(),
      data: submission(),
      source: "cheap_ai",
    });
    const overallSuggestion = gradingResultToLegacySuggestion({
      result: providerResult({ score: 7.6, rubric_results: [] }),
      data: submission({ rubric: null }),
      source: "cheap_ai",
    });

    expect(rubricSuggestion.suggestedScore).toBe(8);
    expect(rubricSuggestion.rubricScores).toEqual(expectedRubricScores);
    expect(rubricSuggestion.rubricScores.every((score) => Number.isInteger(score.awarded))).toBe(true);
    expect(rubricSuggestion.warnings).toContain(
      "AI score was rounded to the whole-point grading scale.",
    );
    expect(rubricSuggestion.autoApplicable).toBe(true);
    expect(overallSuggestion.suggestedScore).toBe(8);
    expect(overallSuggestion.autoApplicable).toBe(true);
  });

  it("applies a successful direct-audio result with numeric grade, feedback, and rubric", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue(directResult());

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({ status: "completed", gradeApplied: true });
    expectAppliedWholePointGrade();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ billingRequired: false, durationSeconds: 30 }),
    );
    expect(mocks.recordDeliveredAiUsageSafely).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
      cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      attemptId: "attempt-1",
      submissionId: "submission-1",
      durationSeconds: 30,
      occurredAt: 1,
    });
  });

  it("applies a successful transcript result with numeric grade, feedback, and rubric", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "transcribe_then_grade",
      model: gradingConfig.defaultModel,
      upload: "transcription_provider",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runGradingPipeline.mockResolvedValue(textResult());

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({ status: "completed", gradeApplied: true });
    expect(mocks.transcribeAudio).toHaveBeenCalledOnce();
    expect(mocks.runGradingPipeline).toHaveBeenCalledOnce();
    expectAppliedWholePointGrade();
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ billingRequired: false }),
    );
    expect(mocks.recordDeliveredAiUsageSafely).toHaveBeenCalledWith(
      expect.objectContaining({ cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
  });

  it("uses stable assignment and recording identity across grading-cache changes", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "transcribe_then_grade",
      model: gradingConfig.defaultModel,
      upload: "transcription_provider",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runGradingPipeline
      .mockResolvedValueOnce(
        textResult(undefined, { cacheHit: true, cacheKey: "shared-text-result-v1" }),
      )
      .mockResolvedValueOnce(
        textResult(undefined, { cacheHit: true, cacheKey: "shared-text-result-v1" }),
      )
      .mockResolvedValueOnce(
        textResult(undefined, { cacheHit: false, cacheKey: "changed-model-and-prompt-v2" }),
      )
      .mockResolvedValueOnce(
        textResult(undefined, { cacheHit: true, cacheKey: "changed-model-and-prompt-v2" }),
      );
    mocks.fetchAuthorizedAudioBuffer
      .mockResolvedValueOnce({
        buffer: Buffer.from("first recording"),
        contentType: "audio/webm",
        storageMode: "private-blob",
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from("second recording"),
        contentType: "audio/webm",
        storageMode: "private-blob",
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from("first recording"),
        contentType: "audio/webm",
        storageMode: "private-blob",
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from("first recording"),
        contentType: "audio/webm",
        storageMode: "private-blob",
      });

    await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission({ submissionId: "submission-recording-1" }),
    });
    await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission({ submissionId: "submission-recording-2" }),
    });
    await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission({ submissionId: "submission-recording-retry" }),
    });
    await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission({
        submissionId: "submission-assignment-changed",
        instructions: "Use two pieces of evidence.",
      }),
    });

    const deliveryKeys = mocks.createAiGradingAttempt.mock.calls.map(
      ([input]) => (input as { cacheKey: string }).cacheKey,
    );
    expect(deliveryKeys).toHaveLength(4);
    expect(deliveryKeys[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(deliveryKeys[1]).not.toBe(deliveryKeys[0]);
    expect(deliveryKeys[2]).toBe(deliveryKeys[0]);
    expect(deliveryKeys[3]).not.toBe(deliveryKeys[0]);
  });

  it("delivers an unmetered grade only when the atomic finalizer authorizes it", async () => {
    mocks.finalizeAiGradeDelivery.mockResolvedValue({
      status: "applied",
      billingRequired: false,
    });
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue(directResult());

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({ status: "completed", gradeApplied: true });
    expect(mocks.finalizeAiGradeDelivery).toHaveBeenCalledOnce();
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it("bills direct audio from final-call AUDIO tokens instead of model-reported duration", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue({
      ...directResult(),
      durationSeconds: 200,
      billableAudioInputTokens: 320,
    });

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({ status: "completed", gradeApplied: true });
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ billingRequired: false, durationSeconds: 10 }),
    );
    expect(mocks.recordDeliveredAiUsageSafely).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 10 }),
    );
  });

  it("bills only the base result when final-call AUDIO usage metadata is missing", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue({
      ...directResult(),
      durationSeconds: 200,
      billableAudioInputTokens: 0,
    });

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({ status: "completed", gradeApplied: true });
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ billingRequired: false, durationSeconds: 0 }),
    );
    expect(mocks.finalizeAiGradeDelivery).toHaveBeenCalledOnce();
    expect(mocks.recordDeliveredAiUsageSafely).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 0 }),
    );
  });

  it("refuses to apply a terminal unable-to-grade provider result", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "transcribe_then_grade",
      model: gradingConfig.defaultModel,
      upload: "transcription_provider",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runGradingPipeline.mockResolvedValue(
      textResult(providerResult(), { failureCode: "no_valid_provider_result" }),
    );

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({
      status: "completed",
      teacherAttention: "unable_to_grade",
      gradeApplied: false,
    });
    expect(mocks.finalizeAiGradeDelivery).not.toHaveBeenCalled();
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it.each([
    ["prompt injection", "Possible prompt injection detected in the transcript."],
    ["model disagreement", "The grading models materially disagreed."],
  ])("keeps a %s result as an unbilled review-only attempt", async (_case, reviewReason) => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue(
      directResult(
        providerResult({
          requires_teacher_review: true,
          review_reason: reviewReason,
        }),
      ),
    );

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({
      status: "completed",
      teacherAttention: "review",
      gradeApplied: false,
    });
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ autoApplicable: false }),
    );
    expect(mocks.finalizeAiGradeDelivery).not.toHaveBeenCalled();
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it("keeps a low-confidence caution result as an unbilled review-only attempt", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "transcribe_then_grade",
      model: gradingConfig.defaultModel,
      upload: "transcription_provider",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runGradingPipeline.mockResolvedValue(
      textResult(providerResult({ confidence: 0.7 })),
    );

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({
      status: "completed",
      teacherAttention: "caution",
      confidence: "medium",
      gradeApplied: false,
    });
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        autoApplicable: false,
        warnings: expect.arrayContaining([
          "AI confidence is below the automatic-grading threshold.",
        ]),
      }),
    );
    expect(mocks.finalizeAiGradeDelivery).not.toHaveBeenCalled();
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it("keeps a poor-transcript result as an unbilled review-only attempt", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "transcribe_then_grade",
      model: gradingConfig.defaultModel,
      upload: "transcription_provider",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.transcribeAudio.mockResolvedValue({
      transcript: "The answer explains the claim with supporting evidence.",
      detectedLanguage: "en",
      quality: "poor",
      durationSeconds: 30,
    });
    mocks.runGradingPipeline.mockResolvedValue(textResult());

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({
      status: "completed",
      teacherAttention: "review",
      gradeApplied: false,
    });
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        autoApplicable: false,
        warnings: expect.arrayContaining([
          "Transcript quality is too low for an unassisted suggestion.",
        ]),
      }),
    );
    expect(mocks.finalizeAiGradeDelivery).not.toHaveBeenCalled();
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it("keeps transcript-only grading of audio evidence as an unbilled review-only attempt", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "transcribe_then_grade",
      model: gradingConfig.defaultModel,
      upload: "transcription_provider",
      requiresTeacherReview: true,
      reasons: ["transcript_cannot_verify_audio_only_criteria"],
    });
    mocks.runGradingPipeline.mockResolvedValue(textResult());

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({
      status: "completed",
      teacherAttention: "review",
      gradeApplied: false,
    });
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        autoApplicable: false,
        warnings: expect.arrayContaining([
          "This rubric requires audio-only evidence that a transcript grader cannot verify.",
        ]),
      }),
    );
    expect(mocks.finalizeAiGradeDelivery).not.toHaveBeenCalled();
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it("does not overwrite a grade already present on the submission snapshot", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue(directResult());

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission({ finalGrade: 6, finalFeedback: "Teacher feedback" }),
    });

    expect(outcome).toMatchObject({
      status: "failed",
      code: "result_not_delivered",
    });
    expect(mocks.finalizeAiGradeDelivery).not.toHaveBeenCalled();
    expect(mocks.withholdAiGradingAttemptResult).toHaveBeenCalledOnce();
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it("does not bill when a teacher grade wins the atomic apply race", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue(directResult());
    mocks.finalizeAiGradeDelivery.mockResolvedValue({
      status: "not_applied",
      billingRequired: false,
      reason: "submission_changed",
    });

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({
      status: "failed",
      code: "result_not_delivered",
    });
    expect(mocks.finalizeAiGradeDelivery).toHaveBeenCalledOnce();
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ billingRequired: false }),
    );
    expect(mocks.withholdAiGradingAttemptResult).toHaveBeenCalledOnce();
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it("never marks usage billable while broad unmetered access is enabled", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue(directResult());

    const outcome = await gradeOneSubmission({
      config: { ...aiConfig, accessMode: "all" },
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({ status: "completed", gradeApplied: true });
    expect(mocks.finalizeAiGradeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        billingCandidate: false,
        allowUnmeteredAccess: true,
      }),
    );
    expect(mocks.recordDeliveredAiUsageSafely).not.toHaveBeenCalled();
  });

  it("bills the first delivered cache hit and retains its full audio duration", async () => {
    mocks.routeAudioGrading.mockReturnValue({
      strategy: "gemini_direct",
      model: gradingConfig.audioModel,
      upload: "inline",
      requiresTeacherReview: false,
      reasons: [],
    });
    mocks.runDirectAudioGradingPipeline.mockResolvedValue({
      ...directResult(),
      source: "cache",
      cacheHit: true,
      billableAudioInputTokens: 0,
    });

    const outcome = await gradeOneSubmission({
      config: aiConfig,
      teacherEmail: "teacher@example.com",
      data: submission(),
    });

    expect(outcome).toMatchObject({ status: "completed", gradeApplied: true });
    expect(mocks.finalizeAiGradeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ billingCandidate: true }),
    );
    expect(mocks.recordDeliveredAiUsageSafely).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 30 }),
    );
  });
});

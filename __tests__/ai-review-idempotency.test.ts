import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@/lib/ai/config";
import type { AiGradingAttemptRow, SubmissionForAiGradeRow } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  createAttempt: vi.fn(),
  finalizeDelivery: vi.fn(),
  getReusableAttempt: vi.fn(),
  reserveAllowance: vi.fn(),
  releaseAllowance: vi.fn(),
  fetchAudio: vi.fn(),
  transcribe: vi.fn(),
  directPipeline: vi.fn(),
  transcriptPipeline: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  createAiGradingAttempt: mocks.createAttempt,
  finalizeAiGradeDelivery: mocks.finalizeDelivery,
  getReusableAiReviewAttempt: mocks.getReusableAttempt,
  hasAudioTooLongFailure: vi.fn(async () => false),
  markAiGradingAttemptNotApplicable: vi.fn(),
  releaseAiReviewAllowanceReservation: mocks.releaseAllowance,
  reserveAiReviewAllowance: mocks.reserveAllowance,
  withholdAiGradingAttemptResult: vi.fn(),
}));

vi.mock("@/lib/ai/audio", () => ({
  fetchAuthorizedAudioBuffer: mocks.fetchAudio,
}));

vi.mock("@/lib/ai/providers", () => ({ transcribeAudio: mocks.transcribe }));
vi.mock("@/lib/grading/audio-pipeline", () => ({
  runDirectAudioGradingPipeline: mocks.directPipeline,
}));
vi.mock("@/lib/grading/pipeline", () => ({
  runGradingPipeline: mocks.transcriptPipeline,
}));
vi.mock("@/lib/grading/store", () => ({
  createDatabaseGradingStore: () => ({
    findCached: vi.fn(async () => null),
    assertProviderCallAllowed: vi.fn(async () => undefined),
  }),
}));

import { gradeOneSubmission } from "@/lib/ai/grade-one";

const config: AiConfig = {
  enabled: true,
  bulkEnabled: true,
  isDev: false,
  transcriptionProvider: "openai",
  gradingProvider: "openai",
  transcriptionModel: "gpt-4o-transcribe",
  gradingModel: "gpt-4o-mini",
  accessMode: "paid",
  studentDataApproved: true,
  teacherDenylist: new Set(),
  ollamaBaseUrl: "http://localhost:11434",
  maxAudioSeconds: 300,
  maxGenerationsPerSubmission: 10,
  cooldownSeconds: 0,
  dailyTeacherLimit: 20,
  dailyGlobalLimit: 500,
  monthlyBudgetUsd: 200,
  reservedCostUsdPerGeneration: 0.04,
  providerTimeoutMs: 120_000,
  providerMaxRetries: 2,
  gradingMaxOutputTokens: 1_200,
  failureMode: "",
};

const data: SubmissionForAiGradeRow = {
  submissionId: "sub_retry",
  assignmentId: "asg_retry",
  assignmentTitle: "Retry assignment",
  audioBlobUrl: "submissions/retry.webm",
  description: "",
  instructions: "Speak.",
  targetLanguage: "Spanish",
  rubric: null,
  maxPoints: 10,
  finalGrade: 8,
  finalGradeSource: "ai",
  finalFeedback: "Good work.",
};

const source: AiGradingAttemptRow = {
  id: "ai_source",
  submissionId: data.submissionId,
  teacherEmail: "teacher@example.com",
  status: "completed",
  deliveryStatus: "delivered",
  transcript: "Hola.",
  detectedLanguage: "Spanish",
  transcriptQuality: "good",
  durationSeconds: 5,
  suggestedScore: 8,
  rubricScores: [],
  feedback: "Good work.",
  strengths: ["Clear"],
  improvements: [],
  evidence: ["Hola"],
  confidence: "high",
  warnings: [],
  teacherAttention: "review",
  transcriptionProvider: "openai",
  gradingProvider: "openai",
  transcriptionModel: "gpt-4o-transcribe",
  gradingModel: "gpt-4o-mini",
  errorCode: "",
  errorMessage: "",
  cacheKey: "semantic-key",
  cacheHit: false,
  inputTokens: 1,
  cachedInputTokens: 0,
  outputTokens: 1,
  latencyMs: 1,
  retries: 0,
  escalated: false,
  escalationReason: "",
  estimatedCostMicrousd: 1,
  promptVersion: "v1",
  resultSource: "ai",
  billingRequired: false,
  billingPriceBookId: "",
  billingStripeCustomerId: "",
  billingStripeSubscriptionId: "",
  billingCatalogFingerprint: "",
  billingContractId: "",
  billingLivemode: false,
  billingQualifyingClassHighWater: 0,
  billingFreeCreditApplied: false,
  billableOutputTokens: 0,
  createdAt: 1,
  completedAt: 2,
};

describe("AI review semantic retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAudio.mockResolvedValue({
      buffer: Buffer.from("same recording"),
      contentType: "audio/webm",
    });
    mocks.reserveAllowance.mockResolvedValue({
      reservationStatus: "duplicate",
      sourceAttemptId: source.id,
      teacherEmail: source.teacherEmail,
      status: "free_lifetime",
      limit: 30,
      reserved: 0,
      consumed: 1,
      used: 1,
      remaining: 29,
      stripeSubscriptionId: null,
      periodStart: null,
      periodEnd: null,
    });
    mocks.getReusableAttempt.mockResolvedValue(source);
  });

  it("returns the durable source for an exact retry without another attempt or provider", async () => {
    await expect(
      gradeOneSubmission({ config, teacherEmail: source.teacherEmail, data }),
    ).resolves.toMatchObject({
      status: "completed",
      attemptId: source.id,
      attempt: source,
      gradeApplied: true,
    });
    expect(mocks.createAttempt).not.toHaveBeenCalled();
    expect(mocks.finalizeDelivery).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.directPipeline).not.toHaveBeenCalled();
    expect(mocks.transcriptPipeline).not.toHaveBeenCalled();
    expect(mocks.releaseAllowance).not.toHaveBeenCalled();
  });

  it("does not overwrite a teacher-edited grade or feedback", async () => {
    const edited = {
      ...data,
      finalGrade: 7,
      finalGradeSource: "teacher" as const,
      finalFeedback: "Teacher edit.",
    };
    await expect(
      gradeOneSubmission({ config, teacherEmail: source.teacherEmail, data: edited }),
    ).resolves.toMatchObject({
      status: "failed",
      code: "submission_already_graded",
    });
    expect(mocks.createAttempt).not.toHaveBeenCalled();
    expect(mocks.finalizeDelivery).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.directPipeline).not.toHaveBeenCalled();
    expect(mocks.transcriptPipeline).not.toHaveBeenCalled();
  });

  it("releases a reservation when provider work fails", async () => {
    mocks.reserveAllowance.mockResolvedValue({
      reservationStatus: "reserved",
      reservationId: "air_failed_provider",
      teacherEmail: source.teacherEmail,
      status: "free_lifetime",
      limit: 30,
      reserved: 1,
      consumed: 0,
      used: 1,
      remaining: 29,
      stripeSubscriptionId: null,
      periodStart: null,
      periodEnd: null,
    });
    mocks.transcribe.mockRejectedValue(new Error("provider unavailable"));
    const ungraded = {
      ...data,
      submissionId: "sub_provider_failure",
      finalGrade: null,
      finalGradeSource: "teacher" as const,
      finalFeedback: "",
    };

    await expect(
      gradeOneSubmission({ config, teacherEmail: source.teacherEmail, data: ungraded }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(mocks.releaseAllowance).toHaveBeenCalledWith({
      reservationId: "air_failed_provider",
      teacherEmail: source.teacherEmail,
    });
    expect(mocks.finalizeDelivery).not.toHaveBeenCalled();
  });
});

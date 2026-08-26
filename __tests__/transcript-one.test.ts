import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@/lib/ai/config";
import type {
  AiReviewAllowanceSummary,
  SubmissionForAiGradeRow,
  SubmissionTranscriptRow,
} from "@/lib/db";

const mocks = vi.hoisted(() => {
  const store = {
    findCached: vi.fn(),
    saveCached: vi.fn(),
    recordRequest: vi.fn(),
    assertProviderCallAllowed: vi.fn(),
  };
  return {
    copyConsumed: vi.fn(),
    finalizeTranscript: vi.fn(),
    findTranscript: vi.fn(),
    findTranscriptBySemanticKey: vi.fn(),
    getAllowance: vi.fn(),
    releaseAllowance: vi.fn(),
    reserveAllowance: vi.fn(),
    saveUnmetered: vi.fn(),
    fetchAudio: vi.fn(),
    reserveBudget: vi.fn(),
    transcribeAudio: vi.fn(),
    getGradingConfig: vi.fn(),
    estimateCost: vi.fn(),
    createStore: vi.fn(),
    store,
  };
});

vi.mock("@/lib/db", () => ({
  copyConsumedReviewTranscriptToSubmission: mocks.copyConsumed,
  finalizeSubmissionTranscriptDelivery: mocks.finalizeTranscript,
  findSubmissionTranscriptForOwner: mocks.findTranscript,
  findSubmissionTranscriptForOwnerBySemanticKey: mocks.findTranscriptBySemanticKey,
  getAiReviewAllowanceSummary: mocks.getAllowance,
  releaseAiReviewAllowanceReservation: mocks.releaseAllowance,
  reserveAiReviewAllowance: mocks.reserveAllowance,
  saveUnmeteredSubmissionTranscript: mocks.saveUnmetered,
}));
vi.mock("@/lib/ai/audio", () => ({
  fetchAuthorizedAudioBuffer: mocks.fetchAudio,
}));
vi.mock("@/lib/ai/budget", () => ({
  reserveGenerationBudget: mocks.reserveBudget,
}));
vi.mock("@/lib/ai/providers", () => ({
  transcribeAudio: mocks.transcribeAudio,
}));
vi.mock("@/lib/grading/config", () => ({
  getGradingConfig: mocks.getGradingConfig,
}));
vi.mock("@/lib/grading/pricing", () => ({
  estimateTranscriptionCostMicrousd: mocks.estimateCost,
}));
vi.mock("@/lib/grading/store", () => ({
  createDatabaseGradingStore: mocks.createStore,
}));

import { transcribeOneSubmission } from "@/lib/ai/transcript-one";

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
  submissionId: "sub_manual_grade",
  assignmentId: "asg_1",
  assignmentTitle: "Speaking response",
  audioBlobUrl: "private/sub_manual_grade.webm",
  description: "",
  instructions: "Speak in Spanish.",
  targetLanguage: "Spanish",
  rubric: null,
  maxPoints: 10,
  finalGrade: 8,
  finalGradeSource: "teacher",
  finalFeedback: "Teacher feedback already exists.",
};

const allowance: AiReviewAllowanceSummary = {
  teacherEmail: "teacher@example.com",
  status: "free_lifetime",
  limit: 30,
  reserved: 0,
  consumed: 1,
  used: 1,
  remaining: 29,
  stripeSubscriptionId: null,
  periodStart: null,
  periodEnd: null,
};

const saved: SubmissionTranscriptRow = {
  id: "tr_1",
  submissionId: data.submissionId,
  teacherEmail: allowance.teacherEmail,
  semanticKey: "semantic-key",
  assignmentFingerprint: "assignment-fingerprint",
  transcriptCacheKey: "transcript-cache-key",
  transcript: "Hola, esta es mi respuesta.",
  detectedLanguage: "Spanish",
  transcriptQuality: "good",
  durationSeconds: 8,
  transcriptionProvider: "openai",
  transcriptionModel: "gpt-4o-transcribe",
  estimatedCostMicrousd: 10,
  latencyMs: 20,
  createdAt: 100,
  updatedAt: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createStore.mockReturnValue(mocks.store);
  mocks.store.findCached.mockResolvedValue(null);
  mocks.store.saveCached.mockResolvedValue(undefined);
  mocks.store.recordRequest.mockResolvedValue(undefined);
  mocks.store.assertProviderCallAllowed.mockResolvedValue(undefined);
  mocks.getGradingConfig.mockReturnValue({
    transcriptionUsdPerMinute: 0.006,
    promptVersion: "test-v1",
    cacheTtlDays: 30,
  });
  mocks.fetchAudio.mockResolvedValue({
    buffer: Buffer.from("same recording"),
    contentType: "audio/webm",
  });
  mocks.reserveAllowance.mockResolvedValue({
    ...allowance,
    reservationStatus: "reserved",
    reservationId: "air_1",
    reserved: 1,
    consumed: 0,
  });
  mocks.findTranscript.mockResolvedValue(null);
  mocks.findTranscriptBySemanticKey.mockResolvedValue(null);
  mocks.reserveBudget.mockResolvedValue(true);
  mocks.transcribeAudio.mockResolvedValue({
    transcript: saved.transcript,
    detectedLanguage: saved.detectedLanguage,
    quality: saved.transcriptQuality,
    durationSeconds: saved.durationSeconds,
  });
  mocks.estimateCost.mockReturnValue({ totalMicrousd: 10, costKnown: true });
  mocks.finalizeTranscript.mockResolvedValue(saved);
  mocks.getAllowance.mockResolvedValue(allowance);
  mocks.releaseAllowance.mockResolvedValue(true);
});

describe("standalone transcript processing", () => {
  it("persists a transcript after manual grading and consumes one recording unit", async () => {
    await expect(
      transcribeOneSubmission({ config, teacherEmail: allowance.teacherEmail, data }),
    ).resolves.toEqual({ status: "completed", item: saved, allowance });

    expect(mocks.transcribeAudio).toHaveBeenCalledOnce();
    expect(mocks.reserveBudget).toHaveBeenCalledOnce();
    expect(mocks.finalizeTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "air_1",
        value: expect.objectContaining({
          submissionId: data.submissionId,
          transcript: saved.transcript,
        }),
      }),
    );
    expect(mocks.releaseAllowance).toHaveBeenCalledWith({
      reservationId: "air_1",
      teacherEmail: allowance.teacherEmail,
    });
  });

  it("returns an exact saved retry without transcription or provider budget work", async () => {
    mocks.reserveAllowance.mockResolvedValue({
      ...allowance,
      reservationStatus: "duplicate",
      reservationId: "air_1",
      sourceAttemptId: saved.id,
      sourceResultId: saved.id,
      sourceKind: "transcript",
    });
    mocks.copyConsumed.mockResolvedValue(saved);

    await expect(
      transcribeOneSubmission({ config, teacherEmail: allowance.teacherEmail, data }),
    ).resolves.toEqual({ status: "completed", item: saved, allowance });

    expect(mocks.copyConsumed).toHaveBeenCalledOnce();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.reserveBudget).not.toHaveBeenCalled();
    expect(mocks.finalizeTranscript).not.toHaveBeenCalled();
  });

  it("does not consume the allowance when the provider returns no usable speech", async () => {
    mocks.transcribeAudio.mockResolvedValue({
      transcript: "   ",
      detectedLanguage: "",
      quality: "poor",
      durationSeconds: 3,
    });

    await expect(
      transcribeOneSubmission({ config, teacherEmail: allowance.teacherEmail, data }),
    ).resolves.toMatchObject({
      status: "failed",
      code: "no_speech_detected",
    });

    expect(mocks.finalizeTranscript).not.toHaveBeenCalled();
    expect(mocks.store.saveCached).not.toHaveBeenCalled();
    expect(mocks.releaseAllowance).toHaveBeenCalledWith({
      reservationId: "air_1",
      teacherEmail: allowance.teacherEmail,
    });
  });

  it.each([
    [404, "no_audio"],
    [413, "audio_too_large"],
  ])("preserves safe audio fetch status %i as %s", async (status, code) => {
    mocks.fetchAudio.mockRejectedValue(
      Object.assign(new Error("safe storage error"), { status }),
    );

    await expect(
      transcribeOneSubmission({ config, teacherEmail: allowance.teacherEmail, data }),
    ).resolves.toMatchObject({ status: "failed", code });

    expect(mocks.reserveAllowance).not.toHaveBeenCalled();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  it("maps the per-teacher provider usage guard to a retryable limit", async () => {
    mocks.store.assertProviderCallAllowed.mockRejectedValue(
      Object.assign(new Error("internal usage detail"), {
        name: "GradingUsageLimitError",
        code: "daily_request_limit",
      }),
    );

    await expect(
      transcribeOneSubmission({ config, teacherEmail: allowance.teacherEmail, data }),
    ).resolves.toEqual({
      status: "failed",
      code: "usage_limit_reached",
      message: "The daily transcription limit has been reached. Try again tomorrow.",
    });

    expect(mocks.reserveBudget).not.toHaveBeenCalled();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.releaseAllowance).toHaveBeenCalledWith({
      reservationId: "air_1",
      teacherEmail: allowance.teacherEmail,
    });
  });
});

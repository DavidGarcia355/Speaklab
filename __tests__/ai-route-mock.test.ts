import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinalizeAiGradeDeliveryResult } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(async () => "dev-teacher@local.test"),
  findSubmissionForAiGrade: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    submissionId: "sub_1",
    assignmentId: "asg_1",
    assignmentTitle: "Speaking",
    audioBlobUrl: "data:audio/webm;base64,c2FmZQ==",
    instructions: "Introduce yourself.",
    rubric: null,
    maxPoints: 10,
    finalGrade: null,
    finalFeedback: "",
  })),
  findOwnedSubmissionForAiReview: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  findTeacherFunnelRowByEmail: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    joinedAt: 50,
  })),
  enqueueSuccessfulAiReviewAlerts: vi.fn(async () => undefined),
  getAiReviewAllowanceSummary: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    teacherEmail: "dev-teacher@local.test",
    status: "free_lifetime",
    limit: 30,
    reserved: 0,
    consumed: 0,
    used: 0,
    remaining: 30,
    stripeSubscriptionId: null,
    periodStart: null,
    periodEnd: null,
  })),
  reserveAiReviewAllowance: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    reservationStatus: "reserved",
    reservationId: "air_1",
    teacherEmail: "dev-teacher@local.test",
    status: "free_lifetime",
    limit: 30,
    reserved: 1,
    consumed: 0,
    used: 1,
    remaining: 29,
    stripeSubscriptionId: null,
    periodStart: null,
    periodEnd: null,
  })),
  releaseAiReviewAllowanceReservation: vi.fn(async () => true),
  getReusableAiReviewAttempt: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  findSubmissionTranscriptByIdForOwner: vi.fn(async () => null),
  findSubmissionTranscriptForOwner: vi.fn(async () => null),
  findSubmissionTranscriptForOwnerBySemanticKey: vi.fn(async () => null),
  countAiAttemptsForSubmission: vi.fn(async () => 0),
  countAiAttemptsForTeacherSince: vi.fn(async () => 0),
  countAiAttemptsSince: vi.fn(async () => 0),
  hasAudioTooLongFailure: vi.fn(async () => false),
  latestAiAttemptCreatedAt: vi.fn<() => Promise<number | null>>(async () => null),
  listAiGradingAttemptsForSubmission: vi.fn(async () => []),
  createAiGradingAttempt: vi.fn(async (input) => ({
    id: "ai_1",
    createdAt: 100,
    completedAt: 100,
    errorCode: "",
    errorMessage: "",
    ...input,
  })),
  copyConsumedReviewTranscriptToSubmission: vi.fn(async () => ({
    id: "tr_duplicate",
  })),
  finalizeAiGradeDelivery: vi.fn<
    (_input: unknown) => Promise<FinalizeAiGradeDeliveryResult>
  >(async () => ({
    status: "applied",
    billingRequired: false,
  })),
  markAiGradingAttemptNotApplicable: vi.fn(async () => true),
  withholdAiGradingAttemptResult: vi.fn(async () => true),
  markAiGradingAttemptBillingRequired: vi.fn(async () => true),
  reserveAiBudget: vi.fn(async () => true),
  findValidGradingResultCache: vi.fn(async () => null),
  upsertGradingResultCache: vi.fn(async () => null),
  recordGradingProviderRequest: vi.fn(async () => null),
  getTeacherGradingUsageSince: vi.fn(async () => ({
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    retries: 0,
    escalations: 0,
    estimatedCostMicrousd: 0,
  })),
  applyAiGradeToSubmission: vi.fn(async (_submissionId, _teacherEmail, input) => ({
    id: "sub_1",
    grade: input.grade,
    feedback: input.feedback,
    rubricScores: input.rubricScores,
  })),
  getTeacherGradingUsageForUtcMonth: vi.fn(async () => ({
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    retries: 0,
    escalations: 0,
    estimatedCostMicrousd: 0,
  })),
}));

vi.mock("@/lib/authz", () => ({ requireTeacherEmail: mocks.requireTeacherEmail }));
vi.mock("@/lib/admin-alert-lifecycle", () => ({
  enqueueSuccessfulAiReviewAlerts: mocks.enqueueSuccessfulAiReviewAlerts,
}));
vi.mock("@/lib/db", () => ({
  findSubmissionForAiGrade: mocks.findSubmissionForAiGrade,
  findOwnedSubmissionForAiReview: mocks.findOwnedSubmissionForAiReview,
  findTeacherFunnelRowByEmail: mocks.findTeacherFunnelRowByEmail,
  getAiReviewAllowanceSummary: mocks.getAiReviewAllowanceSummary,
  reserveAiReviewAllowance: mocks.reserveAiReviewAllowance,
  releaseAiReviewAllowanceReservation: mocks.releaseAiReviewAllowanceReservation,
  getReusableAiReviewAttempt: mocks.getReusableAiReviewAttempt,
  findSubmissionTranscriptByIdForOwner: mocks.findSubmissionTranscriptByIdForOwner,
  findSubmissionTranscriptForOwner: mocks.findSubmissionTranscriptForOwner,
  findSubmissionTranscriptForOwnerBySemanticKey:
    mocks.findSubmissionTranscriptForOwnerBySemanticKey,
  countAiAttemptsForSubmission: mocks.countAiAttemptsForSubmission,
  countAiAttemptsForTeacherSince: mocks.countAiAttemptsForTeacherSince,
  countAiAttemptsSince: mocks.countAiAttemptsSince,
  hasAudioTooLongFailure: mocks.hasAudioTooLongFailure,
  latestAiAttemptCreatedAt: mocks.latestAiAttemptCreatedAt,
  listAiGradingAttemptsForSubmission: mocks.listAiGradingAttemptsForSubmission,
  createAiGradingAttempt: mocks.createAiGradingAttempt,
  copyConsumedReviewTranscriptToSubmission:
    mocks.copyConsumedReviewTranscriptToSubmission,
  finalizeAiGradeDelivery: mocks.finalizeAiGradeDelivery,
  markAiGradingAttemptNotApplicable: mocks.markAiGradingAttemptNotApplicable,
  withholdAiGradingAttemptResult: mocks.withholdAiGradingAttemptResult,
  markAiGradingAttemptBillingRequired: mocks.markAiGradingAttemptBillingRequired,
  applyAiGradeToSubmission: mocks.applyAiGradeToSubmission,
  reserveAiBudget: mocks.reserveAiBudget,
  findValidGradingResultCache: mocks.findValidGradingResultCache,
  upsertGradingResultCache: mocks.upsertGradingResultCache,
  recordGradingProviderRequest: mocks.recordGradingProviderRequest,
  getTeacherGradingUsageSince: mocks.getTeacherGradingUsageSince,
  getTeacherGradingUsageForUtcMonth: mocks.getTeacherGradingUsageForUtcMonth,
}));
vi.mock("@/lib/http", async () => {
  class MockHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    HttpError: MockHttpError,
    withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        if (error instanceof MockHttpError) {
          return Response.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
    },
  };
});

describe("AI grading mock route", () => {
  beforeEach(() => {
    process.env.AI_GRADING_ENABLED = "true";
    process.env.AI_TRANSCRIPTION_PROVIDER = "mock";
    process.env.AI_GRADING_PROVIDER = "mock";
    process.env.AI_LOCAL_FAILURE_MODE = "";
    delete process.env.AI_ACCESS_MODE;
    delete process.env.AI_TEACHER_DENYLIST;
    mocks.requireTeacherEmail.mockClear();
    mocks.findSubmissionForAiGrade.mockReset();
    mocks.findSubmissionForAiGrade.mockResolvedValue({
      submissionId: "sub_1",
      assignmentId: "asg_1",
      assignmentTitle: "Speaking",
      audioBlobUrl: "data:audio/webm;base64,c2FmZQ==",
      instructions: "Introduce yourself.",
      rubric: null,
      maxPoints: 10,
      finalGrade: null,
      finalFeedback: "",
    });
    mocks.findOwnedSubmissionForAiReview.mockReset();
    mocks.findOwnedSubmissionForAiReview.mockResolvedValue(null);
    mocks.findTeacherFunnelRowByEmail.mockReset().mockResolvedValue({ joinedAt: 50 });
    mocks.enqueueSuccessfulAiReviewAlerts.mockReset().mockResolvedValue(undefined);
    mocks.getAiReviewAllowanceSummary.mockClear();
    mocks.reserveAiReviewAllowance.mockReset();
    mocks.reserveAiReviewAllowance.mockResolvedValue({
      reservationStatus: "reserved",
      reservationId: "air_1",
      teacherEmail: "dev-teacher@local.test",
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
    mocks.releaseAiReviewAllowanceReservation.mockReset();
    mocks.releaseAiReviewAllowanceReservation.mockResolvedValue(true);
    mocks.getReusableAiReviewAttempt.mockReset();
    mocks.getReusableAiReviewAttempt.mockResolvedValue(null);
    mocks.reserveAiBudget.mockReset();
    mocks.reserveAiBudget.mockResolvedValue(true);
    mocks.createAiGradingAttempt.mockClear();
    mocks.finalizeAiGradeDelivery.mockReset();
    mocks.finalizeAiGradeDelivery.mockResolvedValue({
      status: "applied",
      billingRequired: false,
    });
    mocks.markAiGradingAttemptNotApplicable.mockReset();
    mocks.markAiGradingAttemptNotApplicable.mockResolvedValue(true);
    mocks.withholdAiGradingAttemptResult.mockReset();
    mocks.withholdAiGradingAttemptResult.mockResolvedValue(true);
    mocks.markAiGradingAttemptBillingRequired.mockClear();
    mocks.applyAiGradeToSubmission.mockClear();
    mocks.latestAiAttemptCreatedAt.mockReset();
    mocks.latestAiAttemptCreatedAt.mockResolvedValue(null);
  });

  it("creates an auditable attempt and automatically saves the AI grade", async () => {
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }), {
      params: Promise.resolve({ submissionId: "sub_1" }),
    });
    const body = (await response.json()) as {
      attempt: Record<string, unknown> & { suggestedScore: number; feedback: string };
      gradeApplied: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.attempt.suggestedScore).toBe(8);
    expect(body.attempt.feedback).toContain("Mock suggestion");
    expect(body.attempt).not.toHaveProperty("estimatedCostUsd");
    expect(body.attempt).not.toHaveProperty("inputTokens");
    expect(body.attempt).not.toHaveProperty("outputTokens");
    expect(body.attempt).not.toHaveProperty("gradingProvider");
    expect(body.attempt).not.toHaveProperty("gradingModel");
    expect(body.gradeApplied).toBe(true);
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledOnce();
    expect(mocks.createAiGradingAttempt.mock.calls[0][0]).not.toHaveProperty("grade");
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ billingRequired: false }),
    );
    expect(mocks.finalizeAiGradeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "ai_1",
        ownerEmail: "dev-teacher@local.test",
        priceBookId: "tryhabla-teacher-usd-v3",
        billingCandidate: false,
      }),
    );
    expect(mocks.applyAiGradeToSubmission).not.toHaveBeenCalled();
    expect(mocks.enqueueSuccessfulAiReviewAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        teacherEmail: "dev-teacher@local.test",
        teacherJoinedAt: 50,
        allowance: null,
      }),
    );
  }, 30_000);

  it("returns cooldown as a visible rate-limit state", async () => {
    mocks.latestAiAttemptCreatedAt.mockResolvedValueOnce(Date.now());
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }), {
      params: Promise.resolve({ submissionId: "sub_1" }),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(429);
    expect(body.error).toContain("wait");
  }, 30_000);

  it("returns no attempt when atomic delivery is withheld", async () => {
    mocks.finalizeAiGradeDelivery.mockResolvedValueOnce({
      status: "not_applied",
      billingRequired: false,
      reason: "submission_changed",
    });
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(
      new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }),
      { params: Promise.resolve({ submissionId: "sub_1" }) },
    );
    const body = (await response.json()) as { attempt: unknown; error: string };

    expect(response.status).toBe(409);
    expect(body.attempt).toBeNull();
    expect(body.error).toContain("No AI result was delivered or billed");
    expect(mocks.withholdAiGradingAttemptResult).toHaveBeenCalledOnce();
    expect(mocks.listAiGradingAttemptsForSubmission).not.toHaveBeenCalled();
  }, 30_000);

  it("blocks a teacher on the emergency denylist before provider work", async () => {
    process.env.AI_TEACHER_DENYLIST = "DEV-TEACHER@LOCAL.TEST";
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(
      new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }),
      { params: Promise.resolve({ submissionId: "sub_1" }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.findSubmissionForAiGrade).not.toHaveBeenCalled();
    expect(mocks.createAiGradingAttempt).not.toHaveBeenCalled();
  });

  it("returns the lifetime allowance cap before non-local provider work", async () => {
    process.env.AI_GRADING_PROVIDER = "ollama";
    mocks.reserveAiReviewAllowance.mockResolvedValueOnce({
      reservationStatus: "exhausted",
      teacherEmail: "dev-teacher@local.test",
      status: "free_lifetime",
      limit: 30,
      reserved: 0,
      consumed: 30,
      used: 30,
      remaining: 0,
      stripeSubscriptionId: null,
      periodStart: null,
      periodEnd: null,
    });
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(
      new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }),
      { params: Promise.resolve({ submissionId: "sub_1" }) }
    );

    expect(response.status).toBe(429);
    expect(mocks.reserveAiReviewAllowance).toHaveBeenCalledOnce();
    expect(mocks.reserveAiBudget).not.toHaveBeenCalled();
    expect(mocks.createAiGradingAttempt).not.toHaveBeenCalled();
    expect(mocks.releaseAiReviewAllowanceReservation).not.toHaveBeenCalled();
  });

  it("returns an exact saved review without generation limits or provider work", async () => {
    process.env.AI_GRADING_PROVIDER = "ollama";
    const reusableAttempt = {
      id: "ai_saved",
      submissionId: "sub_1",
      teacherEmail: "dev-teacher@local.test",
      status: "completed",
      deliveryStatus: "delivered",
      transcript: "Saved transcript",
      detectedLanguage: "en",
      transcriptQuality: "good",
      durationSeconds: 12,
      suggestedScore: 8,
      rubricScores: [],
      feedback: "Saved feedback",
      strengths: [],
      improvements: [],
      evidence: [],
      confidence: "high",
      warnings: [],
      teacherAttention: "none",
      transcriptionProvider: "mock",
      gradingProvider: "ollama",
      transcriptionModel: "mock",
      gradingModel: "llama",
      errorCode: "",
      errorMessage: "",
      cacheHit: false,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      retries: 0,
      escalated: false,
      escalationReason: "",
      estimatedCostMicrousd: 0,
      promptVersion: "test",
      resultSource: "ai",
      cacheKey: "semantic-key",
      billingRequired: false,
      billingPriceBookId: "tryhabla-teacher-usd-v3",
      billingStripeCustomerId: "",
      billingStripeSubscriptionId: "",
      billingCatalogFingerprint: "",
      billingContractId: "",
      billingLivemode: false,
      billingQualifyingClassHighWater: 0,
      billingFreeCreditApplied: false,
      billableOutputTokens: 0,
      autoApplicable: true,
      createdAt: 100,
      completedAt: 100,
    };
    mocks.findSubmissionForAiGrade.mockResolvedValueOnce(null);
    mocks.findOwnedSubmissionForAiReview.mockResolvedValueOnce({
      submissionId: "sub_1",
      assignmentId: "asg_1",
      assignmentTitle: "Speaking",
      audioBlobUrl: "data:audio/webm;base64,c2FmZQ==",
      description: "",
      instructions: "Introduce yourself.",
      rubric: null,
      maxPoints: 10,
      finalGrade: 8,
      finalGradeSource: "ai",
      finalFeedback: "Saved feedback",
    });
    mocks.reserveAiReviewAllowance.mockResolvedValueOnce({
      reservationStatus: "duplicate",
      sourceAttemptId: "ai_saved",
      teacherEmail: "dev-teacher@local.test",
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
    mocks.getReusableAiReviewAttempt.mockResolvedValueOnce(reusableAttempt);
    mocks.latestAiAttemptCreatedAt.mockResolvedValueOnce(Date.now());
    mocks.reserveAiBudget.mockResolvedValueOnce(false);
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(
      new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }),
      { params: Promise.resolve({ submissionId: "sub_1" }) },
    );
    const body = (await response.json()) as {
      attempt: { id: string; suggestedScore: number };
      gradeApplied: boolean;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      attempt: { id: "ai_saved", suggestedScore: 8 },
      gradeApplied: true,
    });
    expect(mocks.findOwnedSubmissionForAiReview).toHaveBeenCalledOnce();
    expect(mocks.getReusableAiReviewAttempt).toHaveBeenCalledOnce();
    expect(mocks.reserveAiBudget).not.toHaveBeenCalled();
    expect(mocks.createAiGradingAttempt).not.toHaveBeenCalled();
    expect(mocks.finalizeAiGradeDelivery).not.toHaveBeenCalled();
  });

  it("allows broad access but stops before providers when the monthly budget is exhausted", async () => {
    process.env.AI_ACCESS_MODE = "all";
    process.env.AI_GRADING_PROVIDER = "ollama";
    mocks.reserveAiBudget.mockResolvedValueOnce(false);
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(
      new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }),
      { params: Promise.resolve({ submissionId: "sub_1" }) }
    );

    expect(response.status).toBe(429);
    expect(mocks.reserveAiBudget).toHaveBeenCalledOnce();
    expect(mocks.createAiGradingAttempt).not.toHaveBeenCalled();
  });

  it("releases a paid allowance reservation when provider budget is exhausted", async () => {
    process.env.AI_GRADING_PROVIDER = "ollama";
    mocks.reserveAiBudget.mockResolvedValueOnce(false);
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(
      new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }),
      { params: Promise.resolve({ submissionId: "sub_1" }) },
    );

    expect(response.status).toBe(429);
    expect(mocks.reserveAiReviewAllowance).toHaveBeenCalledOnce();
    expect(mocks.reserveAiBudget).toHaveBeenCalledOnce();
    expect(mocks.releaseAiReviewAllowanceReservation).toHaveBeenCalledWith({
      reservationId: "air_1",
      teacherEmail: "dev-teacher@local.test",
    });
    expect(mocks.createAiGradingAttempt).not.toHaveBeenCalled();
  });
});

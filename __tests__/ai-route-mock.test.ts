import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinalizeAiGradeDeliveryResult } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(async () => "dev-teacher@local.test"),
  getUserHasAiAccess: vi.fn(async () => false),
  findSubmissionForAiGrade: vi.fn(async () => ({
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
  recordDeliveredAiUsageSafely: vi.fn(async () => ({ status: "disabled", usage: null })),
}));

vi.mock("@/lib/authz", () => ({ requireTeacherEmail: mocks.requireTeacherEmail }));
vi.mock("@/lib/billing", () => ({
  recordDeliveredAiUsageSafely: mocks.recordDeliveredAiUsageSafely,
}));
vi.mock("@/lib/db", () => ({
  getUserHasAiAccess: mocks.getUserHasAiAccess,
  findSubmissionForAiGrade: mocks.findSubmissionForAiGrade,
  countAiAttemptsForSubmission: mocks.countAiAttemptsForSubmission,
  countAiAttemptsForTeacherSince: mocks.countAiAttemptsForTeacherSince,
  countAiAttemptsSince: mocks.countAiAttemptsSince,
  hasAudioTooLongFailure: mocks.hasAudioTooLongFailure,
  latestAiAttemptCreatedAt: mocks.latestAiAttemptCreatedAt,
  listAiGradingAttemptsForSubmission: mocks.listAiGradingAttemptsForSubmission,
  createAiGradingAttempt: mocks.createAiGradingAttempt,
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
    mocks.getUserHasAiAccess.mockClear();
    mocks.findSubmissionForAiGrade.mockClear();
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
      attempt: { suggestedScore: number; feedback: string };
      gradeApplied: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.attempt.suggestedScore).toBe(8);
    expect(body.attempt.feedback).toContain("Mock suggestion");
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
        priceBookId: "habla-teacher-ai-usd-v2",
      }),
    );
    expect(mocks.applyAiGradeToSubmission).not.toHaveBeenCalled();
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

  it("keeps the paid entitlement gate for non-local providers", async () => {
    process.env.AI_GRADING_PROVIDER = "ollama";
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(
      new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }),
      { params: Promise.resolve({ submissionId: "sub_1" }) }
    );

    expect(response.status).toBe(402);
    expect(mocks.getUserHasAiAccess).toHaveBeenCalledOnce();
    expect(mocks.reserveAiBudget).not.toHaveBeenCalled();
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
    expect(mocks.getUserHasAiAccess).not.toHaveBeenCalled();
    expect(mocks.reserveAiBudget).toHaveBeenCalledOnce();
    expect(mocks.createAiGradingAttempt).not.toHaveBeenCalled();
  });
});

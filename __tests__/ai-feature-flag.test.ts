import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  findSubmissionForAiGrade: vi.fn(),
  getUserIsPaid: vi.fn(),
  countAiAttemptsForSubmission: vi.fn(),
  countAiAttemptsForTeacherSince: vi.fn(),
  countAiAttemptsSince: vi.fn(),
  createAiGradingAttempt: vi.fn(),
  reserveAiBudget: vi.fn(),
  latestAiAttemptCreatedAt: vi.fn(),
  listAiGradingAttemptsForSubmission: vi.fn(),
  listUngradedSubmissionsForAiGrade: vi.fn(),
  blobGet: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/db", () => ({
  findSubmissionForAiGrade: mocks.findSubmissionForAiGrade,
  getUserIsPaid: mocks.getUserIsPaid,
  countAiAttemptsForSubmission: mocks.countAiAttemptsForSubmission,
  countAiAttemptsForTeacherSince: mocks.countAiAttemptsForTeacherSince,
  countAiAttemptsSince: mocks.countAiAttemptsSince,
  createAiGradingAttempt: mocks.createAiGradingAttempt,
  reserveAiBudget: mocks.reserveAiBudget,
  latestAiAttemptCreatedAt: mocks.latestAiAttemptCreatedAt,
  listAiGradingAttemptsForSubmission: mocks.listAiGradingAttemptsForSubmission,
  listUngradedSubmissionsForAiGrade: mocks.listUngradedSubmissionsForAiGrade,
}));

vi.mock("@vercel/blob", () => ({
  get: mocks.blobGet,
}));

vi.mock("openai", () => ({
  default: vi.fn(),
  toFile: vi.fn(),
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

describe("AI grading feature flag", () => {
  const original = process.env.AI_GRADING_ENABLED;
  const originalBulk = process.env.AI_BULK_GRADING_ENABLED;

  beforeEach(() => {
    delete process.env.AI_GRADING_ENABLED;
    delete process.env.AI_BULK_GRADING_ENABLED;
    mocks.requireTeacherEmail.mockReset();
    mocks.findSubmissionForAiGrade.mockReset();
    mocks.getUserIsPaid.mockReset();
    mocks.blobGet.mockReset();
  });

  afterEach(() => {
    process.env.AI_GRADING_ENABLED = original;
    if (typeof originalBulk === "undefined") delete process.env.AI_BULK_GRADING_ENABLED;
    else process.env.AI_BULK_GRADING_ENABLED = originalBulk;
  });

  it("rejects AI grading while disabled before touching auth, audio, or providers", async () => {
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(new Request("http://localhost/api/submissions/sub_1/ai-grade", {
      method: "POST",
    }), {
      params: Promise.resolve({ submissionId: "sub_1" }),
    });
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(data.error).toContain("not available");
    expect(mocks.requireTeacherEmail).not.toHaveBeenCalled();
    expect(mocks.findSubmissionForAiGrade).not.toHaveBeenCalled();
    expect(mocks.blobGet).not.toHaveBeenCalled();
  });

  it("keeps synchronous bulk grading disabled unless separately enabled", async () => {
    process.env.AI_GRADING_ENABLED = "true";
    const { GET } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await GET(
      new Request("http://localhost/api/assignments/asg_1/ai-grade-all"),
      { params: Promise.resolve({ assignmentId: "asg_1" }) }
    );
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(data.error).toContain("Bulk AI grading");
    expect(mocks.requireTeacherEmail).not.toHaveBeenCalled();
    expect(mocks.listUngradedSubmissionsForAiGrade).not.toHaveBeenCalled();
  });
});

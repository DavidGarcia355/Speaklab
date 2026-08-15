import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(async () => "dev-teacher@local.test"),
  getUserIsPaid: vi.fn(async () => false),
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
}));

vi.mock("@/lib/authz", () => ({ requireTeacherEmail: mocks.requireTeacherEmail }));
vi.mock("@/lib/db", () => ({
  getUserIsPaid: mocks.getUserIsPaid,
  findSubmissionForAiGrade: mocks.findSubmissionForAiGrade,
  countAiAttemptsForSubmission: mocks.countAiAttemptsForSubmission,
  countAiAttemptsForTeacherSince: mocks.countAiAttemptsForTeacherSince,
  latestAiAttemptCreatedAt: mocks.latestAiAttemptCreatedAt,
  listAiGradingAttemptsForSubmission: mocks.listAiGradingAttemptsForSubmission,
  createAiGradingAttempt: mocks.createAiGradingAttempt,
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
    mocks.createAiGradingAttempt.mockClear();
  });

  it("creates a suggestion attempt without saving a final grade", async () => {
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }), {
      params: Promise.resolve({ submissionId: "sub_1" }),
    });
    const body = (await response.json()) as { attempt: { suggestedScore: number; feedback: string } };

    expect(response.status).toBe(200);
    expect(body.attempt.suggestedScore).toBe(8);
    expect(body.attempt.feedback).toContain("Mock suggestion");
    expect(mocks.createAiGradingAttempt).toHaveBeenCalledOnce();
    expect(mocks.createAiGradingAttempt.mock.calls[0][0]).not.toHaveProperty("grade");
  });

  it("returns cooldown as a visible rate-limit state", async () => {
    mocks.latestAiAttemptCreatedAt.mockResolvedValueOnce(Date.now());
    const { POST } = await import("@/app/api/submissions/[submissionId]/ai-grade/route");

    const response = await POST(new Request("http://localhost/api/submissions/sub_1/ai-grade", { method: "POST" }), {
      params: Promise.resolve({ submissionId: "sub_1" }),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(429);
    expect(body.error).toContain("wait");
  });
});

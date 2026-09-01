import { beforeEach, describe, expect, it, vi } from "vitest";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  countAiAttemptsForTeacherSince: vi.fn(),
  countAiAttemptsSince: vi.fn(),
  getAiReviewAllowanceSummary: vi.fn(),
  listUngradedSubmissionsForAiGrade: vi.fn(),
  reserveGenerationBudget: vi.fn(),
  getAiConfig: vi.fn(),
  assertAiProviderConfig: vi.fn(),
  isAiTeacherDenied: vi.fn(),
  isLocalMockAi: vi.fn(),
  gradeOneSubmission: vi.fn(),
  getGradingConfig: vi.fn(),
  assertGradingProviderConfiguration: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/db", () => ({
  countAiAttemptsForTeacherSince: mocks.countAiAttemptsForTeacherSince,
  countAiAttemptsSince: mocks.countAiAttemptsSince,
  getAiReviewAllowanceSummary: mocks.getAiReviewAllowanceSummary,
  listUngradedSubmissionsForAiGrade: mocks.listUngradedSubmissionsForAiGrade,
}));

vi.mock("@/lib/ai/budget", () => ({
  reserveGenerationBudget: mocks.reserveGenerationBudget,
}));

vi.mock("@/lib/ai/config", () => ({
  getAiConfig: mocks.getAiConfig,
  assertAiProviderConfig: mocks.assertAiProviderConfig,
  isAiTeacherDenied: mocks.isAiTeacherDenied,
  isLocalMockAi: mocks.isLocalMockAi,
}));

vi.mock("@/lib/ai/grade-one", () => ({
  gradeOneSubmission: mocks.gradeOneSubmission,
}));

vi.mock("@/lib/grading/config", () => ({
  getGradingConfig: mocks.getGradingConfig,
  assertGradingProviderConfiguration: mocks.assertGradingProviderConfiguration,
}));

vi.mock("@/lib/http", () => {
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

const teacherAllowance = {
  teacherEmail: "teacher@example.com",
  status: "teacher_period" as const,
  limit: 300,
  reserved: 0,
  consumed: 300,
  used: 300,
  remaining: 0,
  stripeSubscriptionId: "sub_teacher",
  periodStart: 1_700_000_000_000,
  periodEnd: 1_702_592_000_000,
};

const pending = [
  {
    submissionId: "sub_1",
    studentName: "Student One",
    assignmentId: "asg_1",
    assignmentTitle: "Speaking",
    audioBlobUrl: "private/sub_1.webm",
    description: "",
    instructions: "Speak.",
    targetLanguage: "Spanish",
    rubric: null,
    maxPoints: 10,
    finalGrade: null,
    finalFeedback: "",
    hasPersistedTranscript: false,
    consumedTranscriptFingerprints: [],
  },
  {
    submissionId: "sub_2",
    studentName: "Student Two",
    assignmentId: "asg_1",
    assignmentTitle: "Speaking",
    audioBlobUrl: "private/sub_2.webm",
    description: "",
    instructions: "Speak.",
    targetLanguage: "Spanish",
    rubric: null,
    maxPoints: 10,
    finalGrade: null,
    finalFeedback: "",
    hasPersistedTranscript: false,
    consumedTranscriptFingerprints: [],
  },
];
const currentAssignmentFingerprint = processedAssignmentFingerprint(
  legacyAssignmentToGradingAssignment(pending[0]),
);

function request(method = "GET") {
  return new Request("https://tryhabla.com/api/assignments/asg_1/ai-grade-all", {
    method,
  });
}

const context = { params: Promise.resolve({ assignmentId: "asg_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAiConfig.mockReturnValue({
    enabled: true,
    bulkEnabled: true,
    accessMode: "paid",
    dailyTeacherLimit: 100,
    dailyGlobalLimit: 1_000,
    cooldownSeconds: 0,
  });
  mocks.requireTeacherEmail.mockResolvedValue("teacher@example.com");
  mocks.isAiTeacherDenied.mockReturnValue(false);
  mocks.isLocalMockAi.mockReturnValue(false);
  mocks.getGradingConfig.mockReturnValue({});
  mocks.countAiAttemptsForTeacherSince.mockResolvedValue(0);
  mocks.countAiAttemptsSince.mockResolvedValue(0);
  mocks.listUngradedSubmissionsForAiGrade.mockResolvedValue(pending);
  mocks.getAiReviewAllowanceSummary.mockResolvedValue(teacherAllowance);
  mocks.reserveGenerationBudget.mockResolvedValue(true);
});

describe("bulk AI allowance preflight", () => {
  it("fails once before auth or item work when provider configuration is incomplete", async () => {
    mocks.assertAiProviderConfig.mockImplementationOnce(() => {
      throw new Error("missing provider");
    });
    const { GET } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await GET(request(), context);

    expect(response.status).toBe(503);
    expect(mocks.requireTeacherEmail).not.toHaveBeenCalled();
    expect(mocks.listUngradedSubmissionsForAiGrade).not.toHaveBeenCalled();
  });

  it("rejects a denied teacher before returning a runnable item list", async () => {
    mocks.isAiTeacherDenied.mockReturnValueOnce(true);
    const { GET } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await GET(request(), context);

    expect(response.status).toBe(403);
    expect(mocks.listUngradedSubmissionsForAiGrade).not.toHaveBeenCalled();
  });

  it("marks a batch as not fitting when the Teacher-period allowance is exhausted", async () => {
    const { GET } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ungradedCount: 2,
      assignmentId: "asg_1",
      submissionIds: ["sub_1", "sub_2"],
      newUnitsRequired: 2,
      remaining: 100,
      fits: false,
      cooldownSeconds: 0,
      allowance: teacherAllowance,
    });
  });

  it("stops before provider budget or grading and returns the Schools CTA", async () => {
    const { POST } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await POST(request("POST"), context);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error:
        "This run needs 2 new AI-assisted recording units, but 0 remain in the current allowance. Need more? Explore TryHabla for Schools.",
    });
    expect(mocks.reserveGenerationBudget).not.toHaveBeenCalled();
    expect(mocks.gradeOneSubmission).not.toHaveBeenCalled();
  });

  it("allows grading saved transcripts when no new allowance units remain", async () => {
    mocks.listUngradedSubmissionsForAiGrade.mockResolvedValue(
      pending.map((item) => ({
        ...item,
        hasPersistedTranscript: true,
        consumedTranscriptFingerprints: [currentAssignmentFingerprint],
      })),
    );
    mocks.gradeOneSubmission.mockResolvedValue({
      status: "completed",
      gradeApplied: true,
      teacherAttention: "none",
      confidence: "high",
    });
    const { GET, POST } = await import(
      "@/app/api/assignments/[assignmentId]/ai-grade-all/route"
    );

    const preflight = await GET(request(), context);
    expect(preflight.status).toBe(200);
    await expect(preflight.json()).resolves.toMatchObject({
      ungradedCount: 2,
      newUnitsRequired: 0,
      fits: true,
    });

    const response = await POST(request("POST"), context);
    expect(response.status).toBe(200);
    expect(mocks.gradeOneSubmission).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an unmetered transcript", []],
    ["a stale assignment transcript", ["old-assignment-fingerprint"]],
  ])("still requires a unit for %s", async (_case, fingerprints) => {
    mocks.listUngradedSubmissionsForAiGrade.mockResolvedValue(
      pending.map((item) => ({
        ...item,
        hasPersistedTranscript: true,
        consumedTranscriptFingerprints: fingerprints,
      })),
    );
    const { GET } = await import(
      "@/app/api/assignments/[assignmentId]/ai-grade-all/route"
    );

    const response = await GET(request(), context);
    await expect(response.json()).resolves.toMatchObject({
      ungradedCount: 2,
      newUnitsRequired: 2,
      fits: false,
    });
  });

  it("does not bulk-regenerate a completed review-only result for the same assignment", async () => {
    mocks.listUngradedSubmissionsForAiGrade.mockResolvedValue([
      {
        ...pending[0],
        completedAttemptFingerprints: [currentAssignmentFingerprint],
      },
    ]);
    const { GET } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assignmentId: "asg_1",
      ungradedCount: 0,
      submissionIds: [],
      newUnitsRequired: 0,
      fits: false,
    });
  });

  it("fails closed before provider work when the Stripe period cannot be verified", async () => {
    mocks.getAiReviewAllowanceSummary.mockResolvedValue({
      ...teacherAllowance,
      status: "subscription_unavailable",
      limit: 0,
      consumed: 0,
      used: 0,
      remaining: 0,
    });
    const { POST } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await POST(request("POST"), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "The billing period could not be verified. Refresh billing or contact support before using another AI-assisted recording.",
    });
    expect(mocks.reserveGenerationBudget).not.toHaveBeenCalled();
    expect(mocks.gradeOneSubmission).not.toHaveBeenCalled();
  });
});

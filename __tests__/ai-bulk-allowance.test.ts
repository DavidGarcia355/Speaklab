import { beforeEach, describe, expect, it, vi } from "vitest";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";
import { createAiBatchConfirmationToken } from "@/lib/ai/batch-confirmation";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  countAiAttemptsForTeacherSince: vi.fn(),
  countAiAttemptsSince: vi.fn(),
  getAiReviewAllowanceSummary: vi.fn(),
  getAiGradingAssignmentFingerprint: vi.fn(),
  findActiveAiGradingBatchForAssignment: vi.fn(),
  createOrResumeAiGradingBatch: vi.fn(),
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
  getAiGradingAssignmentFingerprint: mocks.getAiGradingAssignmentFingerprint,
  findActiveAiGradingBatchForAssignment: mocks.findActiveAiGradingBatchForAssignment,
  createOrResumeAiGradingBatch: mocks.createOrResumeAiGradingBatch,
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
    consumedTranscriptFingerprints: [] as string[],
    completedAttemptFingerprints: [] as string[],
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
    consumedTranscriptFingerprints: [] as string[],
    completedAttemptFingerprints: [] as string[],
  },
];
const currentAssignmentFingerprint = processedAssignmentFingerprint(
  legacyAssignmentToGradingAssignment(pending[0]),
);

const queuedBatch = {
  id: "batch_1",
  teacherEmail: "teacher@example.com",
  assignmentId: "asg_1",
  assignmentTitle: "Speaking",
  assignmentFingerprint: currentAssignmentFingerprint,
  status: "queued" as const,
  eligibleCount: 2,
  newUnitsRequired: 2,
  transcriptsRequired: 2,
  savedTranscripts: 0,
  enhanced: false,
  counts: {
    total: 2,
    queued: 2,
    processing: 0,
    reviewReady: 0,
    failed: 0,
    skipped: 0,
    saved: 0,
    conflict: 0,
  },
  items: [],
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  savedAt: null,
};
const publicTeacherAllowance = {
  status: teacherAllowance.status,
  limit: teacherAllowance.limit,
  reserved: teacherAllowance.reserved,
  consumed: teacherAllowance.consumed,
  used: teacherAllowance.used,
  remaining: teacherAllowance.remaining,
  periodStart: teacherAllowance.periodStart,
  periodEnd: teacherAllowance.periodEnd,
};

function confirmationToken(items = pending) {
  return createAiBatchConfirmationToken({
    teacherEmail: "teacher@example.com",
    scope: {
      assignmentId: "asg_1",
      assignmentFingerprint: currentAssignmentFingerprint,
      submissionIds: items.map((item) => item.submissionId),
      eligibleCount: items.length,
      newUnitsRequired: items.filter((item) =>
        !item.consumedTranscriptFingerprints.includes(currentAssignmentFingerprint),
      ).length,
      transcriptsRequired: items.filter((item) => !item.hasPersistedTranscript).length,
    },
  });
}

function request(method = "GET", body?: unknown) {
  return new Request("https://tryhabla.com/api/assignments/asg_1/ai-grade-all", {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ assignmentId: "asg_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-ai-batch-confirmation-secret";
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
  mocks.getAiGradingAssignmentFingerprint.mockResolvedValue(currentAssignmentFingerprint);
  mocks.findActiveAiGradingBatchForAssignment.mockResolvedValue(null);
  mocks.createOrResumeAiGradingBatch.mockResolvedValue({
    status: "ready",
    created: true,
    batch: queuedBatch,
  });
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

  it("requires an explicit confirmation and valid idempotency key before reading assignment data", async () => {
    const { POST } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const unconfirmed = await POST(request("POST", { idempotencyKey: "click_1" }), context);
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.headers.get("cache-control")).toBe("private, no-store");
    await expect(unconfirmed.json()).resolves.toEqual({
      error: "Confirm the batch review before starting it.",
    });
    expect(mocks.getAiGradingAssignmentFingerprint).not.toHaveBeenCalled();
    expect(mocks.listUngradedSubmissionsForAiGrade).not.toHaveBeenCalled();

    const missingKey = await POST(request("POST", { confirmed: true }), context);
    expect(missingKey.status).toBe(400);
    await expect(missingKey.json()).resolves.toEqual({
      error: "A valid idempotency key is required.",
    });
    expect(mocks.createOrResumeAiGradingBatch).not.toHaveBeenCalled();
  });

  it("computes eligibility, saved transcripts, and required units from current live rows", async () => {
    mocks.getAiReviewAllowanceSummary.mockResolvedValue({
      ...teacherAllowance,
      consumed: 299,
      used: 299,
      remaining: 1,
    });
    mocks.listUngradedSubmissionsForAiGrade.mockResolvedValue([
      pending[0],
      {
        ...pending[1],
        hasPersistedTranscript: true,
        consumedTranscriptFingerprints: [currentAssignmentFingerprint],
      },
      {
        ...pending[0],
        submissionId: "sub_completed",
        completedAttemptFingerprints: [currentAssignmentFingerprint],
      },
    ]);
    const { GET } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toMatchObject({
      ungradedCount: 2,
      submissionIds: ["sub_1", "sub_2"],
      newUnitsRequired: 1,
      transcriptsRequired: 1,
      savedTranscripts: 1,
      fits: true,
      activeBatch: null,
    });
  });

  it("marks a batch as not fitting when the Teacher-period allowance is exhausted", async () => {
    const { GET } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ungradedCount: 2,
      assignmentId: "asg_1",
      submissionIds: ["sub_1", "sub_2"],
      newUnitsRequired: 2,
      transcriptsRequired: 2,
      savedTranscripts: 0,
      remaining: 100,
      fits: false,
      cooldownSeconds: 0,
      allowance: publicTeacherAllowance,
    });
    expect(Object.keys(payload.allowance).sort()).toEqual([
      "consumed", "limit", "periodEnd", "periodStart", "remaining", "reserved", "status", "used",
    ]);
  });

  it("returns exact structured allowance math before creating a batch", async () => {
    const nearlyExhaustedAllowance = {
      ...teacherAllowance,
      consumed: 299,
      used: 299,
      remaining: 1,
    };
    mocks.getAiReviewAllowanceSummary.mockResolvedValue(nearlyExhaustedAllowance);
    const { POST } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await POST(request("POST", {
      confirmed: true,
      idempotencyKey: "allowance-click",
      confirmationToken: confirmationToken(),
    }), context);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "This batch needs more AI-assisted recording units than are available.",
      code: "insufficient_allowance",
      eligibleCount: 2,
      requiredUnits: 2,
      availableUnits: 1,
      additionalUnits: 1,
      allowance: {
        ...publicTeacherAllowance,
        consumed: 299,
        used: 299,
        remaining: 1,
      },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.createOrResumeAiGradingBatch).not.toHaveBeenCalled();
    expect(mocks.reserveGenerationBudget).not.toHaveBeenCalled();
    expect(mocks.gradeOneSubmission).not.toHaveBeenCalled();
  });

  it("rejects a confirmed snapshot when the eligible submission scope changed", async () => {
    mocks.getAiReviewAllowanceSummary.mockResolvedValue({
      ...teacherAllowance,
      consumed: 0,
      used: 0,
      remaining: 300,
    });
    const { POST } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await POST(request("POST", {
      confirmed: true,
      idempotencyKey: "stale-confirmation-click",
      confirmationToken: confirmationToken([pending[0]]),
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "confirmation_scope_changed",
      preflight: {
        submissionIds: ["sub_1", "sub_2"],
        ungradedCount: 2,
        newUnitsRequired: 2,
        transcriptsRequired: 2,
        confirmationToken: expect.any(String),
      },
    });
    expect(mocks.createOrResumeAiGradingBatch).not.toHaveBeenCalled();
  });

  it("allows grading saved transcripts when no new allowance units remain", async () => {
    const savedTranscriptItems = pending.map((item) => ({
        ...item,
        hasPersistedTranscript: true,
        consumedTranscriptFingerprints: [currentAssignmentFingerprint],
      }));
    mocks.listUngradedSubmissionsForAiGrade.mockResolvedValue(savedTranscriptItems);
    const { GET, POST } = await import(
      "@/app/api/assignments/[assignmentId]/ai-grade-all/route"
    );

    const preflight = await GET(request(), context);
    expect(preflight.status).toBe(200);
    await expect(preflight.json()).resolves.toMatchObject({
      ungradedCount: 2,
      newUnitsRequired: 0,
      transcriptsRequired: 0,
      savedTranscripts: 2,
      fits: true,
    });

    const response = await POST(request("POST", {
      confirmed: true,
      idempotencyKey: "saved-transcript-click",
      confirmationToken: confirmationToken(savedTranscriptItems),
    }), context);
    expect(response.status).toBe(201);
    expect(mocks.createOrResumeAiGradingBatch).toHaveBeenCalledWith({
      assignmentId: "asg_1",
      teacherEmail: "teacher@example.com",
      assignmentFingerprint: currentAssignmentFingerprint,
      idempotencyKey: "saved-transcript-click",
      expectedSubmissionIds: ["sub_1", "sub_2"],
      newUnitsRequired: 0,
      transcriptsRequired: 0,
      enhanced: false,
    });
    expect(mocks.gradeOneSubmission).not.toHaveBeenCalled();
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

  it("resumes an owned active batch even when today's fresh-run allowance is exhausted", async () => {
    mocks.findActiveAiGradingBatchForAssignment.mockResolvedValue(queuedBatch);
    const { GET, POST } = await import(
      "@/app/api/assignments/[assignmentId]/ai-grade-all/route"
    );

    const preflight = await GET(request(), context);
    expect(preflight.status).toBe(200);
    await expect(preflight.json()).resolves.toMatchObject({
      fits: true,
      activeBatch: { id: "batch_1", status: "queued", eligibleCount: 2 },
    });

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
    mocks.getGradingConfig.mockReturnValue({});
    mocks.getAiGradingAssignmentFingerprint.mockResolvedValue(currentAssignmentFingerprint);
    mocks.findActiveAiGradingBatchForAssignment.mockResolvedValue(queuedBatch);

    const response = await POST(request("POST", {
      confirmed: true,
      idempotencyKey: "duplicate-click",
    }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      created: false,
      batch: { id: "batch_1", status: "queued" },
    });
    expect(mocks.listUngradedSubmissionsForAiGrade).not.toHaveBeenCalled();
    expect(mocks.getAiReviewAllowanceSummary).not.toHaveBeenCalled();
    expect(mocks.createOrResumeAiGradingBatch).not.toHaveBeenCalled();
  });

  it("returns a structured daily-limit error before durable creation", async () => {
    mocks.getAiReviewAllowanceSummary.mockResolvedValue({
      ...teacherAllowance,
      consumed: 0,
      used: 0,
      remaining: 300,
    });
    mocks.countAiAttemptsForTeacherSince.mockResolvedValue(100);
    const { POST } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await POST(request("POST", {
      confirmed: true,
      idempotencyKey: "daily-limit-click",
      confirmationToken: confirmationToken(),
    }), context);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "This batch exceeds the remaining daily AI generation limit.",
      code: "daily_generation_limit",
      eligibleCount: 2,
      requiredGenerations: 2,
      availableGenerations: 0,
    });
    expect(mocks.createOrResumeAiGradingBatch).not.toHaveBeenCalled();
  });

  it("passes one confirmed enhanced request into durable idempotent creation", async () => {
    mocks.getAiReviewAllowanceSummary.mockResolvedValue({
      ...teacherAllowance,
      consumed: 0,
      used: 0,
      remaining: 300,
    });
    const { POST } = await import("@/app/api/assignments/[assignmentId]/ai-grade-all/route");

    const response = await POST(request("POST", {
      confirmed: true,
      idempotencyKey: "click_once",
      enhanced: true,
      confirmationToken: confirmationToken(),
    }), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      batch: { id: "batch_1", status: "queued" },
    });
    expect(mocks.createOrResumeAiGradingBatch).toHaveBeenCalledOnce();
    expect(mocks.createOrResumeAiGradingBatch).toHaveBeenCalledWith({
      assignmentId: "asg_1",
      teacherEmail: "teacher@example.com",
      assignmentFingerprint: currentAssignmentFingerprint,
      idempotencyKey: "click_once",
      expectedSubmissionIds: ["sub_1", "sub_2"],
      newUnitsRequired: 2,
      transcriptsRequired: 2,
      enhanced: true,
    });
    expect(mocks.gradeOneSubmission).not.toHaveBeenCalled();
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

    const response = await POST(request("POST", {
      confirmed: true,
      idempotencyKey: "billing-sync-click",
      confirmationToken: confirmationToken(),
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "The billing period could not be verified before starting this batch.",
      code: "billing_sync_required",
      eligibleCount: 2,
      requiredUnits: 2,
      availableUnits: 0,
      additionalUnits: 2,
      allowance: {
        ...publicTeacherAllowance,
        status: "subscription_unavailable",
        limit: 0,
        consumed: 0,
        used: 0,
        remaining: 0,
      },
    });
    expect(mocks.createOrResumeAiGradingBatch).not.toHaveBeenCalled();
    expect(mocks.reserveGenerationBudget).not.toHaveBeenCalled();
    expect(mocks.gradeOneSubmission).not.toHaveBeenCalled();
  });
});

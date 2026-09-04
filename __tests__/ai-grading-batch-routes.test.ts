import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  findBatch: vi.fn(),
  allowance: vi.fn(),
  assignmentFingerprint: vi.fn(),
  claimNext: vi.fn(),
  countForSubmission: vi.fn(),
  reserveDailyQuota: vi.fn(),
  releaseDailyQuota: vi.fn(),
  findSubmission: vi.fn(),
  findTeacher: vi.fn(),
  tooLong: vi.fn(),
  latestAttempt: vi.fn(),
  markFailed: vi.fn(),
  saveBatch: vi.fn(),
  getAiConfig: vi.fn(),
  isLocalMockAi: vi.fn(),
  isTeacherDenied: vi.fn(),
  assertAiProviderConfig: vi.fn(),
  getGradingConfig: vi.fn(),
  assertGradingProviderConfiguration: vi.fn(),
  gradeOne: vi.fn(),
  enqueueAlerts: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/db", () => ({
  findAiGradingBatchForOwner: mocks.findBatch,
  getAiReviewAllowanceSummary: mocks.allowance,
  getAiGradingAssignmentFingerprint: mocks.assignmentFingerprint,
  claimNextAiGradingBatchItem: mocks.claimNext,
  countAiAttemptsForSubmission: mocks.countForSubmission,
  reserveAiDailyGenerationQuota: mocks.reserveDailyQuota,
  releaseAiDailyGenerationQuota: mocks.releaseDailyQuota,
  findSubmissionForAiGrade: mocks.findSubmission,
  findTeacherFunnelRowByEmail: mocks.findTeacher,
  hasAudioTooLongFailure: mocks.tooLong,
  latestAiAttemptCreatedAt: mocks.latestAttempt,
  markAiGradingBatchItemFailed: mocks.markFailed,
  saveAiGradingBatch: mocks.saveBatch,
}));

vi.mock("@/lib/ai/config", () => ({
  getAiConfig: mocks.getAiConfig,
  isLocalMockAi: mocks.isLocalMockAi,
  isAiTeacherDenied: mocks.isTeacherDenied,
  assertAiProviderConfig: mocks.assertAiProviderConfig,
}));

vi.mock("@/lib/grading/config", () => ({
  getGradingConfig: mocks.getGradingConfig,
  assertGradingProviderConfiguration: mocks.assertGradingProviderConfiguration,
}));

vi.mock("@/lib/ai/grade-one", () => ({
  gradeOneSubmission: mocks.gradeOne,
}));

vi.mock("@/lib/admin-alert-lifecycle", () => ({
  enqueueSuccessfulAiReviewAlerts: mocks.enqueueAlerts,
}));

vi.mock("@/lib/http", () => ({
  HttpError: class MockHttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        return Response.json(
          { error: error.message },
          { status: (error as Error & { status: number }).status },
        );
      }
      throw error;
    }
  },
}));

const teacherEmail = "teacher@example.com";
const assignmentFingerprint = "assignment-fingerprint";

function batch(
  status: "queued" | "processing" | "review_ready" | "partial_failure" | "saved" = "queued",
) {
  const itemStatus = status === "review_ready"
    ? "review_ready"
    : status === "saved"
      ? "saved"
      : status === "partial_failure"
        ? "failed"
        : "queued";
  return {
    id: "batch_1",
    teacherEmail,
    assignmentId: "assignment_1",
    assignmentTitle: "Speaking check",
    assignmentFingerprint,
    status,
    eligibleCount: 1,
    newUnitsRequired: 1,
    transcriptsRequired: 1,
    savedTranscripts: 0,
    enhanced: false,
    counts: {
      total: 1,
      queued: itemStatus === "queued" ? 1 : 0,
      processing: 0,
      reviewReady: itemStatus === "review_ready" ? 1 : 0,
      failed: itemStatus === "failed" ? 1 : 0,
      skipped: 0,
      saved: itemStatus === "saved" ? 1 : 0,
      conflict: 0,
    },
    items: [{
      id: "item_1",
      batchId: "batch_1",
      submissionId: "submission_1",
      studentName: "Alex Rivera",
      studentEmail: "alex@example.test",
      submittedAt: 1,
      ordinal: 0,
      status: itemStatus,
      attemptId: null,
      attempt: null,
      errorCode: itemStatus === "failed" ? "provider_error" : "",
      errorMessage: itemStatus === "failed" ? "Provider unavailable." : "",
      retryCount: 0,
      teacherEdited: false,
      draft: { grade: null, rubricScores: null, feedback: "" },
      updatedAt: 1,
    }],
    createdAt: 1,
    updatedAt: 1,
    completedAt: ["review_ready", "partial_failure"].includes(status) ? 2 : null,
    savedAt: status === "saved" ? 3 : null,
  };
}

const submission = {
  submissionId: "submission_1",
  assignmentId: "assignment_1",
  assignmentTitle: "Speaking check",
  audioBlobUrl: "submissions/submission_1.webm",
  description: "",
  instructions: "Speak in Spanish.",
  targetLanguage: "Spanish",
  rubric: null,
  maxPoints: 20,
  finalGrade: null,
  finalGradeSource: "teacher",
  finalFeedback: "",
};

const completedAttempt = {
  id: "attempt_1",
  status: "completed",
  transcript: "Hola.",
  detectedLanguage: "Spanish",
  transcriptQuality: "good",
  durationSeconds: 4,
  suggestedScore: 17,
  rubricScores: [],
  feedback: "Clear response.",
  strengths: ["Clear"],
  improvements: [],
  evidence: ["Hola"],
  confidence: "high",
  warnings: [],
  teacherAttention: "review",
  errorMessage: "",
  resultSource: "ai",
  estimatedCostMicrousd: 10,
  createdAt: 1,
  completedAt: 2,
};

function getRequest() {
  return new Request("https://tryhabla.com/api/ai-grading-batches/batch_1");
}

function postRequest(path: string, body?: unknown) {
  return new Request(`https://tryhabla.com${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ batchId: "batch_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTeacherEmail.mockResolvedValue(teacherEmail);
  mocks.findBatch.mockResolvedValue(batch());
  mocks.allowance.mockResolvedValue({
    teacherEmail,
    status: "free_lifetime",
    limit: 30,
    reserved: 0,
    consumed: 1,
    used: 1,
    remaining: 29,
    stripeSubscriptionId: "sub_secret",
    periodStart: null,
    periodEnd: null,
  });
  mocks.assignmentFingerprint.mockResolvedValue(assignmentFingerprint);
  mocks.getAiConfig.mockReturnValue({
    enabled: true,
    bulkEnabled: true,
    accessMode: "paid",
    dailyTeacherLimit: 100,
    dailyGlobalLimit: 1_000,
    maxGenerationsPerSubmission: 10,
    cooldownSeconds: 0,
  });
  mocks.isLocalMockAi.mockReturnValue(false);
  mocks.isTeacherDenied.mockReturnValue(false);
  mocks.getGradingConfig.mockReturnValue({});
  mocks.reserveDailyQuota.mockResolvedValue({
    status: "reserved",
    reservationId: "quota_1",
  });
  mocks.releaseDailyQuota.mockResolvedValue(true);
  mocks.countForSubmission.mockResolvedValue(0);
  mocks.latestAttempt.mockResolvedValue(null);
  mocks.tooLong.mockResolvedValue(false);
  mocks.findSubmission.mockResolvedValue(submission);
  mocks.markFailed.mockResolvedValue(true);
  mocks.findTeacher.mockResolvedValue({ joinedAt: 1 });
  mocks.enqueueAlerts.mockResolvedValue(undefined);
});

describe("AI grading batch read route", () => {
  it.each([
    [401, "You'll need to sign in first."],
    [403, "You don't have access to this page."],
  ])("rejects unauthorized access with %i before reading a batch", async (status, message) => {
    mocks.requireTeacherEmail.mockRejectedValueOnce(
      Object.assign(new Error(message), { status }),
    );
    const { GET } = await import("@/app/api/ai-grading-batches/[batchId]/route");

    const response = await GET(getRequest(), context);

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findBatch).not.toHaveBeenCalled();
  });

  it("reads only through the authenticated owner and returns a private checkpoint", async () => {
    const { GET } = await import("@/app/api/ai-grading-batches/[batchId]/route");

    const response = await GET(getRequest(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toMatchObject({
      batch: { id: "batch_1", status: "queued", transcriptsRequired: 1 },
      allowance: {
        status: "free_lifetime",
        limit: 30,
        reserved: 0,
        consumed: 1,
        used: 1,
        remaining: 29,
        periodStart: null,
        periodEnd: null,
      },
    });
    expect(Object.keys(payload.allowance).sort()).toEqual([
      "consumed", "limit", "periodEnd", "periodStart", "remaining", "reserved", "status", "used",
    ]);
    expect(mocks.findBatch).toHaveBeenCalledWith("batch_1", teacherEmail);
  });

  it("does not disclose a batch outside the authenticated owner's scope", async () => {
    mocks.findBatch.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/ai-grading-batches/[batchId]/route");

    const response = await GET(getRequest(), context);

    expect(response.status).toBe(404);
    expect(mocks.findBatch).toHaveBeenCalledWith("batch_1", teacherEmail);
  });
});

describe("AI grading batch worker route", () => {
  it("stages one claimed item in suggestion-only mode without using the legacy apply path", async () => {
    const queued = batch("queued");
    const ready = batch("review_ready");
    mocks.findBatch.mockResolvedValueOnce(queued).mockResolvedValueOnce(ready);
    mocks.claimNext.mockResolvedValue({
      status: "claimed",
      item: {
        batchId: "batch_1",
        itemId: "item_1",
        submissionId: "submission_1",
        leaseToken: "lease_1",
        enhanced: false,
      },
    });
    mocks.gradeOne.mockResolvedValue({
      status: "completed",
      attemptId: "attempt_1",
      attempt: completedAttempt,
      teacherAttention: "review",
      confidence: "high",
      gradeApplied: false,
    });
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/next/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/next", { retryFailed: false }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      processedItemId: "item_1",
      done: true,
      batch: { status: "review_ready", counts: { reviewReady: 1 } },
    });
    expect(mocks.gradeOne).toHaveBeenCalledWith(expect.objectContaining({
      teacherEmail,
      data: submission,
      deliveryMode: "suggestion_only",
      batchSuggestion: { itemId: "item_1", leaseToken: "lease_1" },
    }));
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.releaseDailyQuota).toHaveBeenCalledWith({
      reservationId: "quota_1",
      teacherEmail,
    });
  });

  it("forwards an explicit failed-only retry to the durable lease claim", async () => {
    const partial = batch("partial_failure");
    mocks.findBatch.mockResolvedValueOnce(partial).mockResolvedValueOnce(partial);
    mocks.claimNext.mockResolvedValue({ status: "done", item: null });
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/next/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/next", { retryFailed: true }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.claimNext).toHaveBeenCalledWith({
      batchId: "batch_1",
      teacherEmail,
      assignmentFingerprint,
      retryFailed: true,
    });
    expect(mocks.gradeOne).not.toHaveBeenCalled();
  });

  it("persists a per-item provider failure and returns the resumable partial checkpoint", async () => {
    const queued = batch("queued");
    const partial = batch("partial_failure");
    mocks.findBatch.mockResolvedValueOnce(queued).mockResolvedValueOnce(partial);
    mocks.claimNext.mockResolvedValue({
      status: "claimed",
      item: {
        batchId: "batch_1",
        itemId: "item_1",
        submissionId: "submission_1",
        leaseToken: "lease_1",
        enhanced: false,
      },
    });
    mocks.gradeOne.mockResolvedValue({
      status: "failed",
      code: "provider_error",
      message: "Provider unavailable.",
    });
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/next/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/next", {}),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      processedItemId: "item_1",
      done: true,
      batch: { status: "partial_failure", counts: { failed: 1 } },
    });
    expect(mocks.markFailed).toHaveBeenCalledWith({
      itemId: "item_1",
      leaseToken: "lease_1",
      teacherEmail,
      status: "failed",
      errorCode: "provider_error",
      errorMessage: "Provider unavailable.",
    });
  });

  it("fails closed on an assignment edit before claiming provider work", async () => {
    mocks.assignmentFingerprint.mockResolvedValueOnce("new-fingerprint");
    mocks.claimNext.mockResolvedValueOnce({ status: "assignment_changed", item: null });
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/next/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/next", {}),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "assignment_changed" });
    expect(mocks.gradeOne).not.toHaveBeenCalled();
  });

  it("enforces current teacher quota before taking a lease", async () => {
    mocks.reserveDailyQuota.mockResolvedValueOnce({ status: "teacher_limit" });
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/next/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/next", {}),
      context,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "daily_teacher_limit",
      batch: { id: "batch_1" },
    });
    expect(mocks.claimNext).not.toHaveBeenCalled();
    expect(mocks.gradeOne).not.toHaveBeenCalled();
  });
});

describe("AI grading batch save route", () => {
  const editedItems = [{
    itemId: "item_1",
    grade: 18,
    feedback: "Teacher-edited feedback.",
    rubricScores: null,
  }];

  it("requires explicit confirmation and a complete item array before reading the batch", async () => {
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/save/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/save", { items: editedItems }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.findBatch).not.toHaveBeenCalled();
    expect(mocks.saveBatch).not.toHaveBeenCalled();
  });

  it("passes edited review values into one explicit owner-scoped atomic save", async () => {
    const ready = batch("review_ready");
    const saved = batch("saved");
    mocks.findBatch.mockResolvedValueOnce(ready).mockResolvedValueOnce(saved);
    mocks.saveBatch.mockResolvedValue({ status: "saved", batchId: "batch_1" });
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/save/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/save", {
        confirmed: true,
        items: editedItems,
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      saved: true,
      batch: { status: "saved", counts: { saved: 1 } },
    });
    expect(mocks.saveBatch).toHaveBeenCalledOnce();
    expect(mocks.saveBatch).toHaveBeenCalledWith({
      batchId: "batch_1",
      teacherEmail,
      assignmentFingerprint,
      items: editedItems,
    });
  });

  it("treats a duplicate final-save request as a successful idempotent no-op", async () => {
    const saved = batch("saved");
    mocks.findBatch.mockResolvedValue(saved);
    mocks.saveBatch.mockResolvedValue({ status: "already_saved", batchId: "batch_1" });
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/save/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/save", {
        confirmed: true,
        items: editedItems,
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ saved: false, batch: { status: "saved" } });
  });

  it.each([
    [
      { status: "not_ready", batchId: "batch_1", message: "One item is still processing." },
      409,
      "pending_items",
    ],
    [
      { status: "invalid", batchId: "batch_1", message: "The score is outside the assignment range." },
      400,
      "invalid_batch_draft",
    ],
  ])("maps a rejected atomic save to a structured response", async (result, status, code) => {
    const ready = batch("review_ready");
    mocks.findBatch.mockResolvedValue(ready);
    mocks.saveBatch.mockResolvedValue(result);
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/save/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/save", {
        confirmed: true,
        items: editedItems,
      }),
      context,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code, batch: { id: "batch_1" } });
  });

  it("reports teacher-edit conflicts without overwriting or hiding the affected rows", async () => {
    const ready = batch("review_ready");
    const conflicted = {
      ...ready,
      status: "partial_failure" as const,
      counts: { ...ready.counts, reviewReady: 0, conflict: 1 },
      items: ready.items.map((entry) => ({
        ...entry,
        status: "conflict" as const,
        errorCode: "submission_changed",
      })),
    };
    mocks.findBatch.mockResolvedValueOnce(ready).mockResolvedValueOnce(conflicted);
    mocks.saveBatch.mockResolvedValue({
      status: "submission_changed",
      batchId: "batch_1",
      conflictItemIds: ["item_1"],
    });
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/save/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/save", {
        confirmed: true,
        items: editedItems,
      }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "submission_changed",
      conflictItemIds: ["item_1"],
      batch: { counts: { conflict: 1 } },
    });
  });

  it("fails before atomic save when the live assignment fingerprint changed", async () => {
    mocks.findBatch.mockResolvedValueOnce(batch("review_ready"));
    mocks.assignmentFingerprint.mockResolvedValueOnce("new-fingerprint");
    const { POST } = await import("@/app/api/ai-grading-batches/[batchId]/save/route");

    const response = await POST(
      postRequest("/api/ai-grading-batches/batch_1/save", {
        confirmed: true,
        items: editedItems,
      }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "assignment_changed" });
    expect(mocks.saveBatch).not.toHaveBeenCalled();
  });
});

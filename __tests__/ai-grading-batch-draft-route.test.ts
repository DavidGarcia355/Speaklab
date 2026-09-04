import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  findBatch: vi.fn(),
  assignmentFingerprint: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/db", () => ({
  findAiGradingBatchForOwner: mocks.findBatch,
  getAiGradingAssignmentFingerprint: mocks.assignmentFingerprint,
  saveAiGradingBatchDraft: mocks.saveDraft,
}));

vi.mock("@/app/api/ai-grading-batches/_shared", () => ({
  publicAiGradingBatch: (batch: unknown) => batch,
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

import { PATCH } from "@/app/api/ai-grading-batches/[batchId]/draft/route";

const teacherEmail = "teacher@example.test";
const assignmentFingerprint = "assignment-fingerprint";
const batch = {
  id: "batch_1",
  teacherEmail,
  assignmentId: "assignment_1",
  assignmentFingerprint,
  status: "review_ready",
  items: [],
};
const items = [{
  itemId: "item_1",
  grade: 18,
  feedback: "Teacher-edited draft.",
  rubricScores: null,
}];

function request(body: unknown) {
  return new Request("http://localhost/api/ai-grading-batches/batch_1/draft", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(batchId = "batch_1") {
  return { params: Promise.resolve({ batchId }) };
}

describe("private batch AI review-draft route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTeacherEmail.mockResolvedValue(teacherEmail);
    mocks.findBatch.mockResolvedValue(batch);
    mocks.assignmentFingerprint.mockResolvedValue(assignmentFingerprint);
    mocks.saveDraft.mockResolvedValue({
      status: "updated",
      batchId: batch.id,
      itemIds: ["item_1"],
    });
  });

  it("requires teacher authentication before reading or writing a batch", async () => {
    mocks.requireTeacherEmail.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );

    const response = await PATCH(request({ items }), context());

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.findBatch).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("does not expose or mutate another teacher's batch", async () => {
    mocks.findBatch.mockResolvedValueOnce(null);

    const response = await PATCH(request({ items }), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "AI grading batch not found." });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("persists only validated draft data and returns a private fresh batch", async () => {
    const updatedBatch = {
      ...batch,
      items: [{ id: "item_1", draft: { grade: 18, feedback: items[0].feedback } }],
    };
    mocks.findBatch
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce(updatedBatch);

    const response = await PATCH(request({ items }), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.saveDraft).toHaveBeenCalledWith({
      batchId: "batch_1",
      teacherEmail,
      assignmentFingerprint,
      items,
    });
    expect(await response.json()).toEqual({ batch: updatedBatch });
  });

  it("rejects stale assignment state before writing a draft", async () => {
    mocks.assignmentFingerprint.mockResolvedValue("new-fingerprint");

    const response = await PATCH(request({ items }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "assignment_changed",
      batch,
    });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid", 400, "invalid_batch_draft"],
    ["not_ready", 409, "batch_draft_not_ready"],
  ] as const)("maps a %s DB result without publishing anything", async (status, expectedStatus, code) => {
    mocks.saveDraft.mockResolvedValue(
      status === "invalid"
        ? { status, batchId: batch.id, message: "Score is out of range." }
        : { status, batchId: batch.id },
    );

    const response = await PATCH(request({ items }), context());

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toMatchObject({ code });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

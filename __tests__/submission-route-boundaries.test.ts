import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  findSubmissionById: vi.fn(),
  findAssignmentById: vi.fn(),
  updateSubmission: vi.fn(),
  deleteSubmission: vi.fn(),
  parseOrThrow400: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/db", () => ({
  findSubmissionById: mocks.findSubmissionById,
  findAssignmentById: mocks.findAssignmentById,
  updateSubmission: mocks.updateSubmission,
  deleteSubmission: mocks.deleteSubmission,
}));

vi.mock("@/lib/validation", () => ({
  parseOrThrow400: mocks.parseOrThrow400,
  submissionPatchSchema: {},
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

const context = { params: Promise.resolve({ submissionId: "submission_1" }) };
const existingSubmission = {
  id: "submission_1",
  assignmentId: "assignment_1",
  assignmentTitle: "Speaking check",
  studentName: "Student One",
  studentEmail: "student@example.com",
  audioData: "/api/submissions/submission_1/audio",
  submittedAt: 1,
  feedback: "",
  grade: null,
  rubricScores: null,
};

function patchRequest() {
  return new Request("http://localhost/api/submissions/submission_1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback: "Clear response" }),
  });
}

describe("teacher submission route authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTeacherEmail.mockResolvedValue("teacher@example.com");
    mocks.findSubmissionById.mockResolvedValue(existingSubmission);
    mocks.updateSubmission.mockResolvedValue({
      ...existingSubmission,
      feedback: "Clear response",
    });
    mocks.deleteSubmission.mockResolvedValue(true);
    mocks.parseOrThrow400.mockReturnValue({ feedback: "Clear response" });
  });

  it.each([
    [401, "You'll need to sign in first."],
    [403, "You don't have access to this page."],
  ])("rejects a non-teacher with %i before reading submission data", async (status, message) => {
    mocks.requireTeacherEmail.mockRejectedValueOnce(
      Object.assign(new Error(message), { status }),
    );
    const { PATCH } = await import("@/app/api/submissions/[submissionId]/route");

    const response = await PATCH(patchRequest(), context);

    expect(response.status).toBe(status);
    expect(mocks.findSubmissionById).not.toHaveBeenCalled();
    expect(mocks.updateSubmission).not.toHaveBeenCalled();
  });

  it("does not update a submission outside the teacher's ownership scope", async () => {
    mocks.findSubmissionById.mockResolvedValueOnce(null);
    const { PATCH } = await import("@/app/api/submissions/[submissionId]/route");

    const response = await PATCH(patchRequest(), context);

    expect(response.status).toBe(404);
    expect(mocks.findSubmissionById).toHaveBeenCalledWith(
      "submission_1",
      "teacher@example.com",
    );
    expect(mocks.updateSubmission).not.toHaveBeenCalled();
  });

  it("does not report success when the owned submission disappears during update", async () => {
    mocks.updateSubmission.mockResolvedValueOnce(null);
    const { PATCH } = await import("@/app/api/submissions/[submissionId]/route");

    const response = await PATCH(patchRequest(), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Submission not found." });
  });

  it("does not delete a submission outside the teacher's ownership scope", async () => {
    mocks.findSubmissionById.mockResolvedValueOnce(null);
    const { DELETE } = await import("@/app/api/submissions/[submissionId]/route");

    const response = await DELETE(
      new Request("http://localhost/api/submissions/submission_1", { method: "DELETE" }),
      context,
    );

    expect(response.status).toBe(404);
    expect(mocks.deleteSubmission).not.toHaveBeenCalled();
  });
});

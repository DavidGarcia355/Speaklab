import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignmentCreateSchema,
  parseOrThrow400,
  rubricTotalPoints,
  submissionPatchSchema,
} from "@/lib/validation";
import { POST as createAssignmentRoute } from "@/app/api/classes/[classId]/assignments/route";
import { PATCH as updateAssignmentRoute } from "@/app/api/assignments/[assignmentId]/route";
import { PATCH as patchSubmissionRoute } from "@/app/api/submissions/[submissionId]/route";
import { GET as gradebookRoute } from "@/app/api/classes/[classId]/gradebook.csv/route";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  uploadAssignmentAttachment: vi.fn(),
  createAssignment: vi.fn(),
  findClassById: vi.fn(),
  findAssignmentById: vi.fn(),
  updateAssignment: vi.fn(),
  findSubmissionById: vi.fn(),
  updateSubmission: vi.fn(),
  deleteAssignmentCascade: vi.fn(),
  deleteSubmission: vi.fn(),
  listGradebookRowsByClassId: vi.fn(),
  enforceGradebookRateLimit: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/attachment-storage", () => ({
  uploadAssignmentAttachment: mocks.uploadAssignmentAttachment,
}));

vi.mock("@/lib/db", () => ({
  createAssignment: mocks.createAssignment,
  findClassById: mocks.findClassById,
  findAssignmentById: mocks.findAssignmentById,
  updateAssignment: mocks.updateAssignment,
  findSubmissionById: mocks.findSubmissionById,
  updateSubmission: mocks.updateSubmission,
  deleteAssignmentCascade: mocks.deleteAssignmentCascade,
  deleteSubmission: mocks.deleteSubmission,
  listGradebookRowsByClassId: mocks.listGradebookRowsByClassId,
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceGradebookRateLimit: mocks.enforceGradebookRateLimit,
}));

vi.mock("@/lib/activity", () => ({
  trackActivity: vi.fn().mockResolvedValue(undefined),
  buildTeacherEventMetadata: vi.fn().mockResolvedValue({
    isFirstClass: true,
    isFirstAssignment: true,
  }),
}));

vi.mock("@/lib/http", async () => {
  class MockHttpError extends Error {
    status: number;
    fieldErrors?: Record<string, string[]>;

    constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
      super(message);
      this.status = status;
      this.fieldErrors = fieldErrors;
    }
  }

  return {
    HttpError: MockHttpError,
    withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        if (error instanceof MockHttpError) {
          return Response.json(
            error.fieldErrors
              ? { error: error.message, fieldErrors: error.fieldErrors }
              : { error: error.message },
            { status: error.status }
          );
        }
        throw error;
      }
    },
  };
});

describe("rubric validation", () => {
  it("keeps assignment create valid without a rubric", () => {
    const parsed = parseOrThrow400(assignmentCreateSchema, {
      title: "Speaking check",
      description: "",
      instructions: "Say your name in Spanish.",
      maxPoints: 20,
    });

    expect(parsed.rubric).toBeUndefined();
    expect(parsed.maxPoints).toBe(20);
  });

  it("accepts a valid rubric and derives its total", () => {
    const parsed = parseOrThrow400(assignmentCreateSchema, {
      title: "Oral practice",
      description: "",
      instructions: "Respond in Spanish.",
      maxPoints: 999,
      rubric: {
        title: "Speaking rubric",
        criteria: [
          { id: "c1", name: "Pronunciation", description: "Clear sounds", maxPoints: 10 },
          { id: "c2", name: "Fluency", description: "Natural pace", maxPoints: 8 },
        ],
      },
    });

    expect(parsed.rubric?.criteria).toHaveLength(2);
    expect(rubricTotalPoints(parsed.rubric!)).toBe(18);
  });

  it("rejects invalid rubric shapes", () => {
    expect(() =>
      parseOrThrow400(assignmentCreateSchema, {
        title: "Oral practice",
        description: "",
        instructions: "Respond in Spanish.",
        maxPoints: 10,
        rubric: { title: "Bad rubric", criteria: [] },
      })
    ).toThrow();

    expect(() =>
      parseOrThrow400(assignmentCreateSchema, {
        title: "Oral practice",
        description: "",
        instructions: "Respond in Spanish.",
        maxPoints: 10,
        rubric: {
          title: "Bad rubric",
          criteria: [{ id: "c1", name: "Pronunciation", description: "", maxPoints: 0 }],
        },
      })
    ).toThrow();

    expect(() =>
      parseOrThrow400(assignmentCreateSchema, {
        title: "Oral practice",
        description: "",
        instructions: "Respond in Spanish.",
        maxPoints: 10,
        rubric: {
          title: "Too many",
          criteria: Array.from({ length: 9 }, (_, index) => ({
            id: `c${index}`,
            name: `Criterion ${index}`,
            description: "",
            maxPoints: 1,
          })),
        },
      })
    ).toThrow();
  });
});

describe("rubric routes", () => {
  beforeEach(() => {
    mocks.requireTeacherEmail.mockReset();
    mocks.uploadAssignmentAttachment.mockReset();
    mocks.createAssignment.mockReset();
    mocks.findClassById.mockReset();
    mocks.findAssignmentById.mockReset();
    mocks.updateAssignment.mockReset();
    mocks.findSubmissionById.mockReset();
    mocks.updateSubmission.mockReset();
    mocks.listGradebookRowsByClassId.mockReset();
    mocks.enforceGradebookRateLimit.mockReset();

    mocks.requireTeacherEmail.mockResolvedValue("teacher@example.com");
    mocks.findClassById.mockResolvedValue({ id: "class_1", name: "Spanish 1" });
    mocks.findAssignmentById.mockResolvedValue({
      id: "asg_1",
      classId: "class_1",
      className: "Spanish 1",
      ownerEmail: "teacher@example.com",
      title: "Assignment",
      description: "",
      instructions: "Speak",
      maxPoints: 20,
      rubric: {
        title: "Speaking rubric",
        criteria: [
          { id: "c1", name: "Pronunciation", description: "", maxPoints: 10 },
          { id: "c2", name: "Fluency", description: "", maxPoints: 10 },
        ],
      },
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
      createdAt: Date.now(),
    });
    mocks.findSubmissionById.mockResolvedValue({
      id: "sub_1",
      assignmentId: "asg_1",
      assignmentTitle: "Assignment",
      studentName: "Student",
      studentEmail: "student@example.com",
      audioData: "/api/submissions/sub_1/audio",
      submittedAt: Date.now(),
      feedback: "",
      grade: null,
      rubricScores: null,
    });
    mocks.updateSubmission.mockImplementation(async (_submissionId, _teacherEmail, input) => ({
      id: "sub_1",
      assignmentId: "asg_1",
      assignmentTitle: "Assignment",
      studentName: input.studentName,
      studentEmail: "student@example.com",
      audioData: "/api/submissions/sub_1/audio",
      submittedAt: Date.now(),
      feedback: input.feedback,
      grade: input.grade,
      rubricScores: input.rubricScores,
    }));
  });

  it("creates an assignment with a rubric and derived max points", async () => {
    mocks.createAssignment.mockImplementation(async (input) => ({
      id: "asg_2",
      classId: "class_1",
      title: input.title,
      description: input.description,
      instructions: input.instructions,
      maxPoints: input.maxPoints,
      rubric: input.rubric,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
      createdAt: Date.now(),
    }));

    await createAssignmentRoute(
      new Request("http://localhost/api/classes/class_1/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Oral quiz",
          description: "",
          instructions: "Respond in Spanish.",
          maxPoints: 999,
          rubric: {
            title: "Speaking rubric",
            criteria: [
              { id: "c1", name: "Pronunciation", description: "", maxPoints: 6 },
              { id: "c2", name: "Fluency", description: "", maxPoints: 4 },
            ],
          },
        }),
      }),
      { params: Promise.resolve({ classId: "class_1" }) }
    );

    expect(mocks.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPoints: 10,
        rubric: expect.objectContaining({ title: "Speaking rubric" }),
      })
    );
  });

  it("allows pasted assignments to reuse an existing attachment reference", async () => {
    mocks.createAssignment.mockImplementation(async (input) => ({
      id: "asg_3",
      classId: "class_1",
      title: input.title,
      description: input.description,
      instructions: input.instructions,
      maxPoints: input.maxPoints,
      rubric: input.rubric,
      attachmentName: input.attachmentName,
      attachmentUrl: input.attachmentUrl,
      attachmentContentType: input.attachmentContentType,
      createdAt: Date.now(),
    }));

    const response = await createAssignmentRoute(
      new Request("http://localhost/api/classes/class_1/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Copied oral quiz",
          description: "Reused assignment",
          instructions: "Respond again.",
          maxPoints: 25,
          existingAttachment: {
            fileName: "directions.pdf",
            url: "https://blob.example/directions.pdf",
            contentType: "application/pdf",
          },
        }),
      }),
      { params: Promise.resolve({ classId: "class_1" }) }
    );

    expect(response.status).toBe(201);
    expect(mocks.uploadAssignmentAttachment).not.toHaveBeenCalled();
    expect(mocks.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentName: "directions.pdf",
        attachmentUrl: "https://blob.example/directions.pdf",
        attachmentContentType: "application/pdf",
      })
    );
  });

  it("updates an assignment rubric and recomputes max points", async () => {
    mocks.updateAssignment.mockImplementation(async (_assignmentId, _teacherEmail, input) => ({
      id: "asg_1",
      classId: "class_1",
      className: "Spanish 1",
      ownerEmail: "teacher@example.com",
      title: input.title,
      description: "",
      instructions: input.instructions,
      maxPoints: input.maxPoints,
      rubric: input.rubric,
      attachmentName: input.attachmentName,
      attachmentUrl: input.attachmentUrl,
      attachmentContentType: input.attachmentContentType,
      createdAt: Date.now(),
    }));

    const response = await updateAssignmentRoute(
      new Request("http://localhost/api/assignments/asg_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated oral quiz",
          instructions: "Respond fully.",
          maxPoints: 99,
          rubric: {
            title: "Updated rubric",
            criteria: [
              { id: "c1", name: "Pronunciation", description: "", maxPoints: 7 },
              { id: "c2", name: "Fluency", description: "", maxPoints: 5 },
            ],
          },
        }),
      }),
      { params: Promise.resolve({ assignmentId: "asg_1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateAssignment).toHaveBeenCalledWith(
      "asg_1",
      "teacher@example.com",
      expect.objectContaining({
        maxPoints: 12,
        rubric: expect.objectContaining({ title: "Updated rubric" }),
      })
    );
  });

  it("keeps the legacy submission grading path working", async () => {
    mocks.findAssignmentById.mockResolvedValueOnce({
      id: "asg_1",
      classId: "class_1",
      className: "Spanish 1",
      ownerEmail: "teacher@example.com",
      title: "Assignment",
      description: "",
      instructions: "Speak",
      maxPoints: 20,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
      createdAt: Date.now(),
    });

    const response = await patchSubmissionRoute(
      new Request("http://localhost/api/submissions/sub_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: 15, feedback: "Nice work" }),
      }),
      { params: Promise.resolve({ submissionId: "sub_1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSubmission).toHaveBeenCalledWith(
      "sub_1",
      "teacher@example.com",
      expect.objectContaining({ grade: 15, rubricScores: null })
    );
  });

  it("saves rubric scores, computes the total grade, and persists rubric score JSON", async () => {
    const response = await patchSubmissionRoute(
      new Request("http://localhost/api/submissions/sub_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rubricScores: [
            { criterionId: "c1", criterionName: "Pronunciation", maxPoints: 10, awarded: 8 },
            { criterionId: "c2", criterionName: "Fluency", maxPoints: 10, awarded: 7 },
          ],
          feedback: "Strong overall",
        }),
      }),
      { params: Promise.resolve({ submissionId: "sub_1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSubmission).toHaveBeenCalledWith(
      "sub_1",
      "teacher@example.com",
      expect.objectContaining({
        grade: 15,
        rubricScores: [
          { criterionId: "c1", criterionName: "Pronunciation", maxPoints: 10, awarded: 8 },
          { criterionId: "c2", criterionName: "Fluency", maxPoints: 10, awarded: 7 },
        ],
      })
    );
  });

  it("rejects awarded scores above the criterion max", async () => {
    const response = await patchSubmissionRoute(
      new Request("http://localhost/api/submissions/sub_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rubricScores: [
            { criterionId: "c1", criterionName: "Pronunciation", maxPoints: 10, awarded: 11 },
            { criterionId: "c2", criterionName: "Fluency", maxPoints: 10, awarded: 7 },
          ],
        }),
      }),
      { params: Promise.resolve({ submissionId: "sub_1" }) }
    );
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(data.error).toContain("Validation failed");
  });

  it("keeps the gradebook CSV compatible after rubric grading", async () => {
    mocks.listGradebookRowsByClassId.mockResolvedValue([
      {
        studentName: "Student One",
        studentEmail: "student@example.com",
        assignmentTitle: "Oral quiz",
        grade: 15,
        feedback: "Strong overall",
        submittedAt: Date.UTC(2026, 2, 17),
      },
    ]);

    const response = await gradebookRoute(
      new Request("http://localhost/api/classes/class_1/gradebook.csv"),
      { params: Promise.resolve({ classId: "class_1" }) }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Student Name,Student Email,Assignment,Grade,Feedback,Submitted At");
    expect(body).toContain("Student One,student@example.com,Oral quiz,15,Strong overall");
  });
});

describe("submission patch rubric validation", () => {
  it("accepts rubric scores in the shared schema", () => {
    const parsed = parseOrThrow400(submissionPatchSchema, {
      rubricScores: [
        { criterionId: "c1", criterionName: "Pronunciation", maxPoints: 10, awarded: 8 },
      ],
      feedback: "Nice work",
    });

    expect(parsed.rubricScores?.[0]?.awarded).toBe(8);
  });
});

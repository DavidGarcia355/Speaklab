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
  deleteBlobObjects: vi.fn(),
  isAssignmentAttachmentReferenced: vi.fn(),
  enqueueFirstAssignmentPublishedAlert: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/attachment-storage", () => ({
  uploadAssignmentAttachment: mocks.uploadAssignmentAttachment,
}));

vi.mock("@/lib/blob-deletion", () => ({
  deleteBlobObjects: mocks.deleteBlobObjects,
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
  isAssignmentAttachmentReferenced: mocks.isAssignmentAttachmentReferenced,
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

vi.mock("@/lib/admin-alert-lifecycle", () => ({
  enqueueFirstAssignmentPublishedAlert: mocks.enqueueFirstAssignmentPublishedAlert,
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

    const duplicateIds = assignmentCreateSchema.safeParse({
      title: "Oral practice",
      description: "",
      instructions: "Respond in Spanish.",
      maxPoints: 10,
      rubric: {
        title: "Duplicate ids",
        criteria: [
          { id: "same", name: "Content", description: "", maxPoints: 5 },
          { id: "same", name: "Language", description: "", maxPoints: 5 },
        ],
      },
    });
    expect(duplicateIds.success).toBe(false);
    if (!duplicateIds.success) {
      expect(duplicateIds.error.issues.some((issue) => /unique/i.test(issue.message))).toBe(true);
    }
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
    mocks.deleteBlobObjects.mockReset();
    mocks.isAssignmentAttachmentReferenced.mockReset();
    mocks.enqueueFirstAssignmentPublishedAlert.mockReset().mockResolvedValue(undefined);

    mocks.requireTeacherEmail.mockResolvedValue("teacher@example.com");
    mocks.deleteBlobObjects.mockResolvedValue({ failed: 0 });
    mocks.isAssignmentAttachmentReferenced.mockResolvedValue(false);
    mocks.findClassById.mockResolvedValue({ id: "class_1", name: "Spanish 1" });
    mocks.findAssignmentById.mockResolvedValue({
      id: "asg_1",
      classId: "class_1",
      className: "Spanish 1",
      ownerEmail: "teacher@example.com",
      title: "Assignment",
      description: "Keep this student-facing overview.",
      instructions: "Speak",
      maxPoints: 20,
      maxSubmissions: 2,
      maxRecordingSeconds: 90,
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
    expect(mocks.enqueueFirstAssignmentPublishedAlert).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
      teacherJoinedAt: expect.any(Number),
      assignmentCreatedAt: expect.any(Number),
    });
  });

  it("allows pasted assignments to reuse a server-authorized source attachment", async () => {
    mocks.findAssignmentById.mockResolvedValue({
      id: "asg_source",
      ownerEmail: "teacher@example.com",
      attachmentName: "directions.pdf",
      attachmentUrl: "assignment-attachments/asg_source/directions.pdf",
      attachmentContentType: "application/pdf",
    });
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
          sourceAssignmentId: "asg_source",
        }),
      }),
      { params: Promise.resolve({ classId: "class_1" }) }
    );

    expect(response.status).toBe(201);
    expect(mocks.uploadAssignmentAttachment).not.toHaveBeenCalled();
    expect(mocks.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentName: "directions.pdf",
        attachmentUrl: "assignment-attachments/asg_source/directions.pdf",
        attachmentContentType: "application/pdf",
      })
    );
    expect(mocks.findAssignmentById).toHaveBeenCalledWith(
      "asg_source",
      "teacher@example.com"
    );
  });

  it("removes a newly uploaded worksheet when assignment creation fails", async () => {
    const uploadedPath = "assignment-attachments/asg_pending/worksheet.pdf";
    mocks.uploadAssignmentAttachment.mockResolvedValue(uploadedPath);
    mocks.createAssignment.mockRejectedValue(new Error("database unavailable"));
    const dataUrl = `data:application/pdf;base64,${Buffer.from("%PDF-1.7\n%%EOF").toString("base64")}`;

    await expect(
      createAssignmentRoute(
        new Request("http://localhost/api/classes/class_1/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Worksheet assignment",
            description: "",
            instructions: "Complete the worksheet.",
            maxPoints: 10,
            attachment: { fileName: "worksheet.pdf", dataUrl },
          }),
        }),
        { params: Promise.resolve({ classId: "class_1" }) }
      )
    ).rejects.toThrow("database unavailable");

    expect(mocks.deleteBlobObjects).toHaveBeenCalledWith([uploadedPath], {
      objectClass: "attachment",
    });
  });

  it("rejects the former client-supplied attachment URL shape", () => {
    expect(
      assignmentCreateSchema.safeParse({
        title: "Copied oral quiz",
        description: "",
        instructions: "Respond.",
        maxPoints: 10,
        existingAttachment: {
          fileName: "directions.pdf",
          url: "https://attacker.example/file.pdf",
          contentType: "application/pdf",
        },
      }).success
    ).toBe(false);
  });

  it("updates an assignment rubric and recomputes max points", async () => {
    mocks.updateAssignment.mockImplementation(async (_assignmentId, _teacherEmail, input) => ({
      id: "asg_1",
      classId: "class_1",
      className: "Spanish 1",
      ownerEmail: "teacher@example.com",
      title: input.title,
      description: input.description,
      instructions: input.instructions,
      maxPoints: input.maxPoints,
      maxSubmissions: input.maxSubmissions,
      maxRecordingSeconds: input.maxRecordingSeconds,
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
        description: "Keep this student-facing overview.",
        maxPoints: 12,
        rubric: expect.objectContaining({ title: "Updated rubric" }),
      })
    );
  });

  it("removes a replacement worksheet if the assignment update fails", async () => {
    const uploadedPath = "assignment-attachments/asg_1/replacement.pdf";
    mocks.uploadAssignmentAttachment.mockResolvedValue(uploadedPath);
    mocks.updateAssignment.mockRejectedValue(new Error("database unavailable"));
    const dataUrl = `data:application/pdf;base64,${Buffer.from("%PDF-1.7\n%%EOF").toString("base64")}`;

    await expect(
      updateAssignmentRoute(
        new Request("http://localhost/api/assignments/asg_1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Updated assignment",
            instructions: "Complete the replacement worksheet.",
            maxPoints: 20,
            attachment: { fileName: "replacement.pdf", dataUrl },
          }),
        }),
        { params: Promise.resolve({ assignmentId: "asg_1" }) }
      )
    ).rejects.toThrow("database unavailable");

    expect(mocks.deleteBlobObjects).toHaveBeenCalledWith([uploadedPath], {
      objectClass: "attachment",
    });
  });

  it("deletes an unreferenced worksheet only after a successful replacement", async () => {
    const oldPath = "assignment-attachments/asg_1/original.pdf";
    const replacementPath = "assignment-attachments/asg_1/replacement.pdf";
    mocks.findAssignmentById.mockResolvedValue({
      id: "asg_1",
      classId: "class_1",
      className: "Spanish 1",
      ownerEmail: "teacher@example.com",
      title: "Assignment",
      description: "Keep this student-facing overview.",
      instructions: "Speak",
      targetLanguage: "Spanish",
      maxPoints: 20,
      maxSubmissions: 2,
      maxRecordingSeconds: 90,
      rubric: null,
      attachmentName: "original.pdf",
      attachmentUrl: oldPath,
      attachmentContentType: "application/pdf",
      createdAt: Date.now(),
    });
    mocks.uploadAssignmentAttachment.mockResolvedValue(replacementPath);
    mocks.updateAssignment.mockImplementation(async (_assignmentId, _teacherEmail, input) => ({
      id: "asg_1",
      classId: "class_1",
      ownerEmail: "teacher@example.com",
      className: "Spanish 1",
      createdAt: Date.now(),
      ...input,
    }));
    const dataUrl = `data:application/pdf;base64,${Buffer.from("%PDF-1.7\n%%EOF").toString("base64")}`;

    const response = await updateAssignmentRoute(
      new Request("http://localhost/api/assignments/asg_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated assignment",
          instructions: "Complete the replacement worksheet.",
          maxPoints: 20,
          attachment: { fileName: "replacement.pdf", dataUrl },
        }),
      }),
      { params: Promise.resolve({ assignmentId: "asg_1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.isAssignmentAttachmentReferenced).toHaveBeenCalledWith(oldPath);
    expect(mocks.deleteBlobObjects).toHaveBeenCalledWith([oldPath], {
      objectClass: "attachment",
    });
  });

  it("returns 409 when updating an assignment to a duplicate title", async () => {
    mocks.updateAssignment.mockRejectedValueOnce(
      new Error("Assignment title already exists in this class.")
    );

    const response = await updateAssignmentRoute(
      new Request("http://localhost/api/assignments/asg_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated oral quiz",
          instructions: "Respond fully.",
          maxPoints: 20,
        }),
      }),
      { params: Promise.resolve({ assignmentId: "asg_1" }) }
    );
    const data = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(data.error).toBe("Assignment title already exists in this class.");
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

  it("keeps the gradebook CSV compatible with mixed rubric and non-rubric assignments", async () => {
    mocks.listGradebookRowsByClassId.mockResolvedValue([
      {
        studentName: "Student One",
        studentEmail: "student@example.com",
        assignmentTitle: "Rubric oral quiz",
        grade: 15,
        feedback: "Strong overall",
        submittedAt: Date.UTC(2026, 2, 17),
      },
      {
        studentName: "Student One",
        studentEmail: "student@example.com",
        assignmentTitle: "Quick vocab check",
        grade: 9,
        feedback: "Good pacing",
        submittedAt: Date.UTC(2026, 2, 18),
      },
    ]);

    const response = await gradebookRoute(
      new Request("http://localhost/api/classes/class_1/gradebook.csv"),
      { params: Promise.resolve({ classId: "class_1" }) }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Student Name,Student Email,Assignment,Grade,Feedback,Submitted At");
    expect(body).toContain("Student One,student@example.com,Rubric oral quiz,15,Strong overall");
    expect(body).toContain("Student One,student@example.com,Quick vocab check,9,Good pacing");
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

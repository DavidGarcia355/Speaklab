import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = path.join(process.cwd(), "data");
const localDbPath = path.join(dataDir, "tracking-test.db");

async function loadDbModule() {
  vi.resetModules();
  return await import("@/lib/db");
}

describe("tracking db helpers", () => {
  beforeAll(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
  });

  it("returns recent activity newest first", async () => {
    const db = await loadDbModule();

    await db.upsertGoogleUserAndGetRole("teacher@example.com");
    const first = await db.logActivityEvent({
      email: "teacher@example.com",
      eventType: "user_signed_in",
      metadata: { step: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await db.logActivityEvent({
      email: "teacher@example.com",
      eventType: "teacher_upgraded",
      metadata: { step: 2 },
    });

    const events = await db.listRecentActivityEvents(10);

    expect(events[0]?.id).toBe(second.id);
    expect(events[1]?.id).toBe(first.id);
  });

  it("computes funnel counts and tracking summary correctly", async () => {
    const db = await loadDbModule();

    await db.upsertGoogleUserAndGetRole("teacher@example.com");
    await db.setUserRoleTeacher("teacher@example.com");
    await db.upsertGoogleUserAndGetRole("student@example.com");
    await db.logActivityEvent({
      email: "student@example.com",
      eventType: "user_signed_in",
    });

    const createdClass = await db.createClass("Spanish 1", "teacher@example.com");
    await db.createAssignment({
      classId: createdClass.id,
      ownerEmail: "teacher@example.com",
      title: "Oral quiz",
      description: "",
      instructions: "Speak",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
    });
    await db.logActivityEvent({
      email: "teacher@example.com",
      eventType: "assignment_created",
      metadata: { classId: createdClass.id },
    });

    const funnel = await db.listTeacherFunnelRows();
    const recentTeacherEvents = await db.listRecentTeacherActivityEvents(10);
    const summary = await db.getTrackingSummary();
    const teacher = funnel.find((row) => row.email === "teacher@example.com");

    expect(funnel).toHaveLength(1);
    expect(teacher).toMatchObject({
      role: "teacher",
      classCount: 1,
      assignmentCount: 1,
    });
    expect(teacher?.latestActivityAt).toBeTypeOf("number");
    expect(recentTeacherEvents.every((event) => event.email === "teacher@example.com")).toBe(true);
    expect(recentTeacherEvents.some((event) => event.eventType === "user_signed_in")).toBe(false);
    expect(summary).toMatchObject({
      totalUsers: 2,
      teacherAccounts: 1,
      activatedTeachers: 1,
      teachingReadyTeachers: 1,
    });
  });

  it("keeps student assignment history after the last submission is deleted", async () => {
    const db = await loadDbModule();
    const teacherEmail = "history-teacher@example.com";
    const studentEmail = "history-student@example.com";

    const createdClass = await db.createClass("Spanish History", teacherEmail);
    const assignment = await db.createAssignment({
      classId: createdClass.id,
      ownerEmail: teacherEmail,
      title: "Weekend recap",
      description: "",
      instructions: "Speak for 30 seconds.",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
    });
    const submission = await db.createSubmission({
      assignmentId: assignment.id,
      studentName: "Student One",
      studentEmail,
      audioBlobUrl: "https://blob.example/audio.webm",
    });

    expect(await db.listSubmissionsByStudentEmail(studentEmail)).toHaveLength(1);
    expect(await db.listStudentAssignmentHistoryByEmail(studentEmail)).toEqual([
      expect.objectContaining({
        assignmentId: assignment.id,
        assignmentTitle: "Weekend recap",
        className: "Spanish History",
        maxPoints: 10,
      }),
    ]);

    await expect(db.deleteSubmissionByStudent(submission.id, studentEmail)).resolves.toBe(true);
    await expect(db.listSubmissionsByStudentEmail(studentEmail)).resolves.toHaveLength(0);
    await expect(db.listStudentAssignmentHistoryByEmail(studentEmail)).resolves.toEqual([
      expect.objectContaining({
        assignmentId: assignment.id,
        assignmentTitle: "Weekend recap",
        className: "Spanish History",
      }),
    ]);
  });

  it("rejects duplicate class names for the same teacher", async () => {
    const db = await loadDbModule();
    const teacherEmail = "duplicate-class@example.com";

    await db.createClass("Spanish 2", teacherEmail);

    await expect(db.createClass("spanish 2", teacherEmail)).rejects.toThrow("Class name already exists.");
  });

  it("rejects duplicate assignment titles within a class, including updates", async () => {
    const db = await loadDbModule();
    const teacherEmail = "duplicate-assignment@example.com";
    const createdClass = await db.createClass("Spanish 3", teacherEmail);
    const first = await db.createAssignment({
      classId: createdClass.id,
      ownerEmail: teacherEmail,
      title: "Oral warmup",
      description: "",
      instructions: "Warm up.",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
    });
    const second = await db.createAssignment({
      classId: createdClass.id,
      ownerEmail: teacherEmail,
      title: "Picture talk",
      description: "",
      instructions: "Describe the image.",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
    });

    await expect(
      db.createAssignment({
        classId: createdClass.id,
        ownerEmail: teacherEmail,
        title: "ORAL WARMUP",
        description: "",
        instructions: "Duplicate title.",
        maxPoints: 10,
        maxSubmissions: 0,
        maxRecordingSeconds: 180,
        rubric: null,
        attachmentName: "",
        attachmentUrl: "",
        attachmentContentType: "",
      })
    ).rejects.toThrow("Assignment title already exists in this class.");

    await expect(
      db.updateAssignment(second.id, teacherEmail, {
        title: "oral warmup",
        description: second.description,
        instructions: second.instructions,
        maxPoints: second.maxPoints,
        maxSubmissions: second.maxSubmissions,
        maxRecordingSeconds: second.maxRecordingSeconds,
        rubric: second.rubric,
        attachmentName: second.attachmentName,
        attachmentUrl: second.attachmentUrl,
        attachmentContentType: second.attachmentContentType,
      })
    ).rejects.toThrow("Assignment title already exists in this class.");

    await expect(
      db.updateAssignment(first.id, teacherEmail, {
        title: "ORAL WARMUP",
        description: first.description,
        instructions: first.instructions,
        maxPoints: first.maxPoints,
        maxSubmissions: first.maxSubmissions,
        maxRecordingSeconds: first.maxRecordingSeconds,
        rubric: first.rubric,
        attachmentName: first.attachmentName,
        attachmentUrl: first.attachmentUrl,
        attachmentContentType: first.attachmentContentType,
      })
    ).resolves.toMatchObject({
      id: first.id,
      title: "ORAL WARMUP",
    });
  });
});

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = path.join(process.cwd(), "data");
const localDbPath = path.join(dataDir, "cleanup-test.db");

async function loadDbModule() {
  vi.resetModules();
  return await import("@/lib/db");
}

describe("cleanup db helpers", () => {
  beforeAll(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
  });

  it("lists hard-delete-eligible audio and protects active shared attachments", async () => {
    const db = await loadDbModule();
    const teacherEmail = "cleanup-teacher@example.com";
    const createdClass = await db.createClass("Cleanup Class", teacherEmail);
    const sharedAttachmentUrl = "https://blob.example/shared.pdf";
    const deletedAssignment = await db.createAssignment({
      classId: createdClass.id,
      ownerEmail: teacherEmail,
      title: "Deleted attachment",
      description: "",
      instructions: "Speak.",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "shared.pdf",
      attachmentUrl: sharedAttachmentUrl,
      attachmentContentType: "application/pdf",
    });
    await db.createAssignment({
      classId: createdClass.id,
      ownerEmail: teacherEmail,
      title: "Active attachment",
      description: "",
      instructions: "Speak.",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "shared.pdf",
      attachmentUrl: sharedAttachmentUrl,
      attachmentContentType: "application/pdf",
    });
    const audioAssignment = await db.createAssignment({
      classId: createdClass.id,
      ownerEmail: teacherEmail,
      title: "Audio cleanup",
      description: "",
      instructions: "Speak.",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
    });
    const submission = await db.createSubmission({
      assignmentId: audioAssignment.id,
      studentName: "Student",
      studentEmail: "cleanup-student@example.com",
      audioBlobUrl: "submissions/asg/sub.webm",
    });

    await db.deleteAssignmentCascade(deletedAssignment.id, teacherEmail);
    await db.deleteSubmission(submission.id, teacherEmail);

    const objects = await db.listStorageObjectsForHardDeleteBefore(Date.now() + 1);

    expect(objects.audioBlobUrls).toContain("submissions/asg/sub.webm");
    expect(objects.attachmentUrls).not.toContain(sharedAttachmentUrl);
  });
});

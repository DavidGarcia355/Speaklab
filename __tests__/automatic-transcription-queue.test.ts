import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const localDbPath = path.join(os.tmpdir(), "speaklab-automatic-transcription-queue.db");

async function loadDbModule() {
  vi.resetModules();
  return import("@/lib/db");
}

describe("automatic transcription queue", () => {
  beforeAll(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
  });

  it("queues only opted-in assignments and uses the supplied submission id", async () => {
    const db = await loadDbModule();
    const teacherEmail = "automatic-transcription@example.com";
    const classroom = await db.createClass("Automatic transcripts", teacherEmail);
    const assignment = await db.createAssignment({
      classId: classroom.id,
      ownerEmail: teacherEmail,
      title: "Opted in",
      description: "",
      instructions: "Speak.",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
      autoTranscribe: true,
    });
    const submission = await db.createSubmission({
      id: "sub_supplied_queue_test",
      assignmentId: assignment.id,
      studentName: "Student",
      studentEmail: "student@example.com",
      audioBlobUrl: "private/audio.webm",
    });
    expect(submission.id).toBe("sub_supplied_queue_test");

    const claimed = await db.claimAutomaticTranscriptionJobs({ limit: 3 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      submissionId: submission.id,
      assignmentId: assignment.id,
      teacherEmail,
      status: "processing",
      attemptCount: 1,
    });
    await expect(db.claimAutomaticTranscriptionJobs({ limit: 3 })).resolves.toEqual([]);
    await expect(db.settleAutomaticTranscriptionJob({
      id: claimed[0].id,
      leaseToken: claimed[0].leaseToken,
      status: "retry",
      nextAttemptAt: 0,
    })).resolves.toBe(true);
    const retried = await db.claimAutomaticTranscriptionJobs({ limit: 3 });
    expect(retried[0]).toMatchObject({ id: claimed[0].id, attemptCount: 2 });
    await expect(db.settleAutomaticTranscriptionJob({
      id: claimed[0].id,
      leaseToken: claimed[0].leaseToken,
      status: "completed",
    })).resolves.toBe(false);
    await expect(db.settleAutomaticTranscriptionJob({
      id: retried[0].id,
      leaseToken: retried[0].leaseToken,
      status: "completed",
    })).resolves.toBe(true);
  });

  it("does not queue a default-off assignment", async () => {
    const db = await loadDbModule();
    const teacherEmail = "automatic-transcription-off@example.com";
    const classroom = await db.createClass("Manual transcripts", teacherEmail);
    const assignment = await db.createAssignment({
      classId: classroom.id,
      ownerEmail: teacherEmail,
      title: "Default off",
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
    expect(assignment.autoTranscribe).toBe(false);
    await db.createSubmission({
      id: "sub_manual_queue_test",
      assignmentId: assignment.id,
      studentName: "Student",
      studentEmail: "manual-student@example.com",
      audioBlobUrl: "private/manual.webm",
    });
    await expect(db.claimAutomaticTranscriptionJobs({ limit: 3 })).resolves.toEqual([]);
  });

  it("atomically cancels queued or leased work when the teacher turns automation off", async () => {
    const db = await loadDbModule();
    const teacherEmail = "automatic-transcription-toggle@example.com";
    const classroom = await db.createClass("Toggle transcripts", teacherEmail);
    const assignment = await db.createAssignment({
      classId: classroom.id,
      ownerEmail: teacherEmail,
      title: "Toggle assignment",
      description: "",
      instructions: "Speak.",
      maxPoints: 10,
      maxSubmissions: 0,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
      autoTranscribe: true,
    });
    await db.createSubmission({
      id: "sub_toggle_queue_test",
      assignmentId: assignment.id,
      studentName: "Student",
      studentEmail: "toggle-student@example.com",
      audioBlobUrl: "private/toggle.webm",
    });
    const [claimed] = await db.claimAutomaticTranscriptionJobs({ limit: 1 });
    expect(claimed).toBeDefined();
    if (!claimed) throw new Error("Automatic transcription job was not claimed.");
    await expect(db.isAutomaticTranscriptionJobActive({
      id: claimed.id,
      leaseToken: claimed.leaseToken,
    })).resolves.toBe(true);

    const disabled = await db.updateAssignment(assignment.id, teacherEmail, {
      title: assignment.title,
      description: assignment.description,
      instructions: assignment.instructions,
      targetLanguage: assignment.targetLanguage,
      maxPoints: assignment.maxPoints,
      maxSubmissions: assignment.maxSubmissions,
      maxRecordingSeconds: assignment.maxRecordingSeconds,
      rubric: assignment.rubric,
      attachmentName: assignment.attachmentName,
      attachmentUrl: assignment.attachmentUrl,
      attachmentContentType: assignment.attachmentContentType,
      autoTranscribe: false,
    });
    expect(disabled?.autoTranscribe).toBe(false);
    await expect(db.isAutomaticTranscriptionJobActive({
      id: claimed.id,
      leaseToken: claimed.leaseToken,
    })).resolves.toBe(false);
    await expect(db.settleAutomaticTranscriptionJob({
      id: claimed.id,
      leaseToken: claimed.leaseToken,
      status: "completed",
    })).resolves.toBe(false);

    await db.updateAssignment(assignment.id, teacherEmail, {
      title: assignment.title,
      description: assignment.description,
      instructions: assignment.instructions,
      targetLanguage: assignment.targetLanguage,
      maxPoints: assignment.maxPoints,
      maxSubmissions: assignment.maxSubmissions,
      maxRecordingSeconds: assignment.maxRecordingSeconds,
      rubric: assignment.rubric,
      attachmentName: assignment.attachmentName,
      attachmentUrl: assignment.attachmentUrl,
      attachmentContentType: assignment.attachmentContentType,
      autoTranscribe: true,
    });
    await expect(db.claimAutomaticTranscriptionJobs({ limit: 1 })).resolves.toEqual([]);
  });
});

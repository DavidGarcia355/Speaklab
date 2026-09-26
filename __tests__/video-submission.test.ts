import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { VIDEO_TRANSFER_BYTES_PER_MONTH } from "@/lib/video-policy";

const databasePath = path.join(os.tmpdir(), `speaklab-video-${process.pid}.db`);

describe("video assignment persistence", () => {
  let db: typeof import("@/lib/db");

  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = databasePath;
    fs.rmSync(databasePath, { force: true });
    vi.resetModules();
    db = await import("@/lib/db");
  });

  it("persists teacher video requirements and refuses audio-only submissions when video is required", async () => {
    const teacherEmail = "video-fixture@example.com";
    const course = await db.createClass("Video Test", teacherEmail);
    const assignment = await db.createAssignment({
      classId: course.id, ownerEmail: teacherEmail, title: "Camera response",
      description: "", instructions: "Speak to the camera.", maxPoints: 10,
      maxSubmissions: 1, maxRecordingSeconds: 120, rubric: null,
      attachmentName: "", attachmentUrl: "", attachmentContentType: "",
      videoMode: "required", autoGradeVideo: true,
    });
    expect(await db.findAssignmentById(assignment.id, teacherEmail)).toMatchObject({
      videoMode: "required", autoGradeVideo: true,
    });
    await expect(db.createSubmission({ assignmentId: assignment.id, studentName: "Student",
      studentEmail: "student@example.com", audioBlobUrl: "submissions/test/audio.webm" }))
      .rejects.toThrow("requires a video response");

    await db.updateAssignment(assignment.id, teacherEmail, {
      title: assignment.title, description: assignment.description,
      instructions: assignment.instructions, maxPoints: assignment.maxPoints,
      maxSubmissions: assignment.maxSubmissions,
      maxRecordingSeconds: assignment.maxRecordingSeconds,
      rubric: assignment.rubric, attachmentName: assignment.attachmentName,
      attachmentUrl: assignment.attachmentUrl, attachmentContentType: assignment.attachmentContentType,
      videoMode: "optional", autoGradeVideo: false,
    });
    await expect(db.createSubmission({ assignmentId: assignment.id, studentName: "Student",
      studentEmail: "student@example.com", audioBlobUrl: "submissions/test/audio.webm" }))
      .resolves.toMatchObject({ assignmentId: assignment.id });
  });

  it("enforces byte budgets atomically across concurrent requests and isolates teachers", async () => {
    const input = { teacherEmail: "budget@example.com", kind: "playback" as const, requests: 1 };
    expect(await db.reserveVideoResources({ ...input, bytes: VIDEO_TRANSFER_BYTES_PER_MONTH - 1 })).toBe(true);
    const results = await Promise.all([1, 2, 3].map(() => db.reserveVideoResources({ ...input, bytes: 1 })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.reserveVideoResources({ ...input, teacherEmail: "other@example.com", bytes: 1 })).toBe(true);
    expect(await db.reserveVideoResources({ ...input, kind: "validation", bytes: 1 })).toBe(true);
    await expect(db.reserveVideoResources({ ...input, bytes: -1 })).rejects.toThrow();
  });

  it("rejects forged, expired, cross-student reservations and prevents replay", async () => {
    const owner = "security@example.com";
    const course = await db.createClass("Security test", owner);
    const assignment = await db.createAssignment({ classId: course.id, ownerEmail: owner,
      title: "Private video", description: "", instructions: "Speak", maxPoints: 10, maxSubmissions: 0,
      maxRecordingSeconds: 120, rubric: null, attachmentName: "", attachmentUrl: "", attachmentContentType: "",
      videoMode: "required", autoGradeVideo: false });
    const studentEmail = "alice@example.com";
    const client = createClient({ url: `file:${databasePath}` });
    const now = Date.now();
    const pathname = `videos/${assignment.id}/security.webm`;
    await client.execute({ sql: `INSERT INTO video_upload_reservations
      (id, assignment_id, teacher_email, student_email, pathname, period_start, period_end, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: ["vid_security", assignment.id, owner, studentEmail, pathname, now - 1000, now + 60000, now] });
    const input = { assignmentId: assignment.id, studentEmail, studentName: "Alice",
      audioBlobUrl: "submissions/audio.webm", videoBlobUrl: pathname, videoReservationId: "vid_security" };
    await expect(db.createSubmission({ ...input, studentEmail: "mallory@example.com" })).rejects.toThrow("authorization expired");
    await expect(db.createSubmission({ ...input, videoBlobUrl: "videos/other.webm" })).rejects.toThrow("authorization expired");
    await client.execute({ sql: "UPDATE video_upload_reservations SET created_at = ? WHERE id = ?", args: [now - 3600001, "vid_security"] });
    await expect(db.createSubmission(input)).rejects.toThrow("authorization expired");
    await client.execute({ sql: "UPDATE video_upload_reservations SET created_at = ? WHERE id = ?", args: [now, "vid_security"] });
    const item = await db.createSubmission(input);
    await expect(db.createSubmission(input)).rejects.toThrow("authorization expired");
    expect(await db.findCompletedVideoSubmission("vid_security", assignment.id, studentEmail)).toMatchObject({ id: item.id });
    expect(await db.findCompletedVideoSubmission("vid_security", assignment.id, "mallory@example.com")).toBeNull();
    expect(await db.findSubmissionAccessById(item.id, "otherteacher@example.com")).toBeNull();
    expect(await db.findStudentSubmissionAudioAccessById(item.id, "mallory@example.com")).toBeNull();
    expect(await db.findSubmissionAccessById(item.id, owner)).toMatchObject({ videoBlobUrl: pathname });
    await client.execute({ sql: "UPDATE submissions SET deleted_at = ? WHERE id = ?", args: [now, item.id] });
    expect(await db.findSubmissionAccessById(item.id, owner)).toBeNull();
    expect(await db.findStudentSubmissionAudioAccessById(item.id, studentEmail)).toBeNull();
    client.close();
  });
});

import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import { createSilentWavFixtureDataUrl } from "@/lib/local-ai-fixture-audio";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";

const mocks = vi.hoisted(() => ({ student: vi.fn(), teacher: vi.fn(), upload: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireSchoolStudentEmail: mocks.student, requireTeacherEmail: mocks.teacher }));
vi.mock("@/lib/audio-storage", () => ({ uploadSubmissionAudio: mocks.upload, deleteSubmissionAudio: mocks.cleanup }));
vi.mock("@/lib/rate-limit", () => ({ enforceSubmissionRateLimit: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ isDev: false, productionOrigin: "http://localhost" }) }));

const dbPath = path.join(os.tmpdir(), `habla-practice-${randomUUID()}.db`);
const teacher = "practice-teacher@example.com";
const student = "practice-student@example.com";
let db: typeof import("@/lib/db");
let studentRoute: typeof import("@/app/api/student/classes/[classId]/practice/route");
let teacherRoute: typeof import("@/app/api/classes/[classId]/practice/route");
let reviewRoute: typeof import("@/app/api/submissions/[submissionId]/route");
let classId: string;
let submissionId: string;
const request = (body?: unknown) => new Request("http://localhost/api/practice", body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const classContext = () => ({ params: Promise.resolve({ classId }) });

beforeAll(async () => {
  vi.stubEnv("HABLA_LOCAL_DB_PATH", dbPath);
  vi.stubEnv("TURSO_DATABASE_URL", ""); vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("LOCAL_DEV_BYPASS_AUTH", "false"); vi.stubEnv("ENFORCE_STUDENT_DOMAIN", "false");
  vi.stubEnv("AI_GRADING_ENABLED", "false");
  db = await import("@/lib/db");
  studentRoute = await import("@/app/api/student/classes/[classId]/practice/route");
  teacherRoute = await import("@/app/api/classes/[classId]/practice/route");
  reviewRoute = await import("@/app/api/submissions/[submissionId]/route");
  await db.setUserRoleTeacher(teacher);
  classId = (await db.createClass("Practice class", teacher)).id;
  await db.upsertRosterEntry({ classId, studentEmail: student, studentName: "Student", addedBy: "teacher" });
});
beforeEach(() => {
  mocks.student.mockReset().mockResolvedValue(student);
  mocks.teacher.mockReset().mockResolvedValue(teacher);
  mocks.upload.mockReset().mockResolvedValue("private/practice.wav");
  mocks.cleanup.mockReset().mockResolvedValue(undefined);
});
afterAll(() => vi.unstubAllEnvs());

describe("Open Mic shared submission workflow", () => {
  it("requires sign-in before class lookup or storage", async () => {
    mocks.student.mockRejectedValue(new HttpError(401, "Sign in."));
    expect((await studentRoute.POST(request({}), classContext())).status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("requires enrollment for both read and write even with optional assignment roster checks off", async () => {
    mocks.student.mockResolvedValue("outsider@example.com");
    expect((await studentRoute.GET(request(), classContext())).status).toBe(403);
    expect((await studentRoute.POST(request({}), classContext())).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("persists measured duration, title and note with a real class and no manufactured assignment", async () => {
    const response = await studentRoute.POST(request({ studentName: "Student", title: "My weekend", note: "Please check my pronunciation.", audioData: createSilentWavFixtureDataUrl(42_000), durationSeconds: 999 }), classContext());
    expect(response.status).toBe(201);
    const { item } = await response.json(); submissionId = item.id;
    expect(item).toMatchObject({ assignmentId: null, durationSeconds: 42 });
    const sql = createClient({ url: `file:${dbPath}` });
    expect((await sql.execute("SELECT COUNT(*) as count FROM assignments")).rows[0].count).toBe(0);
    expect((await sql.execute({ sql: "SELECT assignment_id, practice_class_id FROM submissions WHERE id = ?", args: [submissionId] })).rows[0]).toMatchObject({ assignment_id: null, practice_class_id: classId });
    sql.close();
    const inbox = await teacherRoute.GET(request(), classContext());
    expect(await inbox.json()).toMatchObject({ transcriptionEnabled: false, items: [expect.objectContaining({ id: submissionId, durationSeconds: 42, practiceTitle: "My weekend", practiceNote: "Please check my pronunciation.", reviewedAt: null, transcriptAvailable: false })] });
  });
  it("rejects duplicate submissions and removes the duplicate's uploaded blob", async () => {
    const response = await studentRoute.POST(request({ studentName: "Student", audioData: createSilentWavFixtureDataUrl(42_000) }), classContext());
    expect(response.status).toBe(409);
    expect(mocks.cleanup).toHaveBeenCalledWith("private/practice.wav");
    expect(await db.listPracticeSubmissions(classId, teacher)).toHaveLength(1);
  });
  it.each([
    ["unsupported MIME", "data:text/plain;base64,SG9sYQ=="],
    ["broken audio", "data:audio/wav;base64,SG9sYQ=="],
    ["overlong audio", createSilentWavFixtureDataUrl(301_000)],
    ["oversized audio", `data:audio/wav;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64")}`],
  ])("rejects %s before storage", async (_label, audioData) => {
    expect((await studentRoute.POST(request({ studentName: "Student", audioData }), classContext())).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("returns a retryable upload failure without creating a submission", async () => {
    mocks.upload.mockRejectedValue(new Error("offline"));
    expect((await studentRoute.POST(request({ studentName: "Student", audioData: createSilentWavFixtureDataUrl(1000) }), classContext())).status).toBe(503);
    expect(await db.listPracticeSubmissions(classId, teacher)).toHaveLength(1);
  });
  it("keeps student history and both original-audio access paths private", async () => {
    expect(await db.findStudentSubmissionAudioAccessById(submissionId, student)).not.toBeNull();
    expect(await db.findStudentSubmissionAudioAccessById(submissionId, "other@example.com")).toBeNull();
    expect(await db.findSubmissionAccessById(submissionId, "other-teacher@example.com")).toBeNull();
    expect(await db.listSubmissionsByStudentEmail("other@example.com")).toEqual([]);
    const history = await studentRoute.GET(request(), classContext());
    expect(history.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await history.json()).items[0]).toMatchObject({ id: submissionId, durationSeconds: 42, practiceClassId: classId });
  });
  it("does not expose the inbox, transcript context, or feedback writes to another teacher", async () => {
    mocks.teacher.mockResolvedValue("other-teacher@example.com");
    expect((await teacherRoute.GET(request(), classContext())).status).toBe(404);
    expect((await reviewRoute.PATCH(request({ feedback: "intrusion", reviewed: true }), { params: Promise.resolve({ submissionId }) })).status).toBe(404);
    expect(await db.findOwnedSubmissionForAiReview(submissionId, "other-teacher@example.com")).toBeNull();
    expect(await db.listStudentAssignmentSummaries(classId, student, "other-teacher@example.com")).toEqual([]);
  });
  it("supports manual feedback and reviewed status with AI disabled and no grade or rubric", async () => {
    const context = { params: Promise.resolve({ submissionId }) };
    expect((await reviewRoute.PATCH(request({ grade: 9 }), context)).status).toBe(400);
    const response = await reviewRoute.PATCH(request({ feedback: "Clear pronunciation. Keep practicing!", reviewed: true }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).item).toMatchObject({ grade: null, reviewedAt: expect.any(Number) });
    expect((await db.listSubmissionsByStudentEmail(student))[0].feedback).toContain("Clear pronunciation");
    expect((await db.listStudentAssignmentSummaries(classId, student, teacher))[0]).toMatchObject({ practiceClassId: classId, durationSeconds: 42, reviewedAt: expect.any(Number) });
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail: teacher })).toMatchObject({ consumed: 0, reserved: 0 });
  });
  it("delivers and reuses a practice transcript for exactly one existing allowance unit", async () => {
    const context = await db.findOwnedSubmissionForAiReview(submissionId, teacher);
    expect(context).not.toBeNull();
    const fingerprint = processedAssignmentFingerprint(legacyAssignmentToGradingAssignment(context!));
    const semanticKey = `practice:${fingerprint}`;
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail: teacher, semanticKey });
    if (reservation.reservationStatus !== "reserved") throw new Error("Expected one reservation");
    const transcript = await db.finalizeSubmissionTranscriptDelivery({ reservationId: reservation.reservationId, value: {
      submissionId, teacherEmail: teacher, semanticKey, assignmentFingerprint: fingerprint, transcriptCacheKey: "practice-test",
      transcript: "Hola, este es mi fin de semana.", detectedLanguage: "Spanish", transcriptQuality: "good", durationSeconds: 42, transcriptionProvider: "mock", transcriptionModel: "mock",
    } });
    expect(transcript?.submissionId).toBe(submissionId);
    expect(await db.findSubmissionTranscriptForOwner(submissionId, "other-teacher@example.com")).toBeNull();
    expect(await db.reserveAiReviewAllowance({ teacherEmail: teacher, semanticKey })).toMatchObject({ reservationStatus: "duplicate", sourceKind: "transcript", used: 1 });
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail: teacher })).toMatchObject({ consumed: 1, reserved: 0 });
    expect((await db.listPracticeSubmissions(classId, teacher))[0].transcriptAvailable).toBe(true);
    expect(await db.findSubmissionForAiGrade(submissionId, teacher)).toBeNull();
  });
  it("rejects a roster revocation inside persistence and hides practice after class deletion", async () => {
    const revoked = await db.createClass("Revoked class", teacher);
    await expect(db.createSubmission({ assignmentId: null, practiceClassId: revoked.id, studentEmail: student, studentName: "Student", audioBlobUrl: "private/test.wav", durationSeconds: 1 })).rejects.toThrow();
    await db.upsertRosterEntry({ classId: revoked.id, studentEmail: student, studentName: "Student", addedBy: "teacher" });
    mocks.upload.mockImplementationOnce(async () => {
      await db.deleteRosterEntry(revoked.id, student, teacher);
      return "private/revoked.wav";
    });
    expect((await studentRoute.POST(request({ studentName: "Student", audioData: createSilentWavFixtureDataUrl(1000) }), { params: Promise.resolve({ classId: revoked.id }) })).status).toBe(403);
    expect(mocks.cleanup).toHaveBeenCalledWith("private/revoked.wav");
    await db.deleteClassCascade(classId, teacher);
    expect(await db.findStudentSubmissionAudioAccessById(submissionId, student)).toBeNull();
    expect(await db.findSubmissionTranscriptForOwner(submissionId, teacher)).toBeNull();
    expect((await studentRoute.POST(request({}), classContext())).status).toBe(403);
  });
});

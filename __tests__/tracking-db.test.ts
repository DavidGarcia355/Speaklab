import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = path.join(process.cwd(), "data");
const localDbPath = path.join(dataDir, "local.db");

async function loadDbModule() {
  vi.resetModules();
  return await import("@/lib/db");
}

describe("tracking db helpers", () => {
  beforeAll(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
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
});

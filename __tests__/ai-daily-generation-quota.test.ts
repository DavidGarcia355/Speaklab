import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const localDbPath = path.join(os.tmpdir(), "speaklab-ai-daily-quota-test.db");

describe("atomic daily AI generation quota", () => {
  let db: typeof import("@/lib/db");

  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
    vi.resetModules();
    db = await import("@/lib/db");
  });

  afterAll(() => {
    delete process.env.HABLA_LOCAL_DB_PATH;
  });

  it("allows only one concurrent claim at the teacher cap", async () => {
    const now = 2_000_000_000_000;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => db.reserveAiDailyGenerationQuota({
        teacherEmail: "one@example.com",
        since: now - 86_400_000,
        dailyTeacherLimit: 1,
        dailyGlobalLimit: 100,
        now,
      })),
    );
    expect(results.filter((result) => result.status === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "teacher_limit")).toHaveLength(7);
  });

  it("allows only one concurrent claim at the global cap", async () => {
    const now = 2_100_000_000_000;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => db.reserveAiDailyGenerationQuota({
        teacherEmail: `global-${index}@example.com`,
        since: now - 86_400_000,
        dailyTeacherLimit: 100,
        dailyGlobalLimit: 1,
        now,
      })),
    );
    expect(results.filter((result) => result.status === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "global_limit")).toHaveLength(7);
  });

  it("recovers an abandoned reservation after its lease expires", async () => {
    const now = 2_200_000_000_000;
    await expect(db.reserveAiDailyGenerationQuota({
      teacherEmail: "stale@example.com",
      since: now - 86_400_000,
      dailyTeacherLimit: 1,
      dailyGlobalLimit: 100,
      now,
    })).resolves.toMatchObject({ status: "reserved" });
    await expect(db.reserveAiDailyGenerationQuota({
      teacherEmail: "stale@example.com",
      since: now - 86_400_000,
      dailyTeacherLimit: 1,
      dailyGlobalLimit: 100,
      now: now + 16 * 60 * 1000 + 1,
    })).resolves.toMatchObject({ status: "reserved" });
  });
});

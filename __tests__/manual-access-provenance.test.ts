import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const legacyDbPath = path.join(
  process.cwd(),
  "data",
  "manual-access-provenance-test.db",
);

describe("legacy manual AI access provenance", () => {
  const originalEnv = {
    HABLA_LOCAL_DB_PATH: process.env.HABLA_LOCAL_DB_PATH,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    TEACHER_ALLOWLIST: process.env.TEACHER_ALLOWLIST,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
    process.env.HABLA_LOCAL_DB_PATH = legacyDbPath;
    process.env.TEACHER_ALLOWLIST = "legacy@example.com";
    fs.rmSync(legacyDbPath, { force: true });

    const legacy = createClient({ url: `file:${legacyDbPath}` });
    await legacy.execute(`CREATE TABLE users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'student',
      created_at INTEGER NOT NULL,
      is_paid INTEGER NOT NULL DEFAULT 0,
      ai_access_grant_source TEXT NOT NULL DEFAULT ''
    )`);
    await legacy.execute({
      sql: `INSERT INTO users (email, role, created_at, is_paid)
        VALUES (?, 'teacher', ?, 1)`,
      args: ["legacy@example.com", 1_700_000_000_000],
    });
    await legacy.execute({
      sql: `INSERT INTO users (
          email, role, created_at, is_paid, ai_access_grant_source
        ) VALUES (?, 'teacher', ?, 1, 'legacy_manual')`,
      args: ["v1-guessed-manual@example.com", 1_700_000_000_001],
    });
    await legacy.execute({
      sql: `INSERT INTO users (
          email, role, created_at, is_paid, ai_access_grant_source
        ) VALUES (?, 'teacher', ?, 1, 'manual')`,
      args: ["explicit-manual@example.com", 1_700_000_000_002],
    });
    legacy.close();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (typeof value === "undefined") delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("quarantines an origin-less paid bit until an operator explicitly regrants it", async () => {
    vi.resetModules();
    const db = await import("@/lib/db");

    await expect(db.getUserIsPaid("legacy@example.com")).resolves.toBe(false);

    const inspection = createClient({ url: `file:${legacyDbPath}` });
    const quarantined = await inspection.execute({
      sql: `SELECT ai_access_grant_source as source
        FROM users WHERE LOWER(email) = LOWER(?)`,
      args: ["legacy@example.com"],
    });
    expect(quarantined.rows[0]?.source).toBe("legacy_unclassified");
    await expect(
      db.getUserIsPaid("v1-guessed-manual@example.com"),
    ).resolves.toBe(false);
    await expect(db.getUserIsPaid("explicit-manual@example.com")).resolves.toBe(true);
    const repairedV1 = await inspection.execute({
      sql: `SELECT ai_access_grant_source as source
        FROM users WHERE LOWER(email) = LOWER(?)`,
      args: ["v1-guessed-manual@example.com"],
    });
    expect(repairedV1.rows[0]?.source).toBe("legacy_unclassified");

    await expect(db.setUserPaid("legacy@example.com", true)).resolves.toBe(true);
    await expect(db.getUserIsPaid("legacy@example.com")).resolves.toBe(true);
    const regranted = await inspection.execute({
      sql: `SELECT ai_access_grant_source as source
        FROM users WHERE LOWER(email) = LOWER(?)`,
      args: ["legacy@example.com"],
    });
    expect(regranted.rows[0]?.source).toBe("manual");
    inspection.close();
  });
});

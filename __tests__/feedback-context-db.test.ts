import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = path.join(process.cwd(), "data");
const localDbPath = path.join(dataDir, "feedback-context-test.db");

describe("feedback diagnostic context persistence", () => {
  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.rmSync(localDbPath, { force: true });

    const legacy = createClient({ url: `file:${localDbPath}` });
    await legacy.execute(`CREATE TABLE feedback_messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      school TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    await legacy.execute({
      sql: `INSERT INTO feedback_messages
        (id, name, email, school, role, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "fb_legacy",
        "Legacy Teacher",
        "legacy@district.example",
        "Legacy High",
        "Teacher",
        "A message created before diagnostic context existed.",
        1,
      ],
    });
    legacy.close();
    vi.resetModules();
  });

  it("migrates legacy rows and round-trips privacy-safe access context", async () => {
    const db = await import("@/lib/db");
    const created = await db.createFeedbackMessage({
      name: "Access Teacher",
      email: "access@district.example",
      school: "Access High",
      role: "Teacher",
      message: "I cannot finish signing in to my teacher account.",
      context: {
        source: "auth",
        authErrorCode: "AccessDenied",
        browserCategory: "facebook",
        route: "/auth/error",
      },
    });

    const rows = await db.listFeedbackMessages();
    expect(rows.find((row) => row.id === "fb_legacy")?.context).toBeNull();
    expect(rows.find((row) => row.id === created.id)?.context).toEqual({
      source: "auth",
      authErrorCode: "AccessDenied",
      browserCategory: "facebook",
      route: "/auth/error",
    });

    const audit = createClient({ url: `file:${localDbPath}` });
    const tableInfo = await audit.execute("PRAGMA table_info(feedback_messages)");
    expect(tableInfo.rows.map((row) => String(row.name))).toContain("context_json");
    audit.close();
  });
});

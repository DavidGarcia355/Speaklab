import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { afterAll, describe, expect, it, vi } from "vitest";

const testDbPath = path.join(
  os.tmpdir(),
  `tryhabla-transcript-migration-${randomUUID()}.db`,
);

const originalEnv = {
  HABLA_LOCAL_DB_PATH: process.env.HABLA_LOCAL_DB_PATH,
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
};

async function loadFreshDbModule() {
  vi.resetModules();
  return import("@/lib/db");
}

async function inspectPreservedRows() {
  const client = createClient({ url: `file:${testDbPath}` });
  const result = await client.execute(`SELECT
      c.id AS class_id,
      c.name AS class_name,
      c.owner_email,
      c.created_at AS class_created_at,
      a.id AS assignment_id,
      a.title AS assignment_title,
      a.description,
      a.instructions,
      a.created_at AS assignment_created_at,
      s.id AS submission_id,
      s.student_name,
      s.student_email,
      s.audio_data,
      s.submitted_at,
      s.feedback,
      s.grade,
      s.grade_source
    FROM classes c
    JOIN assignments a ON a.class_id = c.id
    JOIN submissions s ON s.assignment_id = a.id`);
  client.close();
  return result.rows;
}

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // libSQL can briefly retain a Windows file handle; this file is in the OS temp directory.
  }
});

describe("submission transcript migration compatibility", () => {
  it("preserves legacy classroom and grade data while adding transcripts idempotently", async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = testDbPath;

    const legacy = createClient({ url: `file:${testDbPath}` });
    await legacy.executeMultiple(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE classes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE assignments (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
      );
      CREATE TABLE submissions (
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        student_email TEXT NOT NULL DEFAULT '',
        audio_data TEXT,
        submitted_at INTEGER NOT NULL,
        feedback TEXT,
        grade INTEGER,
        deleted_at INTEGER,
        FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
      );
    `);
    await legacy.batch(
      [
        {
          sql: `INSERT INTO classes (id, name, owner_email, created_at, deleted_at)
            VALUES (?, ?, ?, ?, NULL)`,
          args: ["class_legacy", "Spanish 2", "teacher@example.com", 1_700_000_000_000],
        },
        {
          sql: `INSERT INTO assignments (
              id, class_id, title, description, instructions, created_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          args: [
            "assignment_legacy",
            "class_legacy",
            "Weekend reflection",
            "Legacy description",
            "Speak for one minute.",
            1_700_000_001_000,
          ],
        },
        {
          sql: `INSERT INTO submissions (
              id, assignment_id, student_name, student_email, audio_data,
              submitted_at, feedback, grade, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          args: [
            "submission_legacy",
            "assignment_legacy",
            "Sandra Student",
            "student@example.com",
            "data:audio/webm;base64,R0lGODlh",
            1_700_000_002_000,
            "Strong detail and clear pacing.",
            87,
          ],
        },
      ],
      "write",
    );
    const beforeMigration = await legacy.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'submission_transcripts'",
    );
    expect(beforeMigration.rows).toHaveLength(0);
    legacy.close();

    const firstDb = await loadFreshDbModule();
    await expect(
      firstDb.listClassesByTeacher("teacher@example.com"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "class_legacy",
        name: "Spanish 2",
        assignmentCount: 1,
        submissionCount: 1,
      }),
    ]);
    await expect(
      firstDb.listGradebookRowsByClassId("class_legacy", "teacher@example.com"),
    ).resolves.toEqual([
      expect.objectContaining({
        studentName: "Sandra Student",
        studentEmail: "student@example.com",
        assignmentTitle: "Weekend reflection",
        grade: 87,
        feedback: "Strong detail and clear pacing.",
      }),
    ]);

    const firstInspection = createClient({ url: `file:${testDbPath}` });
    const transcriptColumns = await firstInspection.execute(
      "PRAGMA table_info(submission_transcripts)",
    );
    expect(transcriptColumns.rows.map((row) => String(row.name))).toEqual(
      expect.arrayContaining([
        "id",
        "submission_id",
        "teacher_email",
        "semantic_key",
        "transcript",
        "created_at",
        "updated_at",
      ]),
    );
    const transcriptForeignKeys = await firstInspection.execute(
      "PRAGMA foreign_key_list(submission_transcripts)",
    );
    expect(transcriptForeignKeys.rows).toEqual([
      expect.objectContaining({ table: "submissions", from: "submission_id", to: "id" }),
    ]);
    await firstInspection.execute({
      sql: `INSERT INTO submission_transcripts (
          id, submission_id, teacher_email, semantic_key, transcript,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "transcript_legacy",
        "submission_legacy",
        "teacher@example.com",
        "recording-v1",
        "Este es el texto conservado.",
        1_700_000_003_000,
        1_700_000_003_000,
      ],
    });
    firstInspection.close();

    const preservedAfterFirstInit = await inspectPreservedRows();
    expect(preservedAfterFirstInit).toEqual([
      expect.objectContaining({
        class_id: "class_legacy",
        class_name: "Spanish 2",
        owner_email: "teacher@example.com",
        class_created_at: 1_700_000_000_000,
        assignment_id: "assignment_legacy",
        assignment_title: "Weekend reflection",
        description: "Legacy description",
        instructions: "Speak for one minute.",
        assignment_created_at: 1_700_000_001_000,
        submission_id: "submission_legacy",
        student_name: "Sandra Student",
        student_email: "student@example.com",
        audio_data: "data:audio/webm;base64,R0lGODlh",
        submitted_at: 1_700_000_002_000,
        feedback: "Strong detail and clear pacing.",
        grade: 87,
        grade_source: "teacher",
      }),
    ]);

    const secondDb = await loadFreshDbModule();
    await expect(
      secondDb.listSubmissionsByClassId("class_legacy", "teacher@example.com"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "submission_legacy",
        grade: 87,
        feedback: "Strong detail and clear pacing.",
        gradeSource: "teacher",
      }),
    ]);

    expect(await inspectPreservedRows()).toEqual(preservedAfterFirstInit);
    const finalInspection = createClient({ url: `file:${testDbPath}` });
    const transcriptTables = await finalInspection.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'submission_transcripts'",
    );
    const transcriptRows = await finalInspection.execute(
      "SELECT * FROM submission_transcripts",
    );
    expect(transcriptTables.rows).toHaveLength(1);
    expect(transcriptRows.rows).toEqual([
      expect.objectContaining({
        id: "transcript_legacy",
        submission_id: "submission_legacy",
        semantic_key: "recording-v1",
        transcript: "Este es el texto conservado.",
      }),
    ]);
    finalInspection.close();
  });
});

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client, type InValue, type Row } from "@libsql/client";

const QUERY_TIMEOUT_MS = 5000;

export type ClassRow = {
  id: string;
  name: string;
  createdAt: number;
};

export type ClassSummaryRow = ClassRow & {
  assignmentCount: number;
  submissionCount: number;
};

export type AssignmentRow = {
  id: string;
  classId: string;
  title: string;
  description: string;
  instructions: string;
  createdAt: number;
};

export type AssignmentSummaryRow = AssignmentRow & {
  submissionCount: number;
};

export type AssignmentDetailRow = AssignmentRow & {
  className: string;
};

export type SubmissionRow = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  studentName: string;
  studentEmail: string;
  audioData: string;
  submittedAt: number;
  feedback: string;
  grade: number | null;
};

export type GradebookRow = {
  studentName: string;
  studentEmail: string;
  assignmentTitle: string;
  grade: number | null;
  feedback: string;
  submittedAt: number;
};

type SubmissionAccessRow = {
  id: string;
  studentEmail: string;
  audioBlobUrl: string;
};

function createDbClient(): Client {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim() || "";
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim() || "";

  if (tursoUrl && tursoToken) {
    return createClient({
      url: tursoUrl,
      authToken: tursoToken,
    });
  }
  if (tursoUrl || tursoToken) {
    throw new Error("Both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required together.");
  }

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const localPath = path.join(dataDir, "local.db");
  return createClient({ url: `file:${localPath}` });
}

const db = createDbClient();

let initPromise: Promise<void> | null = null;

async function withTimeout<T>(label: string, fn: () => Promise<T>) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Database query timeout exceeded 5000ms (${label}).`));
        }, QUERY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function rawExecute(sql: string, args: InValue[] = []) {
  return db.execute({ sql, args });
}

async function ensureColumn(tableName: "classes" | "assignments" | "submissions", columnName: string, definition: string) {
  const pragma = await rawExecute(`PRAGMA table_info(${tableName})`);
  const columns = pragma.rows.map((row) => String((row as Row).name));
  if (!columns.includes(columnName)) {
    await rawExecute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      const statements = [
        "PRAGMA foreign_keys = ON",
        `CREATE TABLE IF NOT EXISTS classes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          deleted_at INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS assignments (
          id TEXT PRIMARY KEY,
          class_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          instructions TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          deleted_at INTEGER,
          FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS submissions (
          id TEXT PRIMARY KEY,
          assignment_id TEXT NOT NULL,
          student_name TEXT NOT NULL,
          student_email TEXT NOT NULL DEFAULT '',
          audio_data TEXT,
          audio_blob_url TEXT,
          submitted_at INTEGER NOT NULL,
          feedback TEXT,
          grade INTEGER,
          deleted_at INTEGER,
          FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
        )`,
        "CREATE INDEX IF NOT EXISTS idx_assignments_class_id ON assignments(class_id)",
        "CREATE INDEX IF NOT EXISTS idx_assignments_deleted_at ON assignments(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON submissions(assignment_id)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_student_name ON submissions(student_name)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_student_email ON submissions(student_email)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_deleted_at ON submissions(deleted_at)",
        `CREATE TRIGGER IF NOT EXISTS trg_classes_delete_assignments
          AFTER DELETE ON classes
          FOR EACH ROW
          BEGIN
            DELETE FROM assignments WHERE class_id = OLD.id;
          END`,
        `CREATE TRIGGER IF NOT EXISTS trg_assignments_delete_submissions
          AFTER DELETE ON assignments
          FOR EACH ROW
          BEGIN
            DELETE FROM submissions WHERE assignment_id = OLD.id;
          END`,
      ];
      for (const sql of statements) {
        await rawExecute(sql);
      }
      await ensureColumn("classes", "deleted_at", "INTEGER");
      await ensureColumn("assignments", "deleted_at", "INTEGER");
      await ensureColumn("submissions", "student_email", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("submissions", "audio_blob_url", "TEXT");
      await ensureColumn("submissions", "deleted_at", "INTEGER");
    })();
  }
  return initPromise;
}

async function query(sql: string, args: InValue[] = []) {
  await ensureInitialized();
  return withTimeout(sql, () => db.execute({ sql, args }));
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function toNullableNumber(value: unknown) {
  if (value === null || typeof value === "undefined") return null;
  return Number(value);
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function toProtectedAudioPath(id: string) {
  return `/api/submissions/${id}/audio`;
}

export async function listClasses(): Promise<ClassSummaryRow[]> {
  const result = await query(
    `SELECT
      c.id as id,
      c.name as name,
      c.created_at as createdAt,
      COUNT(DISTINCT a.id) as assignmentCount,
      COUNT(s.id) as submissionCount
    FROM classes c
    LEFT JOIN assignments a ON a.class_id = c.id AND a.deleted_at IS NULL
    LEFT JOIN submissions s ON s.assignment_id = a.id AND s.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY c.created_at DESC`
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    name: toStringValue(row.name),
    createdAt: toNumber(row.createdAt),
    assignmentCount: toNumber(row.assignmentCount),
    submissionCount: toNumber(row.submissionCount),
  }));
}

export async function findClassById(classId: string): Promise<ClassRow | null> {
  const result = await query(
    `SELECT id, name, created_at as createdAt
    FROM classes
    WHERE id = ?
      AND deleted_at IS NULL
    LIMIT 1`,
    [classId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    name: toStringValue(row.name),
    createdAt: toNumber(row.createdAt),
  };
}

export async function createClass(name: string): Promise<ClassRow> {
  const duplicate = await query(
    `SELECT id FROM classes
    WHERE LOWER(name) = LOWER(?)
      AND deleted_at IS NULL
    LIMIT 1`,
    [name]
  );
  if (duplicate.rows.length > 0) {
    throw new Error("Class name already exists.");
  }

  const item: ClassRow = {
    id: makeId("class"),
    name,
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO classes (id, name, created_at, deleted_at)
    VALUES (?, ?, ?, NULL)`,
    [item.id, item.name, item.createdAt]
  );
  return item;
}

export async function updateClassName(classId: string, name: string): Promise<ClassRow | null> {
  const duplicate = await query(
    `SELECT id FROM classes
    WHERE LOWER(name) = LOWER(?)
      AND id <> ?
      AND deleted_at IS NULL
    LIMIT 1`,
    [name, classId]
  );
  if (duplicate.rows.length > 0) {
    throw new Error("Class name already exists.");
  }

  const result = await query(
    `UPDATE classes
    SET name = ?
    WHERE id = ?
      AND deleted_at IS NULL`,
    [name, classId]
  );
  if (toNumber(result.rowsAffected) === 0) return null;
  return findClassById(classId);
}

export async function deleteClassCascade(classId: string): Promise<boolean> {
  const deletedAt = Date.now();
  await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE assignment_id IN (
      SELECT a.id
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE c.id = ?
    )
      AND deleted_at IS NULL`,
    [deletedAt, classId]
  );
  await query(
    `UPDATE assignments
    SET deleted_at = ?
    WHERE class_id = ?
      AND deleted_at IS NULL`,
    [deletedAt, classId]
  );
  const result = await query(
    `UPDATE classes
    SET deleted_at = ?
    WHERE id = ?
      AND deleted_at IS NULL`,
    [deletedAt, classId]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function listAssignmentsByClassId(classId: string): Promise<AssignmentSummaryRow[]> {
  const result = await query(
    `SELECT
      a.id as id,
      a.class_id as classId,
      a.title as title,
      a.description as description,
      a.instructions as instructions,
      a.created_at as createdAt,
      COUNT(s.id) as submissionCount
    FROM assignments a
    LEFT JOIN submissions s ON s.assignment_id = a.id AND s.deleted_at IS NULL
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    GROUP BY a.id
    ORDER BY a.created_at DESC`,
    [classId]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    classId: toStringValue(row.classId),
    title: toStringValue(row.title),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    createdAt: toNumber(row.createdAt),
    submissionCount: toNumber(row.submissionCount),
  }));
}

export async function createAssignment(input: {
  classId: string;
  title: string;
  description: string;
  instructions: string;
}): Promise<AssignmentRow> {
  const item: AssignmentRow = {
    id: makeId("asg"),
    classId: input.classId,
    title: input.title,
    description: input.description,
    instructions: input.instructions,
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO assignments (id, class_id, title, description, instructions, created_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [item.id, item.classId, item.title, item.description, item.instructions, item.createdAt]
  );
  return item;
}

export async function findAssignmentById(assignmentId: string): Promise<AssignmentDetailRow | null> {
  const result = await query(
    `SELECT
      a.id as id,
      a.class_id as classId,
      c.name as className,
      a.title as title,
      a.description as description,
      a.instructions as instructions,
      a.created_at as createdAt
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ?
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    [assignmentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    classId: toStringValue(row.classId),
    className: toStringValue(row.className),
    title: toStringValue(row.title),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    createdAt: toNumber(row.createdAt),
  };
}

export async function updateAssignment(
  assignmentId: string,
  input: { title: string; instructions: string }
): Promise<AssignmentDetailRow | null> {
  const result = await query(
    `UPDATE assignments
    SET title = ?, instructions = ?
    WHERE id = ?
      AND deleted_at IS NULL`,
    [input.title, input.instructions, assignmentId]
  );
  if (toNumber(result.rowsAffected) === 0) return null;
  return findAssignmentById(assignmentId);
}

export async function deleteAssignmentCascade(assignmentId: string): Promise<boolean> {
  const deletedAt = Date.now();
  await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE assignment_id = ?
      AND deleted_at IS NULL`,
    [deletedAt, assignmentId]
  );
  const result = await query(
    `UPDATE assignments
    SET deleted_at = ?
    WHERE id = ?
      AND deleted_at IS NULL`,
    [deletedAt, assignmentId]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function createSubmission(input: {
  assignmentId: string;
  studentName: string;
  studentEmail: string;
  audioBlobUrl: string;
}): Promise<{
  id: string;
  assignmentId: string;
  studentName: string;
  studentEmail: string;
  audioBlobUrl: string;
  submittedAt: number;
}> {
  const duplicate = await query(
    `SELECT id, submitted_at as submittedAt
    FROM submissions
    WHERE assignment_id = ?
      AND LOWER(student_email) = LOWER(?)
      AND deleted_at IS NULL
    ORDER BY submitted_at DESC
    LIMIT 1`,
    [input.assignmentId, input.studentEmail]
  );
  const recent = duplicate.rows[0];
  if (recent && Date.now() - toNumber(recent.submittedAt) < 60_000) {
    throw new Error("Looks like this recording was already submitted. Please wait before submitting again.");
  }

  const item = {
    id: makeId("sub"),
    assignmentId: input.assignmentId,
    studentName: input.studentName,
    studentEmail: input.studentEmail,
    audioBlobUrl: input.audioBlobUrl,
    submittedAt: Date.now(),
  };
  await query(
    `INSERT INTO submissions (
      id, assignment_id, student_name, student_email, audio_data, audio_blob_url, submitted_at, deleted_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)`,
    [item.id, item.assignmentId, item.studentName, item.studentEmail, item.audioBlobUrl, item.submittedAt]
  );
  return item;
}

export async function listSubmissionsByClassId(classId: string): Promise<SubmissionRow[]> {
  const result = await query(
    `SELECT
      s.id as id,
      s.assignment_id as assignmentId,
      a.title as assignmentTitle,
      s.student_name as studentName,
      s.student_email as studentEmail,
      s.submitted_at as submittedAt,
      COALESCE(s.feedback, '') as feedback,
      s.grade as grade
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY s.submitted_at DESC`,
    [classId]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    studentName: toStringValue(row.studentName),
    studentEmail: toStringValue(row.studentEmail),
    audioData: toProtectedAudioPath(toStringValue(row.id)),
    submittedAt: toNumber(row.submittedAt),
    feedback: toStringValue(row.feedback),
    grade: toNullableNumber(row.grade),
  }));
}

export async function findSubmissionById(submissionId: string): Promise<SubmissionRow | null> {
  const result = await query(
    `SELECT
      s.id as id,
      s.assignment_id as assignmentId,
      a.title as assignmentTitle,
      s.student_name as studentName,
      s.student_email as studentEmail,
      s.submitted_at as submittedAt,
      COALESCE(s.feedback, '') as feedback,
      s.grade as grade
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    [submissionId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    studentName: toStringValue(row.studentName),
    studentEmail: toStringValue(row.studentEmail),
    audioData: toProtectedAudioPath(toStringValue(row.id)),
    submittedAt: toNumber(row.submittedAt),
    feedback: toStringValue(row.feedback),
    grade: toNullableNumber(row.grade),
  };
}

export async function findSubmissionAccessById(submissionId: string): Promise<SubmissionAccessRow | null> {
  const result = await query(
    `SELECT
      s.id as id,
      s.student_email as studentEmail,
      COALESCE(s.audio_blob_url, s.audio_data, '') as audioBlobUrl
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    [submissionId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    studentEmail: toStringValue(row.studentEmail),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
  };
}

export async function updateSubmission(
  submissionId: string,
  input: { studentName: string; grade: number | null; feedback: string }
) {
  await query(
    `UPDATE submissions
    SET student_name = ?, grade = ?, feedback = ?
    WHERE id = ?
      AND deleted_at IS NULL`,
    [input.studentName, input.grade, input.feedback, submissionId]
  );
  return findSubmissionById(submissionId);
}

export async function deleteSubmission(submissionId: string): Promise<boolean> {
  const result = await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE id = ?
      AND deleted_at IS NULL`,
    [Date.now(), submissionId]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function listGradebookRowsByClassId(classId: string): Promise<GradebookRow[]> {
  const result = await query(
    `SELECT
      s.student_name as studentName,
      s.student_email as studentEmail,
      a.title as assignmentTitle,
      s.grade as grade,
      COALESCE(s.feedback, '') as feedback,
      s.submitted_at as submittedAt
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY LOWER(s.student_name), a.created_at DESC, s.submitted_at DESC`,
    [classId]
  );
  return result.rows.map((row) => ({
    studentName: toStringValue(row.studentName),
    studentEmail: toStringValue(row.studentEmail),
    assignmentTitle: toStringValue(row.assignmentTitle),
    grade: toNullableNumber(row.grade),
    feedback: toStringValue(row.feedback),
    submittedAt: toNumber(row.submittedAt),
  }));
}

export async function hardDeleteSoftDeletedBefore(cutoffTimestamp: number) {
  const submissionsDeleted = await query(
    `DELETE FROM submissions WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    [cutoffTimestamp]
  );
  const assignmentsDeleted = await query(
    `DELETE FROM assignments WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    [cutoffTimestamp]
  );
  const classesDeleted = await query(
    `DELETE FROM classes WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    [cutoffTimestamp]
  );
  return {
    submissionsDeleted: toNumber(submissionsDeleted.rowsAffected),
    assignmentsDeleted: toNumber(assignmentsDeleted.rowsAffected),
    classesDeleted: toNumber(classesDeleted.rowsAffected),
  };
}


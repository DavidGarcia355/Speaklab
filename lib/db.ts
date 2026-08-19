import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client, type InValue, type Row } from "@libsql/client";
import type { Rubric, RubricScore } from "@/lib/validation";

const QUERY_TIMEOUT_MS = 5000;

export type ClassRow = {
  id: string;
  name: string;
  ownerEmail: string;
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
  maxPoints: number;
  maxSubmissions: number;
  maxRecordingSeconds: number;
  rubric: Rubric | null;
  attachmentName: string;
  attachmentUrl: string;
  attachmentContentType: string;
  createdAt: number;
};

export type AssignmentSummaryRow = AssignmentRow & {
  submissionCount: number;
};

export type AssignmentDetailRow = AssignmentRow & {
  className: string;
  ownerEmail: string;
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
  rubricScores: RubricScore[] | null;
};

export type GradebookRow = {
  studentName: string;
  studentEmail: string;
  assignmentTitle: string;
  grade: number | null;
  feedback: string;
  submittedAt: number;
};

export type StudentSubmissionRow = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  maxPoints: number;
  studentName: string;
  submittedAt: number;
  feedback: string;
  grade: number | null;
};

export type StudentAssignmentHistoryRow = {
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  maxPoints: number;
};

export type FeedbackRow = {
  id: string;
  name: string;
  email: string;
  school: string;
  role: string;
  message: string;
  createdAt: number;
};

export type UserRole = "teacher" | "student";
export type ActivityEventType =
  | "user_signed_in"
  | "teacher_upgraded"
  | "class_created"
  | "assignment_created";

export type ActivityEventRow = {
  id: string;
  email: string;
  eventType: ActivityEventType;
  occurredAt: number;
  metadata: Record<string, unknown> | null;
};

export type TeacherFunnelRow = {
  email: string;
  role: UserRole;
  joinedAt: number;
  classCount: number;
  assignmentCount: number;
  submissionCount: number;
  latestActivityAt: number | null;
  isPaid: boolean;
};

export type TrackingSummaryRow = {
  totalUsers: number;
  teacherAccounts: number;
  activatedTeachers: number;
  teachingReadyTeachers: number;
};

export type RosterRow = {
  id: string;
  classId: string;
  studentEmail: string;
  studentName: string;
  addedAt: number;
  addedBy: "submission" | "teacher";
};

export type StudentEnrolledRow = {
  classId: string;
  className: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  maxPoints: number;
  submissionCount: number;
};

export type StudentAssignmentRow = {
  assignmentId: string;
  assignmentTitle: string;
  maxPoints: number;
  createdAt: number;
  submissionId: string | null;
  submittedAt: number | null;
  grade: number | null;
  feedback: string;
};

export type AiGradingAttemptStatus = "completed" | "failed";

export type AiGradingAttemptRow = {
  id: string;
  submissionId: string;
  teacherEmail: string;
  status: AiGradingAttemptStatus;
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: string;
  durationSeconds: number;
  suggestedScore: number | null;
  rubricScores: RubricScore[];
  feedback: string;
  strengths: string[];
  improvements: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
  teacherAttention: string;
  transcriptionProvider: string;
  gradingProvider: string;
  transcriptionModel: string;
  gradingModel: string;
  errorCode: string;
  errorMessage: string;
  createdAt: number;
  completedAt: number | null;
};

/**
 * Emails granted full teacher access automatically on sign-in.
 *
 * Merges TEACHER_ALLOWLIST with the admin emails (ADMIN_EMAILS / ADMIN_EMAIL) so
 * an admin never has to be listed twice to be able to use teacher features.
 * Env is read directly rather than importing lib/admin.ts, because auth.ts already
 * imports this module and that would create a circular import.
 */
function getTeacherAllowlist(): Set<string> {
  const raw = [
    process.env.TEACHER_ALLOWLIST ?? "",
    process.env.ADMIN_EMAILS ?? "",
    process.env.ADMIN_EMAIL ?? "",
  ].join(",");
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function defaultRoleForEmail(email: string): UserRole {
  return getTeacherAllowlist().has(email.trim().toLowerCase()) ? "teacher" : "student";
}

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
  const localPath = process.env.HABLA_LOCAL_DB_PATH?.trim() || path.join(dataDir, "local.db");
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

async function ensureColumn(
  tableName: "classes" | "assignments" | "submissions" | "users",
  columnName: string,
  definition: string
) {
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
          owner_email TEXT NOT NULL DEFAULT '',
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
        `CREATE TABLE IF NOT EXISTS feedback_messages (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          school TEXT NOT NULL,
          role TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY,
          role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('teacher', 'student')),
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS activity_events (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          event_type TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          metadata TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS roster (
          id TEXT PRIMARY KEY,
          class_id TEXT NOT NULL,
          student_email TEXT NOT NULL,
          student_name TEXT NOT NULL DEFAULT '',
          added_at INTEGER NOT NULL,
          added_by TEXT NOT NULL DEFAULT 'submission' CHECK (added_by IN ('submission', 'teacher')),
          FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS ai_grading_attempts (
          id TEXT PRIMARY KEY,
          submission_id TEXT NOT NULL,
          teacher_email TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
          transcript TEXT NOT NULL DEFAULT '',
          detected_language TEXT NOT NULL DEFAULT '',
          transcript_quality TEXT NOT NULL DEFAULT '',
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          suggested_score INTEGER,
          rubric_scores TEXT,
          feedback TEXT NOT NULL DEFAULT '',
          strengths TEXT,
          improvements TEXT,
          evidence TEXT,
          confidence TEXT NOT NULL DEFAULT 'low',
          warnings TEXT,
          teacher_attention TEXT NOT NULL DEFAULT 'review',
          transcription_provider TEXT NOT NULL DEFAULT '',
          grading_provider TEXT NOT NULL DEFAULT '',
          transcription_model TEXT NOT NULL DEFAULT '',
          grading_model TEXT NOT NULL DEFAULT '',
          error_code TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS ai_budget_reservations (
          id TEXT PRIMARY KEY,
          generation_count INTEGER NOT NULL CHECK (generation_count > 0),
          reserved_microusd INTEGER NOT NULL CHECK (reserved_microusd > 0),
          created_at INTEGER NOT NULL
        )`,
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_class_student ON roster(class_id, LOWER(student_email))",
        "CREATE INDEX IF NOT EXISTS idx_roster_class_id ON roster(class_id)",
        "CREATE INDEX IF NOT EXISTS idx_ai_grading_attempts_submission ON ai_grading_attempts(submission_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_grading_attempts_teacher ON ai_grading_attempts(LOWER(teacher_email), created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_created ON ai_budget_reservations(created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_assignments_class_id ON assignments(class_id)",
        "CREATE INDEX IF NOT EXISTS idx_assignments_deleted_at ON assignments(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON submissions(assignment_id)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_student_name ON submissions(student_name)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_student_email ON submissions(student_email)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_deleted_at ON submissions(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_feedback_messages_created_at ON feedback_messages(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)",
        "CREATE INDEX IF NOT EXISTS idx_activity_events_email ON activity_events(email)",
        "CREATE INDEX IF NOT EXISTS idx_activity_events_occurred_at ON activity_events(occurred_at DESC)",
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
      await ensureColumn("classes", "owner_email", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("assignments", "deleted_at", "INTEGER");
      await ensureColumn("assignments", "max_points", "INTEGER NOT NULL DEFAULT 100");
      await ensureColumn("assignments", "rubric", "TEXT");
      await ensureColumn("assignments", "attachment_name", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("assignments", "attachment_url", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("assignments", "attachment_content_type", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("assignments", "max_submissions", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("assignments", "max_recording_seconds", "INTEGER NOT NULL DEFAULT 180");
      await ensureColumn("submissions", "student_email", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("submissions", "audio_blob_url", "TEXT");
      await ensureColumn("submissions", "rubric_scores", "TEXT");
      await ensureColumn("submissions", "deleted_at", "INTEGER");
      await ensureColumn("users", "is_paid", "INTEGER NOT NULL DEFAULT 0");
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

function parseJsonValue<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function stringifyJsonValue(value: unknown) {
  return value === null ? null : JSON.stringify(value);
}

function normalizeUserRole(value: unknown): UserRole {
  return toStringValue(value).toLowerCase() === "teacher" ? "teacher" : "student";
}

export async function listClasses(): Promise<ClassSummaryRow[]> {
  return listClassesByTeacher("");
}

export async function listClassesByTeacher(ownerEmail: string): Promise<ClassSummaryRow[]> {
  const result = await query(
    `SELECT
      c.id as id,
      c.name as name,
      c.owner_email as ownerEmail,
      c.created_at as createdAt,
      COUNT(DISTINCT a.id) as assignmentCount,
      COUNT(s.id) as submissionCount
    FROM classes c
    LEFT JOIN assignments a ON a.class_id = c.id AND a.deleted_at IS NULL
    LEFT JOIN submissions s ON s.assignment_id = a.id AND s.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
      AND (? = '' OR LOWER(c.owner_email) = LOWER(?))
    GROUP BY c.id
    ORDER BY c.created_at DESC`,
    [ownerEmail, ownerEmail]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    name: toStringValue(row.name),
    ownerEmail: toStringValue(row.ownerEmail),
    createdAt: toNumber(row.createdAt),
    assignmentCount: toNumber(row.assignmentCount),
    submissionCount: toNumber(row.submissionCount),
  }));
}

export async function findClassById(classId: string, ownerEmail?: string): Promise<ClassRow | null> {
  const result = await query(
    `SELECT id, name, owner_email as ownerEmail, created_at as createdAt
    FROM classes
    WHERE id = ?
      AND deleted_at IS NULL
      AND (? IS NULL OR LOWER(owner_email) = LOWER(?))
    LIMIT 1`,
    [classId, ownerEmail ?? null, ownerEmail ?? null]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    name: toStringValue(row.name),
    ownerEmail: toStringValue(row.ownerEmail),
    createdAt: toNumber(row.createdAt),
  };
}

export async function createClass(name: string, ownerEmail: string): Promise<ClassRow> {
  const duplicate = await query(
    `SELECT id FROM classes
    WHERE LOWER(name) = LOWER(?)
      AND LOWER(owner_email) = LOWER(?)
      AND deleted_at IS NULL
    LIMIT 1`,
    [name, ownerEmail]
  );
  if (duplicate.rows.length > 0) {
    throw new Error("Class name already exists.");
  }

  const item: ClassRow = {
    id: makeId("class"),
    name,
    ownerEmail: ownerEmail.toLowerCase(),
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO classes (id, name, owner_email, created_at, deleted_at)
    VALUES (?, ?, ?, ?, NULL)`,
    [item.id, item.name, item.ownerEmail, item.createdAt]
  );
  return item;
}

async function assertUniqueAssignmentTitle(
  classId: string,
  ownerEmail: string,
  title: string,
  excludeAssignmentId?: string
) {
  const duplicate = await query(
    `SELECT a.id
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND LOWER(a.title) = LOWER(?)
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND LOWER(c.owner_email) = LOWER(?)
      AND (? IS NULL OR a.id <> ?)
    LIMIT 1`,
    [classId, title, ownerEmail, excludeAssignmentId ?? null, excludeAssignmentId ?? null]
  );
  if (duplicate.rows.length > 0) {
    throw new Error("Assignment title already exists in this class.");
  }
}

export async function updateClassName(
  classId: string,
  name: string,
  ownerEmail: string
): Promise<ClassRow | null> {
  const duplicate = await query(
    `SELECT id FROM classes
    WHERE LOWER(name) = LOWER(?)
      AND LOWER(owner_email) = LOWER(?)
      AND id <> ?
      AND deleted_at IS NULL
    LIMIT 1`,
    [name, ownerEmail, classId]
  );
  if (duplicate.rows.length > 0) {
    throw new Error("Class name already exists.");
  }

  const result = await query(
    `UPDATE classes
    SET name = ?
    WHERE id = ?
      AND LOWER(owner_email) = LOWER(?)
      AND deleted_at IS NULL`,
    [name, classId, ownerEmail]
  );
  if (toNumber(result.rowsAffected) === 0) return null;
  return findClassById(classId, ownerEmail);
}

export async function deleteClassCascade(classId: string, ownerEmail: string): Promise<boolean> {
  const deletedAt = Date.now();
  await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE assignment_id IN (
      SELECT a.id
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE c.id = ?
        AND LOWER(c.owner_email) = LOWER(?)
    )
      AND deleted_at IS NULL`,
    [deletedAt, classId, ownerEmail]
  );
  await query(
    `UPDATE assignments
    SET deleted_at = ?
    WHERE class_id = ?
      AND class_id IN (
        SELECT id FROM classes WHERE id = ? AND LOWER(owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [deletedAt, classId, classId, ownerEmail]
  );
  const result = await query(
    `UPDATE classes
    SET deleted_at = ?
    WHERE id = ?
      AND LOWER(owner_email) = LOWER(?)
      AND deleted_at IS NULL`,
    [deletedAt, classId, ownerEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function listAssignmentsByClassId(classId: string, ownerEmail?: string): Promise<AssignmentSummaryRow[]> {
  const result = await query(
    `SELECT
      a.id as id,
      a.class_id as classId,
      a.title as title,
      a.description as description,
      a.instructions as instructions,
      COALESCE(a.max_points, 100) as maxPoints,
      COALESCE(a.max_submissions, 0) as maxSubmissions,
      COALESCE(a.max_recording_seconds, 180) as maxRecordingSeconds,
      a.rubric as rubric,
      COALESCE(a.attachment_name, '') as attachmentName,
      COALESCE(a.attachment_url, '') as attachmentUrl,
      COALESCE(a.attachment_content_type, '') as attachmentContentType,
      a.created_at as createdAt,
      COUNT(s.id) as submissionCount
    FROM assignments a
    LEFT JOIN submissions s ON s.assignment_id = a.id AND s.deleted_at IS NULL
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    GROUP BY a.id
    ORDER BY a.created_at DESC`,
    [classId, ownerEmail ?? null, ownerEmail ?? null]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    classId: toStringValue(row.classId),
    title: toStringValue(row.title),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    maxPoints: toNumber(row.maxPoints),
    maxSubmissions: toNumber(row.maxSubmissions),
    maxRecordingSeconds: toNumber(row.maxRecordingSeconds),
    rubric: parseJsonValue<Rubric>(row.rubric),
    attachmentName: toStringValue(row.attachmentName),
    attachmentUrl: toStringValue(row.attachmentUrl),
    attachmentContentType: toStringValue(row.attachmentContentType),
    createdAt: toNumber(row.createdAt),
    submissionCount: toNumber(row.submissionCount),
  }));
}

export async function createAssignment(input: {
  id?: string;
  classId: string;
  ownerEmail: string;
  title: string;
  description: string;
  instructions: string;
  maxPoints: number;
  maxSubmissions: number;
  maxRecordingSeconds: number;
  rubric: Rubric | null;
  attachmentName: string;
  attachmentUrl: string;
  attachmentContentType: string;
}): Promise<AssignmentRow> {
  await assertUniqueAssignmentTitle(input.classId, input.ownerEmail, input.title);

  const item: AssignmentRow = {
    id: input.id ?? makeId("asg"),
    classId: input.classId,
    title: input.title,
    description: input.description,
    instructions: input.instructions,
    maxPoints: input.maxPoints,
    maxSubmissions: input.maxSubmissions,
    maxRecordingSeconds: input.maxRecordingSeconds,
    rubric: input.rubric,
    attachmentName: input.attachmentName,
    attachmentUrl: input.attachmentUrl,
    attachmentContentType: input.attachmentContentType,
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO assignments (
      id, class_id, title, description, instructions, max_points, max_submissions, max_recording_seconds, rubric, attachment_name, attachment_url, attachment_content_type, created_at, deleted_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
    WHERE EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = ?
        AND c.deleted_at IS NULL
        AND LOWER(c.owner_email) = LOWER(?)
    )`,
    [
      item.id,
      item.classId,
      item.title,
      item.description,
      item.instructions,
      item.maxPoints,
      item.maxSubmissions,
      item.maxRecordingSeconds,
      stringifyJsonValue(item.rubric),
      item.attachmentName,
      item.attachmentUrl,
      item.attachmentContentType,
      item.createdAt,
      input.classId,
      input.ownerEmail,
    ]
  );
  return item;
}

export async function findAssignmentById(assignmentId: string, ownerEmail?: string): Promise<AssignmentDetailRow | null> {
  const result = await query(
    `SELECT
      a.id as id,
      a.class_id as classId,
      c.name as className,
      c.owner_email as ownerEmail,
      a.title as title,
      a.description as description,
      a.instructions as instructions,
      COALESCE(a.max_points, 100) as maxPoints,
      COALESCE(a.max_submissions, 0) as maxSubmissions,
      COALESCE(a.max_recording_seconds, 180) as maxRecordingSeconds,
      a.rubric as rubric,
      COALESCE(a.attachment_name, '') as attachmentName,
      COALESCE(a.attachment_url, '') as attachmentUrl,
      COALESCE(a.attachment_content_type, '') as attachmentContentType,
      a.created_at as createdAt
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ?
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    LIMIT 1`,
    [assignmentId, ownerEmail ?? null, ownerEmail ?? null]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    classId: toStringValue(row.classId),
    className: toStringValue(row.className),
    ownerEmail: toStringValue(row.ownerEmail),
    title: toStringValue(row.title),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    maxPoints: toNumber(row.maxPoints),
    maxSubmissions: toNumber(row.maxSubmissions),
    maxRecordingSeconds: toNumber(row.maxRecordingSeconds),
    rubric: parseJsonValue<Rubric>(row.rubric),
    attachmentName: toStringValue(row.attachmentName),
    attachmentUrl: toStringValue(row.attachmentUrl),
    attachmentContentType: toStringValue(row.attachmentContentType),
    createdAt: toNumber(row.createdAt),
  };
}

export async function updateAssignment(
  assignmentId: string,
  ownerEmail: string,
  input: {
    title: string;
    description: string;
    instructions: string;
    maxPoints: number;
    maxSubmissions: number;
    maxRecordingSeconds: number;
    rubric: Rubric | null;
    attachmentName: string;
    attachmentUrl: string;
    attachmentContentType: string;
  }
): Promise<AssignmentDetailRow | null> {
  const current = await findAssignmentById(assignmentId, ownerEmail);
  if (!current) return null;

  await assertUniqueAssignmentTitle(current.classId, ownerEmail, input.title, assignmentId);

  const result = await query(
    `UPDATE assignments
    SET title = ?, description = ?, instructions = ?, max_points = ?, max_submissions = ?, max_recording_seconds = ?, rubric = ?, attachment_name = ?, attachment_url = ?, attachment_content_type = ?
    WHERE id = ?
      AND deleted_at IS NULL
      AND id IN (
        SELECT a.id
        FROM assignments a
        JOIN classes c ON c.id = a.class_id
        WHERE a.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )`,
    [
      input.title,
      input.description,
      input.instructions,
      input.maxPoints,
      input.maxSubmissions,
      input.maxRecordingSeconds,
      stringifyJsonValue(input.rubric),
      input.attachmentName,
      input.attachmentUrl,
      input.attachmentContentType,
      assignmentId,
      assignmentId,
      ownerEmail,
    ]
  );
  if (toNumber(result.rowsAffected) === 0) return null;
  return findAssignmentById(assignmentId, ownerEmail);
}

export async function deleteAssignmentCascade(assignmentId: string, ownerEmail: string): Promise<boolean> {
  const deletedAt = Date.now();
  await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE assignment_id = ?
      AND assignment_id IN (
        SELECT a.id
        FROM assignments a
        JOIN classes c ON c.id = a.class_id
        WHERE a.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [deletedAt, assignmentId, assignmentId, ownerEmail]
  );
  const result = await query(
    `UPDATE assignments
    SET deleted_at = ?
    WHERE id = ?
      AND id IN (
        SELECT a.id
        FROM assignments a
        JOIN classes c ON c.id = a.class_id
        WHERE a.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [deletedAt, assignmentId, assignmentId, ownerEmail]
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

export async function listSubmissionsByClassId(classId: string, ownerEmail?: string): Promise<SubmissionRow[]> {
  const result = await query(
    `SELECT
      s.id as id,
      s.assignment_id as assignmentId,
      a.title as assignmentTitle,
      s.student_name as studentName,
      s.student_email as studentEmail,
      s.submitted_at as submittedAt,
      COALESCE(s.feedback, '') as feedback,
      s.grade as grade,
      s.rubric_scores as rubricScores
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    ORDER BY s.submitted_at DESC`,
    [classId, ownerEmail ?? null, ownerEmail ?? null]
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
    rubricScores: parseJsonValue<RubricScore[]>(row.rubricScores),
  }));
}

export async function listSubmissionsByStudentEmail(studentEmail: string): Promise<StudentSubmissionRow[]> {
  const result = await query(
    `SELECT
      s.id as id,
      s.assignment_id as assignmentId,
      a.title as assignmentTitle,
      c.name as className,
      a.max_points as maxPoints,
      s.student_name as studentName,
      s.submitted_at as submittedAt,
      COALESCE(s.feedback, '') as feedback,
      s.grade as grade
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE LOWER(s.student_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY s.submitted_at DESC`,
    [studentEmail]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    className: toStringValue(row.className),
    maxPoints: toNumber(row.maxPoints),
    studentName: toStringValue(row.studentName),
    submittedAt: toNumber(row.submittedAt),
    feedback: toStringValue(row.feedback),
    grade: toNullableNumber(row.grade),
  }));
}

export async function listStudentAssignmentHistoryByEmail(
  studentEmail: string
): Promise<StudentAssignmentHistoryRow[]> {
  const result = await query(
    `SELECT
      a.id as assignmentId,
      a.title as assignmentTitle,
      c.name as className,
      a.max_points as maxPoints,
      MAX(s.submitted_at) as lastSeenAt
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE LOWER(s.student_email) = LOWER(?)
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    GROUP BY a.id, a.title, c.name, a.max_points
    ORDER BY lastSeenAt DESC, LOWER(c.name), LOWER(a.title)`,
    [studentEmail]
  );
  return result.rows.map((row) => ({
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    className: toStringValue(row.className),
    maxPoints: toNumber(row.maxPoints),
  }));
}

export async function listEnrolledClassesWithAssignmentsByEmail(
  studentEmail: string
): Promise<StudentEnrolledRow[]> {
  const result = await query(
    `SELECT
      c.id as classId,
      c.name as className,
      a.id as assignmentId,
      a.title as assignmentTitle,
      COALESCE(a.max_points, 0) as maxPoints,
      COALESCE(sub_counts.submissionCount, 0) as submissionCount
    FROM roster r
    JOIN classes c ON c.id = r.class_id
    LEFT JOIN assignments a ON a.class_id = c.id AND a.deleted_at IS NULL
    LEFT JOIN (
      SELECT assignment_id, COUNT(*) as submissionCount
      FROM submissions
      WHERE LOWER(student_email) = LOWER(?)
        AND deleted_at IS NULL
      GROUP BY assignment_id
    ) sub_counts ON sub_counts.assignment_id = a.id
    WHERE LOWER(r.student_email) = LOWER(?)
      AND c.deleted_at IS NULL
    ORDER BY c.created_at DESC, a.created_at ASC`,
    [studentEmail, studentEmail]
  );
  return result.rows.map((row) => ({
    classId: toStringValue(row.classId),
    className: toStringValue(row.className),
    assignmentId: row.assignmentId === null ? null : toStringValue(row.assignmentId),
    assignmentTitle: row.assignmentTitle === null ? null : toStringValue(row.assignmentTitle),
    maxPoints: toNumber(row.maxPoints),
    submissionCount: toNumber(row.submissionCount),
  }));
}

export async function findSubmissionById(submissionId: string, ownerEmail?: string): Promise<SubmissionRow | null> {
  const result = await query(
    `SELECT
      s.id as id,
      s.assignment_id as assignmentId,
      a.title as assignmentTitle,
      s.student_name as studentName,
      s.student_email as studentEmail,
      s.submitted_at as submittedAt,
      COALESCE(s.feedback, '') as feedback,
      s.grade as grade,
      s.rubric_scores as rubricScores
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    LIMIT 1`,
    [submissionId, ownerEmail ?? null, ownerEmail ?? null]
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
    rubricScores: parseJsonValue<RubricScore[]>(row.rubricScores),
  };
}

export async function findSubmissionAccessById(
  submissionId: string,
  ownerEmail?: string
): Promise<SubmissionAccessRow | null> {
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
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    LIMIT 1`,
    [submissionId, ownerEmail ?? null, ownerEmail ?? null]
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
  ownerEmail: string,
  input: { studentName: string; grade: number | null; feedback: string; rubricScores: RubricScore[] | null }
) {
  await query(
    `UPDATE submissions
    SET student_name = ?, grade = ?, feedback = ?, rubric_scores = ?
    WHERE id = ?
      AND id IN (
        SELECT s.id
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [
      input.studentName,
      input.grade,
      input.feedback,
      stringifyJsonValue(input.rubricScores),
      submissionId,
      submissionId,
      ownerEmail,
    ]
  );
  return findSubmissionById(submissionId, ownerEmail);
}

export async function deleteSubmission(submissionId: string, ownerEmail: string): Promise<boolean> {
  const result = await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE id = ?
      AND id IN (
        SELECT s.id
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [Date.now(), submissionId, submissionId, ownerEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function countStudentSubmissions(assignmentId: string, studentEmail: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt
    FROM submissions
    WHERE assignment_id = ?
      AND LOWER(student_email) = LOWER(?)
      AND deleted_at IS NULL`,
    [assignmentId, studentEmail]
  );
  return toNumber(result.rows[0]?.cnt);
}

export async function isStudentOnRoster(classId: string, studentEmail: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
    FROM roster
    WHERE class_id = ?
      AND LOWER(student_email) = LOWER(?)
    LIMIT 1`,
    [classId, studentEmail]
  );
  return result.rows.length > 0;
}

export async function deleteSubmissionByStudent(submissionId: string, studentEmail: string): Promise<boolean> {
  const result = await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE id = ?
      AND LOWER(student_email) = LOWER(?)
      AND grade IS NULL
      AND deleted_at IS NULL`,
    [Date.now(), submissionId, studentEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function listGradebookRowsByClassId(classId: string, ownerEmail?: string): Promise<GradebookRow[]> {
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
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    ORDER BY LOWER(s.student_name), a.created_at DESC, s.submitted_at DESC`,
    [classId, ownerEmail ?? null, ownerEmail ?? null]
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

export async function listStorageObjectsForHardDeleteBefore(cutoffTimestamp: number) {
  const audioResult = await query(
    `SELECT COALESCE(audio_blob_url, '') as audioBlobUrl
    FROM submissions
    WHERE deleted_at IS NOT NULL
      AND deleted_at < ?
      AND COALESCE(audio_blob_url, '') <> ''`,
    [cutoffTimestamp]
  );
  const attachmentResult = await query(
    `SELECT DISTINCT a.attachment_url as attachmentUrl
    FROM assignments a
    WHERE a.deleted_at IS NOT NULL
      AND a.deleted_at < ?
      AND COALESCE(a.attachment_url, '') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM assignments active
        WHERE active.attachment_url = a.attachment_url
          AND active.id <> a.id
          AND (active.deleted_at IS NULL OR active.deleted_at >= ?)
      )`,
    [cutoffTimestamp, cutoffTimestamp]
  );
  return {
    audioBlobUrls: audioResult.rows.map((row) => toStringValue(row.audioBlobUrl)).filter(Boolean),
    attachmentUrls: attachmentResult.rows.map((row) => toStringValue(row.attachmentUrl)).filter(Boolean),
  };
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

export async function createFeedbackMessage(input: {
  name: string;
  email: string;
  school: string;
  role: string;
  message: string;
}): Promise<FeedbackRow> {
  const item: FeedbackRow = {
    id: makeId("fb"),
    name: input.name,
    email: input.email,
    school: input.school,
    role: input.role,
    message: input.message,
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO feedback_messages (id, name, email, school, role, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.name, item.email, item.school, item.role, item.message, item.createdAt]
  );
  return item;
}

export async function listFeedbackMessages(): Promise<FeedbackRow[]> {
  const result = await query(
    `SELECT id, name, email, school, role, message, created_at FROM feedback_messages ORDER BY created_at DESC`,
    []
  );
  return result.rows.map((r) => ({
    id: toStringValue(r.id),
    name: toStringValue(r.name),
    email: toStringValue(r.email),
    school: toStringValue(r.school),
    role: toStringValue(r.role),
    message: toStringValue(r.message),
    createdAt: toNumber(r.created_at),
  }));
}

export async function deleteFeedbackMessage(id: string): Promise<boolean> {
  const result = await query(`DELETE FROM feedback_messages WHERE id = ?`, [id]);
  return result.rowsAffected > 0;
}

export async function logActivityEvent(input: {
  email: string;
  eventType: ActivityEventType;
  metadata?: Record<string, unknown> | null;
}) {
  const item: ActivityEventRow = {
    id: makeId("evt"),
    email: input.email.trim().toLowerCase(),
    eventType: input.eventType,
    occurredAt: Date.now(),
    metadata: input.metadata ?? null,
  };
  await query(
    `INSERT INTO activity_events (id, email, event_type, occurred_at, metadata)
    VALUES (?, ?, ?, ?, ?)`,
    [item.id, item.email, item.eventType, item.occurredAt, stringifyJsonValue(item.metadata)]
  );
  return item;
}

export async function listRecentActivityEvents(limit = 50): Promise<ActivityEventRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const result = await query(
    `SELECT id, email, event_type as eventType, occurred_at as occurredAt, metadata
    FROM activity_events
    ORDER BY occurred_at DESC
    LIMIT ?`,
    [safeLimit]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    email: toStringValue(row.email),
    eventType: toStringValue(row.eventType) as ActivityEventType,
    occurredAt: toNumber(row.occurredAt),
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata),
  }));
}

export async function listRecentTeacherActivityEvents(limit = 50): Promise<ActivityEventRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const result = await query(
    `SELECT e.id, e.email, e.event_type as eventType, e.occurred_at as occurredAt, e.metadata
    FROM activity_events e
    JOIN users u ON LOWER(u.email) = LOWER(e.email)
    WHERE u.role = 'teacher'
      AND e.event_type <> 'user_signed_in'
    ORDER BY e.occurred_at DESC
    LIMIT ?`,
    [safeLimit]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    email: toStringValue(row.email),
    eventType: toStringValue(row.eventType) as ActivityEventType,
    occurredAt: toNumber(row.occurredAt),
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata),
  }));
}

export async function listTeacherFunnelRows(): Promise<TeacherFunnelRow[]> {
  const result = await query(
    `SELECT
      u.email as email,
      u.role as role,
      u.created_at as joinedAt,
      COALESCE(class_counts.classCount, 0) as classCount,
      COALESCE(assignment_counts.assignmentCount, 0) as assignmentCount,
      COALESCE(submission_counts.submissionCount, 0) as submissionCount,
      activity.latestActivityAt as latestActivityAt,
      u.is_paid as isPaid
    FROM users u
    LEFT JOIN (
      SELECT LOWER(owner_email) as email, COUNT(*) as classCount
      FROM classes
      WHERE deleted_at IS NULL
      GROUP BY LOWER(owner_email)
    ) class_counts ON class_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(c.owner_email) as email, COUNT(*) as assignmentCount
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY LOWER(c.owner_email)
    ) assignment_counts ON assignment_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(c.owner_email) as email, COUNT(*) as submissionCount
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE s.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY LOWER(c.owner_email)
    ) submission_counts ON submission_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(email) as email, MAX(occurred_at) as latestActivityAt
      FROM activity_events
      GROUP BY LOWER(email)
    ) activity ON activity.email = LOWER(u.email)
    WHERE u.role = 'teacher'
    ORDER BY joinedAt DESC`
  );
  return result.rows.map((row) => ({
    email: toStringValue(row.email),
    role: normalizeUserRole(row.role),
    joinedAt: toNumber(row.joinedAt),
    classCount: toNumber(row.classCount),
    assignmentCount: toNumber(row.assignmentCount),
    submissionCount: toNumber(row.submissionCount),
    latestActivityAt: row.latestActivityAt === null ? null : toNumber(row.latestActivityAt),
    isPaid: toNumber(row.isPaid) === 1,
  }));
}

export async function findTeacherFunnelRowByEmail(
  teacherEmail: string
): Promise<TeacherFunnelRow | null> {
  const result = await query(
    `SELECT
      u.email as email,
      u.role as role,
      u.created_at as joinedAt,
      COALESCE(class_counts.classCount, 0) as classCount,
      COALESCE(assignment_counts.assignmentCount, 0) as assignmentCount,
      COALESCE(submission_counts.submissionCount, 0) as submissionCount,
      activity.latestActivityAt as latestActivityAt,
      u.is_paid as isPaid
    FROM users u
    LEFT JOIN (
      SELECT LOWER(owner_email) as email, COUNT(*) as classCount
      FROM classes
      WHERE deleted_at IS NULL
      GROUP BY LOWER(owner_email)
    ) class_counts ON class_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(c.owner_email) as email, COUNT(*) as assignmentCount
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY LOWER(c.owner_email)
    ) assignment_counts ON assignment_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(c.owner_email) as email, COUNT(*) as submissionCount
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE s.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY LOWER(c.owner_email)
    ) submission_counts ON submission_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(email) as email, MAX(occurred_at) as latestActivityAt
      FROM activity_events
      GROUP BY LOWER(email)
    ) activity ON activity.email = LOWER(u.email)
    WHERE u.role = 'teacher'
      AND LOWER(u.email) = LOWER(?)
    LIMIT 1`,
    [teacherEmail]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    email: toStringValue(row.email),
    role: normalizeUserRole(row.role),
    joinedAt: toNumber(row.joinedAt),
    classCount: toNumber(row.classCount),
    assignmentCount: toNumber(row.assignmentCount),
    submissionCount: toNumber(row.submissionCount),
    latestActivityAt: row.latestActivityAt === null ? null : toNumber(row.latestActivityAt),
    isPaid: toNumber(row.isPaid) === 1,
  };
}

export async function getTrackingSummary(): Promise<TrackingSummaryRow> {
  const result = await query(
    `SELECT
      COUNT(*) as totalUsers,
      SUM(CASE WHEN role = 'teacher' THEN 1 ELSE 0 END) as teacherAccounts,
      SUM(
        CASE
          WHEN role = 'teacher' AND EXISTS (
            SELECT 1 FROM classes c
            WHERE LOWER(c.owner_email) = LOWER(users.email)
              AND c.deleted_at IS NULL
          ) THEN 1
          ELSE 0
        END
      ) as activatedTeachers,
      SUM(
        CASE
          WHEN role = 'teacher' AND EXISTS (
            SELECT 1
            FROM assignments a
            JOIN classes c ON c.id = a.class_id
            WHERE LOWER(c.owner_email) = LOWER(users.email)
              AND c.deleted_at IS NULL
              AND a.deleted_at IS NULL
          ) THEN 1
          ELSE 0
        END
      ) as teachingReadyTeachers
    FROM users`
  );
  const row = result.rows[0];
  return {
    totalUsers: toNumber(row?.totalUsers),
    teacherAccounts: toNumber(row?.teacherAccounts),
    activatedTeachers: toNumber(row?.activatedTeachers),
    teachingReadyTeachers: toNumber(row?.teachingReadyTeachers),
  };
}

export async function upsertGoogleUserAndGetRole(email: string): Promise<UserRole> {
  const normalized = email.trim().toLowerCase();
  const defaultRole = defaultRoleForEmail(normalized);

  if (getTeacherAllowlist().has(normalized)) {
    // Allowlisted (teacher/admin) accounts are re-promoted on EVERY sign-in, not just
    // on first insert. Without this, an account that already signed in once as a
    // student stays a student forever and every teacher API returns 403 — a silent
    // failure that is very hard to diagnose. is_paid is set so AI grading (which
    // returns 402 for unpaid users) works for these accounts too.
    // This only ever grants access; it never demotes an existing teacher.
    await query(
      `INSERT INTO users (email, role, created_at, is_paid)
      VALUES (?, 'teacher', ?, 1)
      ON CONFLICT(email) DO UPDATE SET role = 'teacher', is_paid = 1`,
      [normalized, Date.now()]
    );
  } else {
    await query(
      `INSERT INTO users (email, role, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(email) DO NOTHING`,
      [normalized, defaultRole, Date.now()]
    );
  }
  const result = await query(
    `SELECT role
    FROM users
    WHERE LOWER(email) = LOWER(?)
    LIMIT 1`,
    [normalized]
  );
  return normalizeUserRole(result.rows[0]?.role);
}

export async function getUserRoleByEmail(email: string): Promise<UserRole> {
  const normalized = email.trim().toLowerCase();
  const result = await query(
    `SELECT role
    FROM users
    WHERE LOWER(email) = LOWER(?)
    LIMIT 1`,
    [normalized]
  );
  return normalizeUserRole(result.rows[0]?.role);
}

export async function setUserRoleTeacher(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await query(
    `INSERT INTO users (email, role, created_at)
    VALUES (?, 'teacher', ?)
    ON CONFLICT(email) DO UPDATE SET role = 'teacher'`,
    [normalized, Date.now()]
  );
}

export async function getUserIsPaid(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const result = await query(
    `SELECT is_paid FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [normalized]
  );
  return toNumber(result.rows[0]?.is_paid) === 1;
}

export async function setUserPaid(email: string, isPaid: boolean): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const result = await query(
    `UPDATE users SET is_paid = ? WHERE LOWER(email) = LOWER(?)`,
    [isPaid ? 1 : 0, normalized]
  );
  return result.rowsAffected > 0;
}

export type SubmissionForAiGradeRow = {
  submissionId: string;
  assignmentId: string;
  assignmentTitle: string;
  audioBlobUrl: string;
  description: string;
  instructions: string;
  rubric: Rubric | null;
  maxPoints: number;
  finalGrade: number | null;
  finalFeedback: string;
};

/**
 * Submissions in one assignment that a bulk AI run should touch: still
 * ungraded, still present, and actually holding audio. Ordered oldest first so
 * a partial run works through the backlog in the order students submitted.
 */
export async function listUngradedSubmissionsForAiGrade(
  assignmentId: string,
  ownerEmail: string
): Promise<Array<SubmissionForAiGradeRow & { studentName: string }>> {
  const result = await query(
    `SELECT
      s.id as submissionId,
      s.student_name as studentName,
      a.id as assignmentId,
      a.title as assignmentTitle,
      COALESCE(s.audio_blob_url, s.audio_data, '') as audioBlobUrl,
      COALESCE(a.description, '') as description,
      a.instructions as instructions,
      a.rubric as rubric,
      a.max_points as maxPoints,
      s.grade as finalGrade,
      COALESCE(s.feedback, '') as finalFeedback
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ?
      AND s.grade IS NULL
      AND COALESCE(s.audio_blob_url, s.audio_data, '') <> ''
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND LOWER(c.owner_email) = LOWER(?)
    ORDER BY s.submitted_at ASC`,
    [assignmentId, ownerEmail]
  );
  return result.rows.map((row) => ({
    submissionId: toStringValue(row.submissionId),
    studentName: toStringValue(row.studentName),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    rubric: parseJsonValue<Rubric>(row.rubric),
    maxPoints: toNumber(row.maxPoints),
    finalGrade: toNullableNumber(row.finalGrade),
    finalFeedback: toStringValue(row.finalFeedback),
  }));
}

export async function findSubmissionForAiGrade(
  submissionId: string,
  ownerEmail: string
): Promise<SubmissionForAiGradeRow | null> {
  const result = await query(
    `SELECT
      s.id as submissionId,
      a.id as assignmentId,
      a.title as assignmentTitle,
      COALESCE(s.audio_blob_url, s.audio_data, '') as audioBlobUrl,
      COALESCE(a.description, '') as description,
      a.instructions as instructions,
      a.rubric as rubric,
      a.max_points as maxPoints,
      s.grade as finalGrade,
      COALESCE(s.feedback, '') as finalFeedback
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND LOWER(c.owner_email) = LOWER(?)
    LIMIT 1`,
    [submissionId, ownerEmail]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    submissionId: toStringValue(row.submissionId),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    rubric: parseJsonValue<Rubric>(row.rubric),
    maxPoints: toNumber(row.maxPoints),
    finalGrade: toNullableNumber(row.finalGrade),
    finalFeedback: toStringValue(row.finalFeedback),
  };
}

function rowToAiAttempt(row: Row): AiGradingAttemptRow {
  return {
    id: toStringValue(row.id),
    submissionId: toStringValue(row.submissionId),
    teacherEmail: toStringValue(row.teacherEmail),
    status: toStringValue(row.status) === "failed" ? "failed" : "completed",
    transcript: toStringValue(row.transcript),
    detectedLanguage: toStringValue(row.detectedLanguage),
    transcriptQuality: toStringValue(row.transcriptQuality),
    durationSeconds: toNumber(row.durationSeconds),
    suggestedScore: toNullableNumber(row.suggestedScore),
    rubricScores: parseJsonValue<RubricScore[]>(row.rubricScores) ?? [],
    feedback: toStringValue(row.feedback),
    strengths: parseJsonValue<string[]>(row.strengths) ?? [],
    improvements: parseJsonValue<string[]>(row.improvements) ?? [],
    evidence: parseJsonValue<string[]>(row.evidence) ?? [],
    confidence: ["high", "medium", "low"].includes(toStringValue(row.confidence))
      ? (toStringValue(row.confidence) as "high" | "medium" | "low")
      : "low",
    warnings: parseJsonValue<string[]>(row.warnings) ?? [],
    teacherAttention: toStringValue(row.teacherAttention),
    transcriptionProvider: toStringValue(row.transcriptionProvider),
    gradingProvider: toStringValue(row.gradingProvider),
    transcriptionModel: toStringValue(row.transcriptionModel),
    gradingModel: toStringValue(row.gradingModel),
    errorCode: toStringValue(row.errorCode),
    errorMessage: toStringValue(row.errorMessage),
    createdAt: toNumber(row.createdAt),
    completedAt: toNullableNumber(row.completedAt),
  };
}

export async function createAiGradingAttempt(input: {
  submissionId: string;
  teacherEmail: string;
  status: AiGradingAttemptStatus;
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: string;
  durationSeconds: number;
  suggestedScore: number | null;
  rubricScores: RubricScore[];
  feedback: string;
  strengths: string[];
  improvements: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
  teacherAttention: string;
  transcriptionProvider: string;
  gradingProvider: string;
  transcriptionModel: string;
  gradingModel: string;
  errorCode?: string;
  errorMessage?: string;
}): Promise<AiGradingAttemptRow> {
  const item = {
    id: makeId("ai"),
    createdAt: Date.now(),
    completedAt: Date.now(),
    errorCode: input.errorCode ?? "",
    errorMessage: input.errorMessage ?? "",
    ...input,
  };
  await query(
    `INSERT INTO ai_grading_attempts (
      id, submission_id, teacher_email, status, transcript, detected_language,
      transcript_quality, duration_seconds, suggested_score, rubric_scores,
      feedback, strengths, improvements, evidence, confidence, warnings,
      teacher_attention, transcription_provider, grading_provider,
      transcription_model, grading_model, error_code, error_message,
      created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.submissionId,
      item.teacherEmail.toLowerCase(),
      item.status,
      item.transcript,
      item.detectedLanguage,
      item.transcriptQuality,
      item.durationSeconds,
      item.suggestedScore,
      stringifyJsonValue(item.rubricScores),
      item.feedback,
      stringifyJsonValue(item.strengths),
      stringifyJsonValue(item.improvements),
      stringifyJsonValue(item.evidence),
      item.confidence,
      stringifyJsonValue(item.warnings),
      item.teacherAttention,
      item.transcriptionProvider,
      item.gradingProvider,
      item.transcriptionModel,
      item.gradingModel,
      item.errorCode ?? "",
      item.errorMessage ?? "",
      item.createdAt,
      item.completedAt,
    ]
  );
  return {
    ...item,
    errorCode: item.errorCode ?? "",
    errorMessage: item.errorMessage ?? "",
  };
}

export async function listAiGradingAttemptsForSubmission(
  submissionId: string,
  ownerEmail: string,
  limit = 5
): Promise<AiGradingAttemptRow[]> {
  const result = await query(
    `SELECT
      ag.id as id,
      ag.submission_id as submissionId,
      ag.teacher_email as teacherEmail,
      ag.status as status,
      ag.transcript as transcript,
      ag.detected_language as detectedLanguage,
      ag.transcript_quality as transcriptQuality,
      ag.duration_seconds as durationSeconds,
      ag.suggested_score as suggestedScore,
      ag.rubric_scores as rubricScores,
      ag.feedback as feedback,
      ag.strengths as strengths,
      ag.improvements as improvements,
      ag.evidence as evidence,
      ag.confidence as confidence,
      ag.warnings as warnings,
      ag.teacher_attention as teacherAttention,
      ag.transcription_provider as transcriptionProvider,
      ag.grading_provider as gradingProvider,
      ag.transcription_model as transcriptionModel,
      ag.grading_model as gradingModel,
      ag.error_code as errorCode,
      ag.error_message as errorMessage,
      ag.created_at as createdAt,
      ag.completed_at as completedAt
    FROM ai_grading_attempts ag
    JOIN submissions s ON s.id = ag.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.submission_id = ?
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY ag.created_at DESC
    LIMIT ?`,
    [submissionId, ownerEmail, Math.max(1, Math.min(limit, 20))]
  );
  return result.rows.map(rowToAiAttempt);
}

export async function countAiAttemptsForSubmission(submissionId: string, ownerEmail: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt
    FROM ai_grading_attempts ag
    JOIN submissions s ON s.id = ag.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.submission_id = ?
      AND LOWER(c.owner_email) = LOWER(?)
      `,
    [submissionId, ownerEmail]
  );
  return toNumber(result.rows[0]?.cnt);
}

export async function countAiAttemptsForTeacherSince(teacherEmail: string, since: number): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt
    FROM ai_grading_attempts
    WHERE LOWER(teacher_email) = LOWER(?)
      AND created_at >= ?`,
    [teacherEmail, since]
  );
  return toNumber(result.rows[0]?.cnt);
}

export async function countAiAttemptsSince(since: number): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt
    FROM ai_grading_attempts
    WHERE created_at >= ?`,
    [since]
  );
  return toNumber(result.rows[0]?.cnt);
}

export async function reserveAiBudget(input: {
  generationCount: number;
  periodStart: number;
  monthlyBudgetUsd: number;
  reservedCostUsdPerGeneration: number;
}): Promise<boolean> {
  const generationCount = Math.max(1, Math.floor(input.generationCount));
  const budgetMicrousd = Math.floor(input.monthlyBudgetUsd * 1_000_000);
  const perGenerationMicrousd = Math.ceil(input.reservedCostUsdPerGeneration * 1_000_000);
  const reservedMicrousd = perGenerationMicrousd * generationCount;

  if (budgetMicrousd <= 0 || perGenerationMicrousd <= 0 || reservedMicrousd > budgetMicrousd) {
    return false;
  }

  const result = await query(
    `INSERT INTO ai_budget_reservations (
      id, generation_count, reserved_microusd, created_at
    )
    SELECT ?, ?, ?, ?
    WHERE COALESCE((
      SELECT SUM(reserved_microusd)
      FROM ai_budget_reservations
      WHERE created_at >= ?
    ), 0) + ? <= ?`,
    [
      makeId("aib"),
      generationCount,
      reservedMicrousd,
      Date.now(),
      input.periodStart,
      reservedMicrousd,
      budgetMicrousd,
    ]
  );

  return toNumber(result.rowsAffected) === 1;
}

export async function hasAudioTooLongFailure(submissionId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
    FROM ai_grading_attempts
    WHERE submission_id = ?
      AND error_code = 'audio_too_long'
    LIMIT 1`,
    [submissionId]
  );
  return result.rows.length > 0;
}

export async function latestAiAttemptCreatedAt(submissionId: string, ownerEmail: string): Promise<number | null> {
  const result = await query(
    `SELECT MAX(ag.created_at) as createdAt
    FROM ai_grading_attempts ag
    JOIN submissions s ON s.id = ag.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.submission_id = ?
      AND LOWER(c.owner_email) = LOWER(?)`,
    [submissionId, ownerEmail]
  );
  return result.rows[0]?.createdAt === null ? null : toNullableNumber(result.rows[0]?.createdAt);
}

export async function deleteLocalAiFixtureData(): Promise<{
  attemptsDeleted: number;
  submissionsDeleted: number;
  assignmentsDeleted: number;
  classesDeleted: number;
  usersDeleted: number;
}> {
  const attempts = await query(
    `DELETE FROM ai_grading_attempts
    WHERE submission_id IN (
      SELECT s.id
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE c.id LIKE 'local_ai_%'
    )`
  );
  const submissions = await query(
    `DELETE FROM submissions
    WHERE id LIKE 'local_ai_%'
       OR assignment_id IN (SELECT id FROM assignments WHERE id LIKE 'local_ai_%')`
  );
  const assignments = await query(`DELETE FROM assignments WHERE id LIKE 'local_ai_%'`);
  const classes = await query(`DELETE FROM classes WHERE id LIKE 'local_ai_%'`);
  const users = await query(`DELETE FROM users WHERE email IN ('dev-teacher@local.test', 'local-ai-student@example.test')`);
  return {
    attemptsDeleted: toNumber(attempts.rowsAffected),
    submissionsDeleted: toNumber(submissions.rowsAffected),
    assignmentsDeleted: toNumber(assignments.rowsAffected),
    classesDeleted: toNumber(classes.rowsAffected),
    usersDeleted: toNumber(users.rowsAffected),
  };
}

export async function ensureLocalAiFixture(): Promise<{
  teacherEmail: string;
  classId: string;
  assignmentId: string;
  submissionId: string;
}> {
  const teacherEmail = "dev-teacher@local.test";
  const studentEmail = "local-ai-student@example.test";
  const classId = "local_ai_class";
  const assignmentId = "local_ai_assignment";
  const submissionId = "local_ai_submission";
  const rubric: Rubric = {
    title: "Local AI speaking rubric",
    criteria: [
      { id: "content", name: "Content", description: "Addresses the prompt with details.", maxPoints: 5 },
      { id: "language", name: "Language", description: "Uses target-language vocabulary and structures.", maxPoints: 5 },
    ],
  };
  const audioData = `data:audio/webm;base64,${Buffer.from("synthetic local audio fixture").toString("base64")}`;

  await query(
    `INSERT INTO users (email, role, created_at, is_paid)
    VALUES (?, 'teacher', ?, 1)
    ON CONFLICT(email) DO UPDATE SET role = 'teacher', is_paid = 1`,
    [teacherEmail, Date.now()]
  );
  await query(
    `INSERT INTO classes (id, name, owner_email, created_at, deleted_at)
    VALUES (?, 'Local AI Test Class', ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET owner_email = excluded.owner_email, deleted_at = NULL`,
    [classId, teacherEmail, Date.now()]
  );
  await query(
    `INSERT INTO assignments (
      id, class_id, title, description, instructions, max_points, max_submissions,
      max_recording_seconds, rubric, attachment_name, attachment_url,
      attachment_content_type, created_at, deleted_at
    ) VALUES (?, ?, 'Local AI Speaking Test', '', 'Introduce yourself and describe your school day in Spanish.', 10, 0, 180, ?, '', '', '', ?, NULL)
    ON CONFLICT(id) DO UPDATE SET rubric = excluded.rubric, instructions = excluded.instructions, deleted_at = NULL`,
    [assignmentId, classId, stringifyJsonValue(rubric), Date.now()]
  );
  await query(
    `INSERT INTO submissions (
      id, assignment_id, student_name, student_email, audio_data, audio_blob_url,
      submitted_at, feedback, grade, rubric_scores, deleted_at
    ) VALUES (?, ?, 'Local AI Student', ?, ?, NULL, ?, '', NULL, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET grade = NULL, feedback = '', rubric_scores = NULL, deleted_at = NULL`,
    [submissionId, assignmentId, studentEmail, audioData, Date.now()]
  );
  return { teacherEmail, classId, assignmentId, submissionId };
}

export async function upsertRosterEntry(input: {
  classId: string;
  studentEmail: string;
  studentName: string;
  addedBy: "submission" | "teacher";
}): Promise<boolean> {
  const result = await query(
    `INSERT OR IGNORE INTO roster (id, class_id, student_email, student_name, added_at, added_by)
     VALUES (?, ?, LOWER(?), ?, ?, ?)`,
    [makeId("roster"), input.classId, input.studentEmail, input.studentName, Date.now(), input.addedBy]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function bulkUpsertRosterEntries(
  classId: string,
  students: { studentEmail: string; studentName: string }[]
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const student of students) {
    const result = await query(
      `INSERT OR IGNORE INTO roster (id, class_id, student_email, student_name, added_at, added_by)
       VALUES (?, ?, LOWER(?), ?, ?, 'teacher')`,
      [makeId("roster"), classId, student.studentEmail, student.studentName, Date.now()]
    );
    if (toNumber(result.rowsAffected) > 0) {
      added++;
    } else {
      skipped++;
    }
  }
  return { added, skipped };
}

export async function listRosterByClassId(classId: string, ownerEmail: string): Promise<RosterRow[]> {
  const result = await query(
    `SELECT
       r.id,
       r.class_id as classId,
       r.student_email as studentEmail,
       r.student_name as studentName,
       r.added_at as addedAt,
       r.added_by as addedBy
     FROM roster r
     JOIN classes c ON c.id = r.class_id
     WHERE r.class_id = ?
       AND c.deleted_at IS NULL
       AND LOWER(c.owner_email) = LOWER(?)
     ORDER BY LOWER(r.student_name), r.added_at ASC`,
    [classId, ownerEmail]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    classId: toStringValue(row.classId),
    studentEmail: toStringValue(row.studentEmail),
    studentName: toStringValue(row.studentName),
    addedAt: toNumber(row.addedAt),
    addedBy: toStringValue(row.addedBy) === "teacher" ? "teacher" : "submission",
  }));
}

export async function deleteRosterEntry(
  classId: string,
  studentEmail: string,
  ownerEmail: string
): Promise<boolean> {
  const result = await query(
    `DELETE FROM roster
     WHERE class_id = ?
       AND LOWER(student_email) = LOWER(?)
       AND class_id IN (
         SELECT id FROM classes
         WHERE id = ?
           AND LOWER(owner_email) = LOWER(?)
           AND deleted_at IS NULL
       )`,
    [classId, studentEmail, classId, ownerEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function listStudentAssignmentSummaries(
  classId: string,
  studentEmail: string,
  ownerEmail: string
): Promise<StudentAssignmentRow[]> {
  const result = await query(
    `SELECT
       a.id as assignmentId,
       a.title as assignmentTitle,
       COALESCE(a.max_points, 100) as maxPoints,
       a.created_at as createdAt,
       s.id as submissionId,
       s.submitted_at as submittedAt,
       s.grade as grade,
       COALESCE(s.feedback, '') as feedback
     FROM assignments a
     JOIN classes c ON c.id = a.class_id
     LEFT JOIN submissions s
       ON s.assignment_id = a.id
       AND LOWER(s.student_email) = LOWER(?)
       AND s.deleted_at IS NULL
     WHERE a.class_id = ?
       AND a.deleted_at IS NULL
       AND c.deleted_at IS NULL
       AND LOWER(c.owner_email) = LOWER(?)
     ORDER BY a.created_at ASC`,
    [studentEmail, classId, ownerEmail]
  );
  return result.rows.map((row) => ({
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    maxPoints: toNumber(row.maxPoints),
    createdAt: toNumber(row.createdAt),
    submissionId: row.submissionId ? toStringValue(row.submissionId) : null,
    submittedAt: row.submittedAt ? toNumber(row.submittedAt) : null,
    grade: toNullableNumber(row.grade),
    feedback: toStringValue(row.feedback),
  }));
}

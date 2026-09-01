import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const root = process.cwd();
const command = process.argv[2] || "doctor";
const teacherEmail = "dev-teacher@local.test";
const studentEmail = "local-ai-student@example.test";
const classId = "local_ai_class";
const assignmentId = "local_ai_assignment";
const submissionId = "local_ai_submission";

function createSilentWavFixtureDataUrl(durationMilliseconds = 250) {
  const sampleRate = 8_000;
  const bitsPerSample = 8;
  const channels = 1;
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMilliseconds) / 1_000));
  const dataSize = sampleCount * channels;
  const wav = Buffer.alloc(44 + dataSize);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  wav.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  wav.fill(128, 44);

  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

function readEnv() {
  const file = path.join(root, ".env.local");
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function assertRoot() {
  if (!fs.existsSync(path.join(root, "package.json"))) throw new Error("Run from the directory containing package.json.");
}

function assertDev(env) {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run local AI tooling in production.");
  if (env.LOCAL_DEV_BYPASS_AUTH !== "true") throw new Error("LOCAL_DEV_BYPASS_AUTH=true is required for local AI tooling.");
}

function dbClient() {
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return createClient({ url: `file:${path.join(dataDir, "local.db")}` });
}

async function exec(db, sql, args = []) {
  return db.execute({ sql, args });
}

async function ensureSchema(db) {
  await exec(db, "PRAGMA foreign_keys = ON");
  await exec(db, "CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'student', created_at INTEGER NOT NULL, is_paid INTEGER NOT NULL DEFAULT 0, ai_access_grant_source TEXT NOT NULL DEFAULT '')");
  const userColumns = await exec(db, "PRAGMA table_info(users)");
  if (!userColumns.rows.some((row) => String(row.name) === "ai_access_grant_source")) {
    await exec(db, "ALTER TABLE users ADD COLUMN ai_access_grant_source TEXT NOT NULL DEFAULT ''");
  }
  await exec(db, "CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_email TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, deleted_at INTEGER)");
  await exec(db, "CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '', max_points INTEGER NOT NULL DEFAULT 100, max_submissions INTEGER NOT NULL DEFAULT 0, max_recording_seconds INTEGER NOT NULL DEFAULT 180, rubric TEXT, attachment_name TEXT NOT NULL DEFAULT '', attachment_url TEXT NOT NULL DEFAULT '', attachment_content_type TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, deleted_at INTEGER)");
  await exec(db, "CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_name TEXT NOT NULL, student_email TEXT NOT NULL DEFAULT '', audio_data TEXT, audio_blob_url TEXT, submitted_at INTEGER NOT NULL, feedback TEXT, grade INTEGER, rubric_scores TEXT, deleted_at INTEGER)");
  await exec(db, "CREATE TABLE IF NOT EXISTS ai_grading_attempts (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, teacher_email TEXT NOT NULL, status TEXT NOT NULL, transcript TEXT NOT NULL DEFAULT '', detected_language TEXT NOT NULL DEFAULT '', transcript_quality TEXT NOT NULL DEFAULT '', duration_seconds INTEGER NOT NULL DEFAULT 0, suggested_score INTEGER, rubric_scores TEXT, feedback TEXT NOT NULL DEFAULT '', strengths TEXT, improvements TEXT, evidence TEXT, confidence TEXT NOT NULL DEFAULT 'low', warnings TEXT, teacher_attention TEXT NOT NULL DEFAULT 'review', transcription_provider TEXT NOT NULL DEFAULT '', grading_provider TEXT NOT NULL DEFAULT '', transcription_model TEXT NOT NULL DEFAULT '', grading_model TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, completed_at INTEGER)");
}

async function seed() {
  const env = readEnv();
  assertDev(env);
  const db = dbClient();
  try {
    await ensureSchema(db);
    const now = Date.now();
    const rubric = JSON.stringify({
      title: "Local AI speaking rubric",
      criteria: [
        { id: "content", name: "Content", description: "Addresses the prompt with details.", maxPoints: 5 },
        { id: "language", name: "Language", description: "Uses target-language vocabulary.", maxPoints: 5 },
      ],
    });
    const audio = createSilentWavFixtureDataUrl();
    await exec(db, "INSERT INTO users (email, role, created_at, is_paid, ai_access_grant_source) VALUES (?, 'teacher', ?, 1, 'manual') ON CONFLICT(email) DO UPDATE SET role='teacher', is_paid=1, ai_access_grant_source='manual'", [teacherEmail, now]);
    await exec(db, "INSERT INTO classes (id, name, owner_email, created_at, deleted_at) VALUES (?, 'Local AI Test Class', ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET owner_email=excluded.owner_email, deleted_at=NULL", [classId, teacherEmail, now]);
    await exec(db, "INSERT INTO assignments (id, class_id, title, description, instructions, max_points, max_submissions, max_recording_seconds, rubric, attachment_name, attachment_url, attachment_content_type, created_at, deleted_at) VALUES (?, ?, 'Local AI Speaking Test', '', 'Introduce yourself and describe your school day in Spanish.', 10, 0, 180, ?, '', '', '', ?, NULL) ON CONFLICT(id) DO UPDATE SET rubric=excluded.rubric, instructions=excluded.instructions, deleted_at=NULL", [assignmentId, classId, rubric, now]);
    await exec(db, "INSERT INTO submissions (id, assignment_id, student_name, student_email, audio_data, audio_blob_url, submitted_at, feedback, grade, rubric_scores, deleted_at) VALUES (?, ?, 'Local AI Student', ?, ?, NULL, ?, '', NULL, NULL, NULL) ON CONFLICT(id) DO UPDATE SET audio_data=excluded.audio_data, audio_blob_url=NULL, feedback='', grade=NULL, rubric_scores=NULL, deleted_at=NULL", [submissionId, assignmentId, studentEmail, audio, now]);
    console.log("Seed complete: 1 teacher, 1 class, 1 assignment, 1 submission.");
  } finally {
    db.close();
  }
}

async function reset() {
  const env = readEnv();
  assertDev(env);
  const db = dbClient();
  try {
    await ensureSchema(db);
    const attempts = await exec(db, "DELETE FROM ai_grading_attempts WHERE submission_id = ?", [submissionId]);
    const submissions = await exec(db, "DELETE FROM submissions WHERE id = ?", [submissionId]);
    const assignments = await exec(db, "DELETE FROM assignments WHERE id = ?", [assignmentId]);
    const classes = await exec(db, "DELETE FROM classes WHERE id = ?", [classId]);
    const users = await exec(db, "DELETE FROM users WHERE email IN (?, ?)", [teacherEmail, studentEmail]);
    console.log(`Reset complete: attempts=${attempts.rowsAffected}, submissions=${submissions.rowsAffected}, assignments=${assignments.rowsAffected}, classes=${classes.rowsAffected}, users=${users.rowsAffected}`);
  } finally {
    db.close();
  }
}

async function reachable(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return { ok: res.ok || res.status === 302, status: res.status, body: await res.text() };
  } catch {
    return { ok: false, status: 0, body: "" };
  }
}

async function doctor() {
  assertRoot();
  const env = readEnv();
  const db = dbClient();
  try {
    await ensureSchema(db);
    const feature = await reachable("http://localhost:3000/api/features");
    const teacher = await reachable("http://localhost:3000/teacher");
    const ready =
      env.LOCAL_DEV_BYPASS_AUTH === "true" &&
      env.AI_GRADING_ENABLED === "true" &&
      env.AI_TRANSCRIPTION_PROVIDER === "mock" &&
      env.AI_GRADING_PROVIDER === "mock";
    console.log(`project: valid`);
    console.log(`.env.local: ${fs.existsSync(path.join(root, ".env.local")) ? "present" : "missing"}`);
    console.log(`auth bypass: ${env.LOCAL_DEV_BYPASS_AUTH === "true" ? "enabled" : "disabled"}`);
    console.log(`AI grading: ${env.AI_GRADING_ENABLED === "true" ? "enabled" : "disabled"}`);
    console.log(`transcription provider: ${env.AI_TRANSCRIPTION_PROVIDER || "openai"}`);
    console.log(`grading provider: ${env.AI_GRADING_PROVIDER || "ollama"}`);
    console.log(`OpenAI key: ${env.OPENAI_API_KEY ? "configured" : "missing"}`);
    console.log(`database: reachable`);
    console.log(`feature endpoint: ${feature.ok ? `reachable (${feature.status})` : "unreachable"}`);
    console.log(`teacher route: ${teacher.ok ? `reachable (${teacher.status})` : "unreachable"}`);
    console.log(`storage mode: local legacy fixture or private blob`);
    console.log(`rate-limit backend: database/local for AI attempts`);
    if (!ready) process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function smoke() {
  const env = readEnv();
  assertDev(env);
  if (env.AI_GRADING_ENABLED !== "true" || env.AI_TRANSCRIPTION_PROVIDER !== "mock" || env.AI_GRADING_PROVIDER !== "mock") {
    throw new Error("ai:smoke requires AI_GRADING_ENABLED=true and both AI providers set to mock.");
  }
  await seed();
  const db = dbClient();
  try {
    await exec(db, "DELETE FROM ai_grading_attempts WHERE submission_id = ?", [submissionId]);
    const before = await exec(db, "SELECT grade, feedback FROM submissions WHERE id = ?", [submissionId]);
    if (before.rows[0]?.grade !== null || String(before.rows[0]?.feedback ?? "") !== "") {
      throw new Error("Local AI fixture did not begin ungraded.");
    }
    const res = await fetch(`http://localhost:3000/api/submissions/${submissionId}/ai-grade`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "AI smoke route failed.");
    const after = await exec(db, "SELECT grade, grade_source, feedback, rubric_scores FROM submissions WHERE id = ?", [submissionId]);
    const saved = after.rows[0];
    if (!Number.isFinite(Number(saved?.grade)) || String(saved?.grade_source ?? "") !== "ai" || !String(saved?.feedback ?? "").trim()) {
      throw new Error("AI route did not persist its reviewable grade and feedback.");
    }
    if (!String(saved?.rubric_scores ?? "").trim()) {
      throw new Error("AI route did not persist rubric scores.");
    }
    const latest = await fetch(`http://localhost:3000/api/submissions/${submissionId}/ai-grade`);
    if (!latest.ok) throw new Error("Could not retrieve the latest AI grade.");
    const attemptCountBeforeRetry = await exec(db, "SELECT COUNT(*) AS count FROM ai_grading_attempts WHERE submission_id = ?", [submissionId]);
    const second = await fetch(`http://localhost:3000/api/submissions/${submissionId}/ai-grade`, { method: "POST" });
    if (second.status !== 200 && second.status !== 409) {
      throw new Error("Exact AI-grade retry did not reuse or safely reject the saved result.");
    }
    const afterRetry = await exec(db, "SELECT grade, feedback FROM submissions WHERE id = ?", [submissionId]);
    const attemptCountAfterRetry = await exec(db, "SELECT COUNT(*) AS count FROM ai_grading_attempts WHERE submission_id = ?", [submissionId]);
    if (
      Number(afterRetry.rows[0]?.grade) !== Number(saved?.grade) ||
      String(afterRetry.rows[0]?.feedback ?? "") !== String(saved?.feedback ?? "") ||
      Number(attemptCountAfterRetry.rows[0]?.count) !== Number(attemptCountBeforeRetry.rows[0]?.count)
    ) {
      throw new Error("Exact AI-grade retry changed the saved result or created a duplicate attempt.");
    }
    console.log(`AI grade: schema-valid and saved`);
    console.log(`rubric and feedback persisted: yes`);
    console.log(`latest grade retrieval: ${latest.status}`);
    console.log(`exact retry: ${second.status}, no duplicate`);
  } finally {
    db.close();
  }
}

try {
  if (command === "seed") await seed();
  else if (command === "reset") await reset();
  else if (command === "doctor") await doctor();
  else if (command === "smoke") await smoke();
  else throw new Error("Use doctor, seed, reset, or smoke.");
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

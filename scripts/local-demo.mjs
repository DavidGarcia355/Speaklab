import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const root = process.cwd();
const command = process.argv[2] || "status";
const teacherEmail = "dev-teacher@local.test";
const localDbPath = path.resolve(root, "data", "local.db");
const day = 24 * 60 * 60 * 1_000;
const minute = 60 * 1_000;

const students = [
  { name: "Alex Rivera", email: "dev-student@gmail.com" },
  { name: "Ana Sofía de la Cruz", email: "ana.sofia.delacruz@example.test" },
  { name: "Christopher Montgomery-Williams", email: "christopher.montgomery-williams@example.test" },
  { name: "Zoë O’Connell", email: "zoe.oconnell@example.test" },
  { name: "Chloé Nguyen", email: "chloe.nguyen@example.test" },
  { name: "Mateo Hernández", email: "mateo.hernandez@example.test" },
  { name: "Isabella Rossi-Martínez", email: "isabella.rossi-martinez@example.test" },
  { name: "Noah Thompson", email: "noah.thompson@example.test" },
  { name: "Maya Patel", email: "maya.patel@example.test" },
  { name: "Elijah Brooks", email: "elijah.brooks@example.test" },
  { name: "Sofía Kim", email: "sofia.kim@example.test" },
  { name: "Lucas Fernández", email: "lucas.fernandez@example.test" },
  { name: "Aaliyah Johnson", email: "aaliyah.johnson@example.test" },
  { name: "Diego Morales", email: "diego.morales@example.test" },
  { name: "Emma García", email: "emma.garcia@example.test" },
  { name: "Liam O’Brien", email: "liam.obrien@example.test" },
  { name: "Camila Santos", email: "camila.santos@example.test" },
  { name: "Jayden Lee", email: "jayden.lee@example.test" },
  { name: "Valentina Ruiz", email: "valentina.ruiz@example.test" },
  { name: "Alexander Washington-Jones", email: "alexander.washington-jones@example.test" },
  { name: "María José Calderón", email: "maria.jose.calderon@example.test" },
  { name: "Ethan Chen", email: "ethan.chen@example.test" },
  { name: "Nicolás Pérez", email: "nicolas.perez@example.test" },
  { name: "Grace N’Diaye", email: "grace.ndiaye@example.test" },
  { name: "Samuel Ortiz", email: "samuel.ortiz@example.test" },
  { name: "Léa Martin", email: "lea.martin@example.test" },
  { name: "Gabriel Dubois", email: "gabriel.dubois@example.test" },
  { name: "Amélie Bernard", email: "amelie.bernard@example.test" },
];

const fourPartRubric = {
  title: "Speaking performance",
  criteria: [
    { id: "ideas", name: "Ideas & detail", description: "Develops the response with relevant details.", maxPoints: 5 },
    { id: "language", name: "Language use", description: "Uses accurate and varied target-language structures.", maxPoints: 5 },
    { id: "fluency", name: "Fluency", description: "Speaks at a natural, understandable pace.", maxPoints: 5 },
    { id: "pronunciation", name: "Pronunciation", description: "Produces clear, comprehensible speech.", maxPoints: 5 },
  ],
};

const routineRubric = {
  title: "Daily routine response",
  criteria: [
    { id: "content", name: "Content", description: "Covers the required parts of the prompt.", maxPoints: 5 },
    { id: "vocabulary", name: "Vocabulary", description: "Uses appropriate daily-routine vocabulary.", maxPoints: 5 },
    { id: "delivery", name: "Delivery", description: "Speaks clearly and continuously.", maxPoints: 5 },
  ],
};

const classes = [
  {
    id: "local_demo_spanish_2_period_3",
    name: "Spanish II — Period 3",
    rosterCount: 18,
    studentOffset: 0,
    createdDaysAgo: 35,
    assignments: [
      {
        id: "local_demo_tradition",
        title: "Una tradición que me importa",
        instructions: "Describe a tradition that matters to you. Explain what happens, who participates, and why it is meaningful.",
        targetLanguage: "Spanish",
        maxPoints: 20,
        maxRecordingSeconds: 180,
        rubric: fourPartRubric,
        createdDaysAgo: 6,
        submittedDaysAgo: 1,
        submissionCount: 12,
        gradedCount: 7,
        allowZero: true,
      },
      {
        id: "local_demo_restaurant",
        title: "Conversación: En el restaurante",
        instructions: "Role-play ordering a meal, asking one question, and responding politely to your server.",
        targetLanguage: "Spanish",
        maxPoints: 10,
        maxRecordingSeconds: 120,
        rubric: null,
        createdDaysAgo: 13,
        submittedDaysAgo: 4,
        submissionCount: 14,
        gradedCount: 14,
      },
      {
        id: "local_demo_routine",
        title: "Mi rutina diaria",
        instructions: "Walk through your weekday from morning to night using complete sentences and transition words.",
        targetLanguage: "Spanish",
        maxPoints: 15,
        maxRecordingSeconds: 150,
        rubric: routineRubric,
        createdDaysAgo: 20,
        submittedDaysAgo: 8,
        submissionCount: 10,
        gradedCount: 7,
      },
      {
        id: "local_demo_rr_practice",
        title: "Práctica: R y RR",
        instructions: "Record the word list twice, then use three of the words in original sentences.",
        targetLanguage: "Spanish",
        maxPoints: 10,
        maxRecordingSeconds: 90,
        rubric: null,
        createdDaysAgo: 27,
        submittedDaysAgo: 0,
        submissionCount: 0,
        gradedCount: 0,
      },
    ],
  },
  {
    id: "local_demo_spanish_1_period_1",
    name: "Spanish I — Period 1",
    rosterCount: 14,
    studentOffset: 5,
    createdDaysAgo: 48,
    assignments: [
      {
        id: "local_demo_family",
        title: "Mi familia y mis amigos",
        instructions: "Introduce two important people in your life and describe their personalities and interests.",
        targetLanguage: "Spanish",
        maxPoints: 10,
        maxRecordingSeconds: 120,
        rubric: null,
        createdDaysAgo: 9,
        submittedDaysAgo: 2,
        submissionCount: 10,
        gradedCount: 8,
      },
      {
        id: "local_demo_backpack",
        title: "¿Qué hay en tu mochila?",
        instructions: "Describe what is in your backpack and say which items you use in each class.",
        targetLanguage: "Spanish",
        maxPoints: 10,
        maxRecordingSeconds: 90,
        rubric: null,
        createdDaysAgo: 17,
        submittedDaysAgo: 7,
        submissionCount: 8,
        gradedCount: 8,
      },
      {
        id: "local_demo_greetings",
        title: "Saludos y presentaciones",
        instructions: "Greet a new classmate, introduce yourself, and ask two getting-to-know-you questions.",
        targetLanguage: "Spanish",
        maxPoints: 10,
        maxRecordingSeconds: 90,
        rubric: null,
        createdDaysAgo: 25,
        submittedDaysAgo: 12,
        submissionCount: 12,
        gradedCount: 12,
      },
    ],
  },
  {
    id: "local_demo_ap_spanish",
    name: "AP Spanish Language & Culture",
    rosterCount: 10,
    studentOffset: 11,
    createdDaysAgo: 62,
    assignments: [
      {
        id: "local_demo_cultural_comparison",
        title: "Comparación cultural: tecnología y comunidad",
        instructions: "Compare how technology shapes community life in a Spanish-speaking region and in your own community.",
        targetLanguage: "Spanish",
        maxPoints: 20,
        maxRecordingSeconds: 240,
        rubric: fourPartRubric,
        createdDaysAgo: 11,
        submittedDaysAgo: 3,
        submissionCount: 9,
        gradedCount: 9,
      },
      {
        id: "local_demo_future_plans",
        title: "Conversación simulada: Planes para el futuro",
        instructions: "Respond to each part of the simulated conversation with specific details and natural transitions.",
        targetLanguage: "Spanish",
        maxPoints: 10,
        maxRecordingSeconds: 180,
        rubric: null,
        createdDaysAgo: 23,
        submittedDaysAgo: 9,
        submissionCount: 7,
        gradedCount: 6,
      },
    ],
  },
  {
    id: "local_demo_french_1_period_6",
    name: "French I — Period 6",
    rosterCount: 8,
    studentOffset: 17,
    createdDaysAgo: 19,
    assignments: [
      {
        id: "local_demo_french_intro",
        title: "Bonjour ! Présente-toi",
        instructions: "Présente-toi, épelle ton prénom et partage trois choses que tu aimes.",
        targetLanguage: "French",
        maxPoints: 10,
        maxRecordingSeconds: 90,
        rubric: null,
        createdDaysAgo: 4,
        submittedDaysAgo: 0,
        submissionCount: 0,
        gradedCount: 0,
      },
    ],
  },
];

const demoClassIds = classes.map((item) => item.id);
const classPlaceholders = demoClassIds.map(() => "?").join(", ");

function readEnvFile() {
  const envPath = path.join(root, ".env.local");
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function assertSafety() {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) throw new Error("Run this command from the TryHabla repository root.");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (packageJson.name !== "speaklab") throw new Error("This does not look like the TryHabla repository.");

  const fileEnv = readEnvFile();
  const effective = (key) => process.env[key] ?? fileEnv[key];
  const isDeclared = (key) => Object.prototype.hasOwnProperty.call(process.env, key) || Object.prototype.hasOwnProperty.call(fileEnv, key);

  if (String(effective("NODE_ENV") || "").toLowerCase() === "production") {
    throw new Error("Refusing to modify demo data with NODE_ENV=production.");
  }
  if (effective("LOCAL_DEV_BYPASS_AUTH") !== "true") {
    throw new Error("LOCAL_DEV_BYPASS_AUTH=true is required before local demo data can be changed.");
  }
  if (isDeclared("TURSO_DATABASE_URL") || isDeclared("TURSO_AUTH_TOKEN")) {
    throw new Error("Refusing to run while Turso configuration is present. This tool is local SQLite only.");
  }
  if (isDeclared("HABLA_LOCAL_DB_PATH")) {
    throw new Error("Refusing to run with HABLA_LOCAL_DB_PATH set. This tool only targets this repo's data/local.db.");
  }
  if (!fs.existsSync(localDbPath)) {
    throw new Error("data/local.db does not exist. Start the app locally once, then retry.");
  }
  const stat = fs.lstatSync(localDbPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("data/local.db must be a normal local file, not a directory or link.");
  }
  if (path.resolve(fs.realpathSync.native(localDbPath)) !== localDbPath) {
    throw new Error("Refusing to follow data/local.db outside the expected repository path.");
  }
}

function createSilentWavFixtureDataUrl(durationMilliseconds = 2_400) {
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

function classStudents(classDefinition) {
  const selected = [students[0]];
  for (let index = 0; selected.length < classDefinition.rosterCount; index += 1) {
    const candidate = students[1 + ((classDefinition.studentOffset + index) % (students.length - 1))];
    if (!selected.some((student) => student.email === candidate.email)) selected.push(candidate);
  }
  return selected;
}

function gradeFor(assignment, submissionIndex) {
  const pendingCount = assignment.submissionCount - assignment.gradedCount;
  if (submissionIndex < pendingCount) return null;
  const gradedIndex = submissionIndex - pendingCount;
  if (gradedIndex === 0) return assignment.maxPoints;
  if (assignment.allowZero && submissionIndex === assignment.submissionCount - 1) return 0;
  const spread = Math.max(2, Math.ceil(assignment.maxPoints * 0.35));
  return Math.max(0, assignment.maxPoints - 1 - (gradedIndex % spread));
}

function rubricScoresFor(rubric, grade) {
  if (!rubric || grade === null) return null;
  const maxPoints = rubric.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
  const scores = rubric.criteria.map((criterion) => ({
    criterionId: criterion.id,
    criterionName: criterion.name,
    maxPoints: criterion.maxPoints,
    awarded: Math.round((criterion.maxPoints * grade) / maxPoints),
  }));
  let difference = grade - scores.reduce((sum, score) => sum + score.awarded, 0);
  while (difference !== 0) {
    const direction = Math.sign(difference);
    const adjustable = scores.find((score) => direction > 0 ? score.awarded < score.maxPoints : score.awarded > 0);
    if (!adjustable) throw new Error("Could not build internally consistent rubric scores.");
    adjustable.awarded += direction;
    difference -= direction;
  }
  return scores;
}

function feedbackFor(grade, maxPoints, index) {
  if (grade === null || index % 4 === 3) return "";
  if (grade === maxPoints) return "Excellent detail and confident pacing. Your examples made the response easy to follow.";
  if (grade === 0) return "Please rerecord after reviewing the prompt. The submitted audio did not address the required task.";
  return [
    "Strong ideas. Slow down slightly so each ending stays clear.",
    "Good vocabulary and organization. Add one more supporting detail next time.",
    "Clear response overall. Review agreement and keep the same natural pace.",
  ][index % 3];
}

function transcriptFor(language, name, assignmentTitle, index) {
  if (language === "French") {
    return `Bonjour, je m’appelle ${name}. J’aime la musique, le cinéma et passer du temps avec mes amis. Voici ma réponse pour ${assignmentTitle}.`;
  }
  const variants = [
    "Primero explico la idea principal y después doy un ejemplo de mi vida. Para mí, este tema es importante porque conecta a las personas.",
    "En mi experiencia, hay varias cosas que debemos considerar. También quiero compartir un detalle que ayuda a entender mi opinión.",
    "Voy a responder con una historia breve. Al principio fue difícil, pero aprendí mucho y ahora puedo explicarlo con más confianza.",
  ];
  return `Hola, me llamo ${name}. ${variants[index % variants.length]}`;
}

async function assertSchema(db) {
  const required = {
    classes: ["id", "name", "owner_email", "created_at", "deleted_at"],
    assignments: ["id", "class_id", "title", "description", "instructions", "target_language", "max_points", "max_submissions", "max_recording_seconds", "rubric", "attachment_name", "attachment_url", "attachment_content_type", "auto_transcribe", "created_at", "deleted_at"],
    submissions: ["id", "assignment_id", "student_name", "student_email", "audio_data", "audio_blob_url", "submitted_at", "feedback", "grade", "grade_source", "rubric_scores", "deleted_at"],
    roster: ["id", "class_id", "student_email", "student_name", "added_at", "added_by"],
    submission_transcripts: ["id", "submission_id", "teacher_email", "semantic_key", "assignment_fingerprint", "transcript_cache_key", "transcript", "detected_language", "transcript_quality", "duration_seconds", "transcription_provider", "transcription_model", "estimated_cost_microusd", "latency_ms", "created_at", "updated_at"],
  };

  for (const [table, columns] of Object.entries(required)) {
    const result = await db.execute(`PRAGMA table_info(${table})`);
    const available = new Set(result.rows.map((row) => String(row.name)));
    if (available.size === 0) throw new Error(`Missing ${table} table. Start the app locally once, then retry.`);
    const missing = columns.filter((column) => !available.has(column));
    if (missing.length > 0) {
      throw new Error(`Local database is missing ${table}.${missing.join(`, ${table}.`)}. Start the app once to finish migrations.`);
    }
  }
}

function createDbClient() {
  return createClient({ url: `file:${localDbPath}` });
}

async function deleteDemoClasses(executor) {
  return executor.execute({
    sql: `DELETE FROM classes WHERE id IN (${classPlaceholders})`,
    args: demoClassIds,
  });
}

async function collectStatus(db) {
  const classResult = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM classes WHERE id IN (${classPlaceholders}) AND deleted_at IS NULL`,
    args: demoClassIds,
  });
  const assignmentResult = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM assignments WHERE class_id IN (${classPlaceholders}) AND deleted_at IS NULL`,
    args: demoClassIds,
  });
  const rosterResult = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM roster WHERE class_id IN (${classPlaceholders})`,
    args: demoClassIds,
  });
  const submissionResult = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id IN (${classPlaceholders})) AND deleted_at IS NULL`,
    args: demoClassIds,
  });
  const pendingResult = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id IN (${classPlaceholders})) AND deleted_at IS NULL AND grade IS NULL`,
    args: demoClassIds,
  });
  const transcriptResult = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM submission_transcripts WHERE submission_id IN (SELECT id FROM submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id IN (${classPlaceholders})))`,
    args: demoClassIds,
  });
  return {
    classes: Number(classResult.rows[0]?.count || 0),
    assignments: Number(assignmentResult.rows[0]?.count || 0),
    rosterMemberships: Number(rosterResult.rows[0]?.count || 0),
    submissions: Number(submissionResult.rows[0]?.count || 0),
    pending: Number(pendingResult.rows[0]?.count || 0),
    transcripts: Number(transcriptResult.rows[0]?.count || 0),
  };
}

function printStatus(status, label = "Local demo") {
  console.log(`${label}: ${status.classes} classes, ${status.assignments} assignments, ${status.rosterMemberships} roster memberships, ${status.submissions} submissions (${status.pending} awaiting review), ${status.transcripts} saved transcripts.`);
}

async function seed() {
  assertSafety();
  const db = createDbClient();
  try {
    await db.execute("PRAGMA foreign_keys = ON");
    await assertSchema(db);
    const now = Date.now();
    const audioData = createSilentWavFixtureDataUrl();
    let insertedTranscripts = 0;
    let verifiedStatus = null;
    const transaction = await db.transaction("write");
    try {
      await deleteDemoClasses(transaction);

      for (const classDefinition of classes) {
        const rosterStudents = classStudents(classDefinition);
        await transaction.execute({
          sql: "INSERT INTO classes (id, name, owner_email, created_at, deleted_at) VALUES (?, ?, ?, ?, NULL)",
          args: [classDefinition.id, classDefinition.name, teacherEmail, now - classDefinition.createdDaysAgo * day],
        });

        for (const [studentIndex, student] of rosterStudents.entries()) {
          const submittedSomewhere = classDefinition.assignments.some((assignment) => studentIndex < assignment.submissionCount);
          await transaction.execute({
            sql: "INSERT INTO roster (id, class_id, student_email, student_name, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?)",
            args: [
              `${classDefinition.id}_roster_${String(studentIndex + 1).padStart(2, "0")}`,
              classDefinition.id,
              student.email,
              student.name,
              now - (classDefinition.createdDaysAgo - 1) * day + studentIndex * minute,
              submittedSomewhere ? "submission" : "teacher",
            ],
          });
        }

        for (const [assignmentIndex, assignment] of classDefinition.assignments.entries()) {
          await transaction.execute({
            sql: `INSERT INTO assignments (
              id, class_id, title, description, instructions, target_language,
              max_points, max_submissions, max_recording_seconds, rubric,
              attachment_name, attachment_url, attachment_content_type, auto_transcribe,
              created_at, deleted_at
            ) VALUES (?, ?, ?, '', ?, ?, ?, 0, ?, ?, '', '', '', 0, ?, NULL)`,
            args: [
              assignment.id,
              classDefinition.id,
              assignment.title,
              assignment.instructions,
              assignment.targetLanguage,
              assignment.maxPoints,
              assignment.maxRecordingSeconds,
              assignment.rubric ? JSON.stringify(assignment.rubric) : null,
              now - assignment.createdDaysAgo * day,
            ],
          });

          for (let submissionIndex = 0; submissionIndex < assignment.submissionCount; submissionIndex += 1) {
            const student = rosterStudents[submissionIndex];
            const submissionId = `${assignment.id}_submission_${String(submissionIndex + 1).padStart(2, "0")}`;
            const submittedAt = now - assignment.submittedDaysAgo * day - submissionIndex * 43 * minute;
            const grade = gradeFor(assignment, submissionIndex);
            const rubricScores = rubricScoresFor(assignment.rubric, grade);
            await transaction.execute({
              sql: `INSERT INTO submissions (
                id, assignment_id, student_name, student_email, audio_data, audio_blob_url,
                submitted_at, feedback, grade, grade_source, rubric_scores, deleted_at
              ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'teacher', ?, NULL)`,
              args: [
                submissionId,
                assignment.id,
                student.name,
                student.email,
                audioData,
                submittedAt,
                feedbackFor(grade, assignment.maxPoints, submissionIndex),
                grade,
                rubricScores ? JSON.stringify(rubricScores) : null,
              ],
            });

            const shouldSaveTranscript = submissionIndex === 0 || (submissionIndex + assignmentIndex) % 3 !== 1;
            if (shouldSaveTranscript) {
              const createdAt = submittedAt + 2 * minute;
              await transaction.execute({
                sql: `INSERT INTO submission_transcripts (
                  id, submission_id, teacher_email, semantic_key, assignment_fingerprint,
                  transcript_cache_key, transcript, detected_language, transcript_quality,
                  duration_seconds, transcription_provider, transcription_model,
                  estimated_cost_microusd, latency_ms, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'good', 3, 'fixture', 'local-demo', 0, 18, ?, ?)`,
                args: [
                  `${submissionId}_transcript`,
                  submissionId,
                  teacherEmail,
                  `local-demo:${submissionId}`,
                  `local-demo:${assignment.id}`,
                  `local-demo-cache:${submissionId}`,
                  transcriptFor(assignment.targetLanguage, student.name, assignment.title, submissionIndex),
                  assignment.targetLanguage.toLowerCase(),
                  createdAt,
                  createdAt,
                ],
              });
              insertedTranscripts += 1;
            }
          }
        }
      }

      verifiedStatus = await collectStatus(transaction);
      const expected = { classes: 4, assignments: 10, rosterMemberships: 50, submissions: 82, pending: 11, transcripts: insertedTranscripts };
      for (const [key, value] of Object.entries(expected)) {
        if (verifiedStatus[key] !== value) {
          throw new Error(`Seed verification failed for ${key}: expected ${value}, found ${verifiedStatus[key]}.`);
        }
      }
      await transaction.commit();
    } catch (error) {
      if (!transaction.closed) await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }

    if (!verifiedStatus) throw new Error("Seed verification did not complete.");
    printStatus(verifiedStatus, "Seed complete");
    console.log("Existing local_ai_* data was left untouched. Re-running this command safely refreshes only the four local_demo_* classes.");
  } finally {
    db.close();
  }
}

async function reset() {
  assertSafety();
  const db = createDbClient();
  try {
    await db.execute("PRAGMA foreign_keys = ON");
    await assertSchema(db);
    const transaction = await db.transaction("write");
    try {
      const deleted = await deleteDemoClasses(transaction);
      await transaction.commit();
      console.log(`Reset complete: removed ${deleted.rowsAffected} demo classes plus their assignments, roster memberships, submissions, transcripts, and cascading AI artifacts.`);
      console.log("Existing local_ai_* data was left untouched.");
      console.log("Historical AI allowance and billing audit ledgers are intentionally retained.");
    } catch (error) {
      if (!transaction.closed) await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  } finally {
    db.close();
  }
}

async function status() {
  assertSafety();
  const db = createDbClient();
  try {
    await db.execute("PRAGMA foreign_keys = ON");
    await assertSchema(db);
    printStatus(await collectStatus(db));
  } finally {
    db.close();
  }
}

try {
  if (command === "seed") await seed();
  else if (command === "reset") await reset();
  else if (command === "status") await status();
  else throw new Error("Use seed, reset, or status.");
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

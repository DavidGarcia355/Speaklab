import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";

const localDbPath = path.join(os.tmpdir(), "speaklab-ai-grading-batches-test.db");

async function loadDb() {
  vi.resetModules();
  return import("@/lib/db");
}

type Db = Awaited<ReturnType<typeof loadDb>>;

async function createAssignmentFixture(
  db: Db,
  suffix: string,
  options?: { rubric?: Parameters<Db["createAssignment"]>[0]["rubric"] },
) {
  const teacherEmail = `batch-${suffix}@example.com`;
  await db.setUserRoleTeacher(teacherEmail);
  const classroom = await db.createClass(`Batch ${suffix}`, teacherEmail);
  const assignment = await db.createAssignment({
    classId: classroom.id,
    ownerEmail: teacherEmail,
    title: `Speaking ${suffix}`,
    description: "Describe a tradition.",
    instructions: "Speak in Spanish.",
    targetLanguage: "Spanish",
    maxPoints: options?.rubric
      ? options.rubric.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0)
      : 20,
    maxSubmissions: 0,
    maxRecordingSeconds: 180,
    rubric: options?.rubric ?? null,
    attachmentName: "",
    attachmentUrl: "",
    attachmentContentType: "",
  });
  const assignmentFingerprint = processedAssignmentFingerprint(
    legacyAssignmentToGradingAssignment({
      submissionId: `fingerprint-${suffix}`,
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      audioBlobUrl: "",
      description: assignment.description,
      instructions: assignment.instructions,
      targetLanguage: assignment.targetLanguage,
      rubric: assignment.rubric,
      maxPoints: assignment.maxPoints,
      finalGrade: null,
      finalFeedback: "",
    }),
  );
  if (!assignmentFingerprint) throw new Error("Assignment fixture has no fingerprint.");
  return { teacherEmail, classroom, assignment, assignmentFingerprint };
}

async function addSubmission(
  db: Db,
  assignmentId: string,
  suffix: string,
  audioBlobUrl = `submissions/${suffix}.webm`,
) {
  return db.createSubmission({
    id: `sub_batch_${suffix}`,
    assignmentId,
    studentName: `Student ${suffix}`,
    studentEmail: `${suffix}@students.example.com`,
    audioBlobUrl,
  });
}

async function createCompletedAttempt(input: {
  db: Db;
  submissionId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
  cacheKey: string;
  score?: number | null;
  rubricScores?: {
    criterionId: string;
    criterionName: string;
    maxPoints: number;
    awarded: number;
  }[];
}) {
  return input.db.createAiGradingAttempt({
    submissionId: input.submissionId,
    teacherEmail: input.teacherEmail,
    status: "completed",
    transcript: "Hola, esta tradición es importante para mí.",
    detectedLanguage: "Spanish",
    transcriptQuality: "good",
    durationSeconds: 12,
    suggestedScore: input.score === undefined ? 17 : input.score,
    rubricScores: input.rubricScores ?? [],
    feedback: "Clear explanation with relevant details.",
    strengths: ["Clear explanation"],
    improvements: ["Add one example"],
    evidence: ["esta tradición"],
    confidence: "high",
    warnings: [],
    teacherAttention: input.score === null ? "unable_to_grade" : "review",
    transcriptionProvider: "mock",
    gradingProvider: "mock",
    transcriptionModel: "mock-transcription",
    gradingModel: "mock-grading",
    cacheKey: input.cacheKey,
    assignmentFingerprint: input.assignmentFingerprint,
    promptVersion: "batch-test-v1",
  });
}

async function claimAndStageNext(input: {
  db: Db;
  batchId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
  cacheKey: string;
  score?: number | null;
  rubricScores?: {
    criterionId: string;
    criterionName: string;
    maxPoints: number;
    awarded: number;
  }[];
}) {
  const claim = await input.db.claimNextAiGradingBatchItem({
    batchId: input.batchId,
    teacherEmail: input.teacherEmail,
    assignmentFingerprint: input.assignmentFingerprint,
  });
  if (claim.status !== "claimed") throw new Error("Batch item was not claimed.");
  const attempt = await createCompletedAttempt({
    db: input.db,
    submissionId: claim.item.submissionId,
    teacherEmail: input.teacherEmail,
    assignmentFingerprint: input.assignmentFingerprint,
    cacheKey: input.cacheKey,
    score: input.score,
    rubricScores: input.rubricScores,
  });
  const staged = await input.db.stageAiGradingAttemptForBatchReview({
    batchItemId: claim.item.itemId,
    leaseToken: claim.item.leaseToken,
    attemptId: attempt.id,
    ownerEmail: input.teacherEmail,
    allowWithoutReservation: true,
  });
  return { claim: claim.item, attempt, staged };
}

async function confirmedBatchInput(
  db: Db,
  input: Omit<
    Parameters<Db["createOrResumeAiGradingBatch"]>[0],
    "expectedSubmissionIds" | "newUnitsRequired" | "transcriptsRequired"
  >,
) {
  const candidates = (
    await db.listUngradedSubmissionsForAiGrade(
      input.assignmentId,
      input.teacherEmail,
    )
  ).filter((submission) => {
    const fingerprint = processedAssignmentFingerprint(
      legacyAssignmentToGradingAssignment(submission),
    );
    return !(
      fingerprint &&
      submission.completedAttemptFingerprints.includes(fingerprint)
    );
  });
  return {
    ...input,
    expectedSubmissionIds: candidates.map((item) => item.submissionId),
    newUnitsRequired: candidates.filter((item) => {
      const fingerprint = processedAssignmentFingerprint(
        legacyAssignmentToGradingAssignment(item),
      );
      return (
        !fingerprint ||
        !item.consumedTranscriptFingerprints.includes(fingerprint)
      );
    }).length,
    transcriptsRequired: candidates.filter(
      (item) => !item.hasPersistedTranscript,
    ).length,
  };
}

async function createConfirmedBatch(
  db: Db,
  input: Omit<
    Parameters<Db["createOrResumeAiGradingBatch"]>[0],
    "expectedSubmissionIds" | "newUnitsRequired" | "transcriptsRequired"
  >,
) {
  return db.createOrResumeAiGradingBatch(await confirmedBatchInput(db, input));
}

describe("durable AI grading batch persistence", () => {
  let db: Db;

  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
    db = await loadDb();
  });

  afterAll(() => {
    delete process.env.HABLA_LOCAL_DB_PATH;
  });

  it("snapshots only dynamically eligible submissions and counts exact new units", async () => {
    const fixture = await createAssignmentFixture(db, "eligibility");
    const fresh = await addSubmission(db, fixture.assignment.id, "eligible_fresh");
    const reused = await addSubmission(db, fixture.assignment.id, "eligible_reused");
    const graded = await addSubmission(db, fixture.assignment.id, "already_graded");
    const feedback = await addSubmission(db, fixture.assignment.id, "teacher_feedback");
    const rubric = await addSubmission(db, fixture.assignment.id, "teacher_rubric");
    await addSubmission(db, fixture.assignment.id, "missing_audio", "");
    const deleted = await addSubmission(db, fixture.assignment.id, "deleted");
    const completed = await addSubmission(db, fixture.assignment.id, "already_ai_reviewed");

    await db.updateSubmission(graded.id, fixture.teacherEmail, {
      studentName: graded.studentName,
      grade: 18,
      feedback: "Teacher grade.",
      rubricScores: null,
    });
    await db.updateSubmission(feedback.id, fixture.teacherEmail, {
      studentName: feedback.studentName,
      grade: null,
      feedback: "Teacher-authored feedback must be preserved.",
      rubricScores: null,
    });
    await db.updateSubmission(rubric.id, fixture.teacherEmail, {
      studentName: rubric.studentName,
      grade: null,
      feedback: "",
      rubricScores: [{
        criterionId: "manual",
        criterionName: "Manual",
        maxPoints: 20,
        awarded: 15,
      }],
    });
    await db.deleteSubmission(deleted.id, fixture.teacherEmail);

    const transcriptKey = "semantic-eligible-reused";
    const transcriptReservation = await db.reserveAiReviewAllowance({
      teacherEmail: fixture.teacherEmail,
      semanticKey: transcriptKey,
    });
    if (transcriptReservation.reservationStatus !== "reserved") {
      throw new Error("Transcript fixture could not reserve an allowance unit.");
    }
    await db.finalizeSubmissionTranscriptDelivery({
      reservationId: transcriptReservation.reservationId,
      value: {
        submissionId: reused.id,
        teacherEmail: fixture.teacherEmail,
        semanticKey: transcriptKey,
        assignmentFingerprint: fixture.assignmentFingerprint,
        transcript: "Una tradición.",
        detectedLanguage: "Spanish",
        transcriptQuality: "good",
        durationSeconds: 5,
        transcriptionProvider: "mock",
        transcriptionModel: "mock",
      },
    });

    const completedAttempt = await createCompletedAttempt({
      db,
      submissionId: completed.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-completed-current-assignment",
    });
    await expect(db.markAiGradingAttemptNotApplicable({
      attemptId: completedAttempt.id,
      ownerEmail: fixture.teacherEmail,
    })).resolves.toBe(true);

    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "eligibility-click",
    });

    expect(created).toMatchObject({
      status: "ready",
      created: true,
      batch: {
        eligibleCount: 2,
        newUnitsRequired: 1,
        counts: { total: 2, queued: 2 },
      },
    });
    if (!created.batch) throw new Error("Batch was not created.");
    expect(created.batch.items.map((item) => item.submissionId)).toEqual([
      fresh.id,
      reused.id,
    ]);
  });

  it("reuses a saved transcript even when its assignment fingerprint is stale", async () => {
    const fixture = await createAssignmentFixture(db, "stale-transcript-reuse");
    const submission = await addSubmission(
      db,
      fixture.assignment.id,
      "stale_transcript_reuse_one",
    );
    const semanticKey = "semantic-stale-transcript-reuse";
    const reservation = await db.reserveAiReviewAllowance({
      teacherEmail: fixture.teacherEmail,
      semanticKey,
    });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Transcript fixture could not reserve an allowance unit.");
    }
    await db.finalizeSubmissionTranscriptDelivery({
      reservationId: reservation.reservationId,
      value: {
        submissionId: submission.id,
        teacherEmail: fixture.teacherEmail,
        semanticKey,
        assignmentFingerprint: "superseded-assignment-fingerprint",
        transcript: "Una transcripcion guardada sigue siendo reutilizable.",
        detectedLanguage: "Spanish",
        transcriptQuality: "good",
        durationSeconds: 8,
        transcriptionProvider: "mock",
        transcriptionModel: "mock",
      },
    });

    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "stale-transcript-reuse-click",
    });

    expect(created).toMatchObject({
      status: "ready",
      created: true,
      batch: {
        eligibleCount: 1,
        // A new grading identity can still consume a unit, but no second
        // transcription provider call is needed for the saved transcript.
        newUnitsRequired: 1,
        transcriptsRequired: 0,
        savedTranscripts: 1,
      },
    });
  });

  it("converges repeated duplicate clicks on one durable batch without duplicate items", async () => {
    const fixture = await createAssignmentFixture(db, "idempotency");
    await addSubmission(db, fixture.assignment.id, "idempotency_one");
    await addSubmission(db, fixture.assignment.id, "idempotency_two");
    const input = await confirmedBatchInput(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "same-confirmation-click",
    });

    const results = await Promise.all([
      db.createOrResumeAiGradingBatch(input),
      db.createOrResumeAiGradingBatch(input),
    ]);

    expect(results.map((result) => result.status)).toEqual(["ready", "ready"]);
    expect(new Set(results.map((result) => result.batch?.id))).toHaveLength(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].batch?.items).toHaveLength(2);

    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const rows = await raw.execute({
        sql: `SELECT
          (SELECT COUNT(*) FROM ai_grading_batches WHERE assignment_id = ?) as batchCount,
          (SELECT COUNT(*) FROM ai_grading_batch_items WHERE batch_id = ?) as itemCount`,
        args: [fixture.assignment.id, results[0].batch!.id],
      });
      expect(Number(rows.rows[0]?.batchCount)).toBe(1);
      expect(Number(rows.rows[0]?.itemCount)).toBe(2);
    } finally {
      raw.close();
    }
  });

  it("rejects an atomically changed eligibility scope instead of enlarging the confirmed batch", async () => {
    const fixture = await createAssignmentFixture(db, "confirmation-scope");
    const confirmed = await addSubmission(
      db,
      fixture.assignment.id,
      "confirmation_scope_confirmed",
    );
    const input = await confirmedBatchInput(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "confirmation-scope-click",
    });
    await addSubmission(
      db,
      fixture.assignment.id,
      "confirmation_scope_late_arrival",
    );

    await expect(db.createOrResumeAiGradingBatch(input)).resolves.toEqual({
      status: "scope_changed",
      created: false,
      batch: null,
    });

    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const rows = await raw.execute({
        sql: `SELECT COUNT(*) as count FROM ai_grading_batches WHERE assignment_id = ?`,
        args: [fixture.assignment.id],
      });
      expect(Number(rows.rows[0]?.count)).toBe(0);
      expect(input.expectedSubmissionIds).toEqual([confirmed.id]);
    } finally {
      raw.close();
    }
  });

  it("scopes batch reads and claims to the owning teacher", async () => {
    const fixture = await createAssignmentFixture(db, "ownership");
    await addSubmission(db, fixture.assignment.id, "ownership_one");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "ownership-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");

    await expect(db.findAiGradingBatchForOwner(
      created.batch.id,
      "other-teacher@example.com",
    )).resolves.toBeNull();
    await expect(db.claimNextAiGradingBatchItem({
      batchId: created.batch.id,
      teacherEmail: "other-teacher@example.com",
      assignmentFingerprint: fixture.assignmentFingerprint,
    })).resolves.toEqual({ status: "not_found", item: null });

  });

  it("hides a known batch and refuses processing after its submission is soft-deleted", async () => {
    const fixture = await createAssignmentFixture(db, "deleted-checkpoint");
    const submission = await addSubmission(
      db,
      fixture.assignment.id,
      "deleted_checkpoint_one",
    );
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "deleted-checkpoint-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");

    await db.deleteSubmission(submission.id, fixture.teacherEmail);

    await expect(db.findAiGradingBatchForOwner(
      created.batch.id,
      fixture.teacherEmail,
    )).resolves.toBeNull();
    await expect(db.claimNextAiGradingBatchItem({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
    })).resolves.toEqual({ status: "not_found", item: null });

    const replacement = await addSubmission(
      db,
      fixture.assignment.id,
      "deleted_checkpoint_replacement",
    );
    const replacementBatch = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "deleted-checkpoint-replacement-click",
    });
    expect(replacementBatch.status).toBe("ready");
    expect(replacementBatch.batch?.items).toHaveLength(1);
    expect(replacementBatch.batch?.items[0]?.submissionId).toBe(replacement.id);

  });

  it("redacts a deleted review-ready item without blocking the remaining batch save", async () => {
    const fixture = await createAssignmentFixture(db, "deleted-review-ready");
    const deleted = await addSubmission(db, fixture.assignment.id, "deleted_ready_one");
    const remaining = await addSubmission(db, fixture.assignment.id, "deleted_ready_two");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "deleted-review-ready-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");
    await claimAndStageNext({
      db, batchId: created.batch.id, teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "deleted-review-ready-first",
    });
    const kept = await claimAndStageNext({
      db, batchId: created.batch.id, teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "deleted-review-ready-second",
    });
    await db.deleteSubmission(deleted.id, fixture.teacherEmail);

    const checkpoint = await db.findAiGradingBatchForOwner(
      created.batch.id,
      fixture.teacherEmail,
    );
    expect(checkpoint?.items).toHaveLength(1);
    expect(checkpoint?.items[0]?.submissionId).toBe(remaining.id);
    expect(JSON.stringify(checkpoint)).not.toContain("deleted_ready_one");

    await expect(db.saveAiGradingBatch({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      items: [{ itemId: kept.claim.itemId, grade: 17, feedback: "Reviewed.", rubricScores: null }],
    })).resolves.toEqual({ status: "saved", batchId: created.batch.id });
    await expect(db.findSubmissionById(remaining.id, fixture.teacherEmail))
      .resolves.toMatchObject({ grade: 17, feedback: "Reviewed." });
  });

  it("stops returning an active batch after its submissions are manually graded", async () => {
    const fixture = await createAssignmentFixture(db, "manual-reconcile");
    const submission = await addSubmission(
      db,
      fixture.assignment.id,
      "manual_reconcile_one",
    );
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "manual-reconcile-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");
    await db.updateSubmission(submission.id, fixture.teacherEmail, {
      studentName: submission.studentName,
      grade: 19,
      feedback: "Teacher completed this manually.",
      rubricScores: null,
    });

    await expect(db.findActiveAiGradingBatchForAssignment({
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
    })).resolves.toBeNull();
    await expect(db.findAiGradingBatchForOwner(
      created.batch.id,
      fixture.teacherEmail,
    )).resolves.toMatchObject({ status: "cancelled", counts: { conflict: 1 } });
  });

  it("retains completed progress and retries only a failed leased item", async () => {
    const fixture = await createAssignmentFixture(db, "resume");
    await addSubmission(db, fixture.assignment.id, "resume_one");
    await addSubmission(db, fixture.assignment.id, "resume_two");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "resume-click",
      now: 1_000,
    });
    if (!created.batch) throw new Error("Batch was not created.");
    const first = await db.claimNextAiGradingBatchItem({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      now: 2_000,
    });
    if (first.status !== "claimed") throw new Error("First item was not claimed.");
    await expect(db.markAiGradingBatchItemFailed({
      itemId: first.item.itemId,
      leaseToken: first.item.leaseToken,
      teacherEmail: fixture.teacherEmail,
      status: "failed",
      errorCode: "provider_error",
      errorMessage: "Provider unavailable.",
      now: 3_000,
    })).resolves.toBe(true);

    const second = await db.claimNextAiGradingBatchItem({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      now: 4_000,
    });
    if (second.status !== "claimed") throw new Error("Second item was not claimed.");
    const secondAttempt = await createCompletedAttempt({
      db,
      submissionId: second.item.submissionId,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-resume-success",
    });
    await expect(db.stageAiGradingAttemptForBatchReview({
      batchItemId: second.item.itemId,
      leaseToken: second.item.leaseToken,
      attemptId: secondAttempt.id,
      ownerEmail: fixture.teacherEmail,
      allowWithoutReservation: true,
    })).resolves.toEqual({ status: "staged", itemStatus: "review_ready" });

    const checkpoint = await db.findAiGradingBatchForOwner(
      created.batch.id,
      fixture.teacherEmail,
    );
    expect(checkpoint).toMatchObject({
      status: "partial_failure",
      counts: { reviewReady: 1, failed: 1, queued: 0 },
    });

    const retry = await db.claimNextAiGradingBatchItem({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      retryFailed: true,
      now: 5_000,
    });
    expect(retry).toMatchObject({
      status: "claimed",
      item: { itemId: first.item.itemId, submissionId: first.item.submissionId },
    });
    expect((await db.findAiGradingBatchForOwner(
      created.batch.id,
      fixture.teacherEmail,
    ))?.items.find((item) => item.id === first.item.itemId)?.retryCount).toBe(1);
  });

  it.each(["skipped", "conflict"] as const)(
    "closes an all-%s terminal batch and permits a new batch",
    async (terminalStatus) => {
      const fixture = await createAssignmentFixture(
        db,
        `close-${terminalStatus}`,
      );
      await addSubmission(
        db,
        fixture.assignment.id,
        `close_${terminalStatus}_one`,
      );
      await addSubmission(
        db,
        fixture.assignment.id,
        `close_${terminalStatus}_two`,
      );
      const created = await createConfirmedBatch(db, {
        assignmentId: fixture.assignment.id,
        teacherEmail: fixture.teacherEmail,
        assignmentFingerprint: fixture.assignmentFingerprint,
        idempotencyKey: `close-${terminalStatus}-first`,
      });
      if (!created.batch) throw new Error("Batch was not created.");

      for (let index = 0; index < 2; index += 1) {
        const claim = await db.claimNextAiGradingBatchItem({
          batchId: created.batch.id,
          teacherEmail: fixture.teacherEmail,
          assignmentFingerprint: fixture.assignmentFingerprint,
        });
        if (claim.status !== "claimed") throw new Error("Item was not claimed.");
        await expect(db.markAiGradingBatchItemFailed({
          itemId: claim.item.itemId,
          leaseToken: claim.item.leaseToken,
          teacherEmail: fixture.teacherEmail,
          status: terminalStatus,
          errorCode: terminalStatus,
          errorMessage: `Terminal ${terminalStatus} fixture.`,
        })).resolves.toBe(true);
      }

      await expect(db.closeAiGradingBatch({
        batchId: created.batch.id,
        teacherEmail: fixture.teacherEmail,
      })).resolves.toEqual({ status: "closed", batchId: created.batch.id });
      await expect(db.findAiGradingBatchForOwner(
        created.batch.id,
        fixture.teacherEmail,
      )).resolves.toMatchObject({ status: "cancelled" });
      await expect(db.findActiveAiGradingBatchForAssignment({
        assignmentId: fixture.assignment.id,
        teacherEmail: fixture.teacherEmail,
        assignmentFingerprint: fixture.assignmentFingerprint,
      })).resolves.toBeNull();

      await addSubmission(
        db,
        fixture.assignment.id,
        `close_${terminalStatus}_new`,
      );
      const replacement = await createConfirmedBatch(db, {
        assignmentId: fixture.assignment.id,
        teacherEmail: fixture.teacherEmail,
        assignmentFingerprint: fixture.assignmentFingerprint,
        idempotencyKey: `close-${terminalStatus}-replacement`,
      });
      expect(replacement).toMatchObject({ status: "ready", created: true });
      expect(replacement.batch?.id).not.toBe(created.batch.id);
    },
  );

  it("stages a suggestion privately and consumes its semantic unit only once", async () => {
    const fixture = await createAssignmentFixture(db, "staging");
    const submission = await addSubmission(db, fixture.assignment.id, "staging_one");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "staging-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");
    const claim = await db.claimNextAiGradingBatchItem({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
    });
    if (claim.status !== "claimed") throw new Error("Batch item was not claimed.");
    const semanticKey = "semantic-staged-once";
    const reservation = await db.reserveAiReviewAllowance({
      teacherEmail: fixture.teacherEmail,
      semanticKey,
    });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Staging fixture could not reserve an allowance unit.");
    }
    const attempt = await createCompletedAttempt({
      db,
      submissionId: submission.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: semanticKey,
    });

    await expect(db.stageAiGradingAttemptForBatchReview({
      batchItemId: claim.item.itemId,
      leaseToken: claim.item.leaseToken,
      attemptId: attempt.id,
      ownerEmail: fixture.teacherEmail,
      reviewReservationId: reservation.reservationId,
      allowWithoutReservation: false,
    })).resolves.toEqual({ status: "staged", itemStatus: "review_ready" });

    await expect(db.closeAiGradingBatch({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
    })).resolves.toEqual({
      status: "has_review_ready",
      batchId: created.batch.id,
    });

    await expect(db.findSubmissionById(submission.id, fixture.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "", rubricScores: null });
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail: fixture.teacherEmail }))
      .resolves.toMatchObject({ reserved: 0, consumed: 1, used: 1, remaining: 29 });

    await expect(db.stageAiGradingAttemptForBatchReview({
      batchItemId: claim.item.itemId,
      leaseToken: claim.item.leaseToken,
      attemptId: attempt.id,
      ownerEmail: fixture.teacherEmail,
      reviewReservationId: reservation.reservationId,
      allowWithoutReservation: false,
    })).resolves.toEqual({ status: "not_staged", reason: "attempt_ineligible" });
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail: fixture.teacherEmail }))
      .resolves.toMatchObject({ consumed: 1, used: 1, remaining: 29 });
  });

  it("refuses to stage over a teacher edit made while AI was processing", async () => {
    const fixture = await createAssignmentFixture(db, "stage-conflict");
    const submission = await addSubmission(db, fixture.assignment.id, "stage_conflict_one");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "stage-conflict-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");
    const claim = await db.claimNextAiGradingBatchItem({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
    });
    if (claim.status !== "claimed") throw new Error("Batch item was not claimed.");
    const attempt = await createCompletedAttempt({
      db,
      submissionId: submission.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-stage-conflict",
    });
    await db.updateSubmission(submission.id, fixture.teacherEmail, {
      studentName: submission.studentName,
      grade: 19,
      feedback: "My final teacher decision.",
      rubricScores: null,
    });

    await expect(db.stageAiGradingAttemptForBatchReview({
      batchItemId: claim.item.itemId,
      leaseToken: claim.item.leaseToken,
      attemptId: attempt.id,
      ownerEmail: fixture.teacherEmail,
      allowWithoutReservation: true,
    })).resolves.toEqual({ status: "not_staged", reason: "submission_changed" });
    await expect(db.findSubmissionById(submission.id, fixture.teacherEmail))
      .resolves.toMatchObject({
        grade: 19,
        feedback: "My final teacher decision.",
        gradeSource: "teacher",
      });
  });

  it("publishes teacher-edited review values atomically only on explicit save", async () => {
    const fixture = await createAssignmentFixture(db, "save");
    const firstSubmission = await addSubmission(db, fixture.assignment.id, "save_one");
    const secondSubmission = await addSubmission(db, fixture.assignment.id, "save_two");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "save-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");
    const first = await claimAndStageNext({
      db,
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-save-one",
      score: 17,
    });
    const second = await claimAndStageNext({
      db,
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-save-two",
      score: 16,
    });
    expect(first.staged).toEqual({ status: "staged", itemStatus: "review_ready" });
    expect(second.staged).toEqual({ status: "staged", itemStatus: "review_ready" });

    await expect(db.findSubmissionById(firstSubmission.id, fixture.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "" });
    await expect(db.findSubmissionById(secondSubmission.id, fixture.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "" });

    const items = [
      {
        itemId: first.claim.itemId,
        grade: 18,
        feedback: "Teacher raised this after review.",
        rubricScores: null,
      },
      {
        itemId: second.claim.itemId,
        grade: 16,
        feedback: "Clear explanation with relevant details.",
        rubricScores: [],
      },
    ];
    await expect(db.saveAiGradingBatch({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      items,
      now: 20_000,
    })).resolves.toEqual({ status: "saved", batchId: created.batch.id });

    await expect(db.findSubmissionById(firstSubmission.id, fixture.teacherEmail))
      .resolves.toMatchObject({
        grade: 18,
        feedback: "Teacher raised this after review.",
        gradeSource: "teacher",
      });
    await expect(db.findSubmissionById(secondSubmission.id, fixture.teacherEmail))
      .resolves.toMatchObject({
        grade: 16,
        feedback: "Clear explanation with relevant details.",
        gradeSource: "teacher",
      });
    await expect(db.findAiGradingBatchForOwner(created.batch.id, fixture.teacherEmail))
      .resolves.toMatchObject({
        status: "saved",
        counts: { saved: 2, reviewReady: 0 },
        items: [
          expect.objectContaining({ id: first.claim.itemId, teacherEdited: true }),
          expect.objectContaining({ id: second.claim.itemId, teacherEdited: false }),
        ],
      });

    await expect(db.saveAiGradingBatch({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      items,
      now: 21_000,
    })).resolves.toEqual({ status: "already_saved", batchId: created.batch.id });
    await expect(db.findSubmissionById(firstSubmission.id, fixture.teacherEmail))
      .resolves.toMatchObject({ grade: 18, feedback: "Teacher raised this after review." });
  });

  it("rolls the entire final save back when any teacher edit wins the race", async () => {
    const fixture = await createAssignmentFixture(db, "save-conflict");
    const firstSubmission = await addSubmission(db, fixture.assignment.id, "save_conflict_one");
    const secondSubmission = await addSubmission(db, fixture.assignment.id, "save_conflict_two");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "save-conflict-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");
    const first = await claimAndStageNext({
      db,
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-save-conflict-one",
    });
    const second = await claimAndStageNext({
      db,
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-save-conflict-two",
    });
    await db.updateSubmission(secondSubmission.id, fixture.teacherEmail, {
      studentName: secondSubmission.studentName,
      grade: 14,
      feedback: "Teacher saved this in another tab.",
      rubricScores: null,
    });

    await expect(db.saveAiGradingBatch({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      items: [
        { itemId: first.claim.itemId, grade: 17, feedback: "AI one", rubricScores: null },
        { itemId: second.claim.itemId, grade: 17, feedback: "AI two", rubricScores: null },
      ],
    })).resolves.toEqual({
      status: "submission_changed",
      batchId: created.batch.id,
      conflictItemIds: [second.claim.itemId],
    });
    await expect(db.findSubmissionById(firstSubmission.id, fixture.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "" });
    await expect(db.findSubmissionById(secondSubmission.id, fixture.teacherEmail))
      .resolves.toMatchObject({
        grade: 14,
        feedback: "Teacher saved this in another tab.",
        gradeSource: "teacher",
      });
    await expect(db.findAiGradingBatchForOwner(created.batch.id, fixture.teacherEmail))
      .resolves.toMatchObject({ counts: { reviewReady: 1, conflict: 1, saved: 0 } });
  });

  it("rejects incomplete or inconsistent rubric reviews without publishing anything", async () => {
    const rubric = {
      title: "Speaking rubric",
      criteria: [
        { id: "clarity", name: "Clarity", description: "", maxPoints: 10 },
        { id: "detail", name: "Detail", description: "", maxPoints: 10 },
      ],
    };
    const fixture = await createAssignmentFixture(db, "rubric-save", { rubric });
    const submission = await addSubmission(db, fixture.assignment.id, "rubric_save_one");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "rubric-save-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");
    const staged = await claimAndStageNext({
      db,
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-rubric-save",
      score: 17,
      rubricScores: [
        { criterionId: "clarity", criterionName: "Clarity", maxPoints: 10, awarded: 9 },
        { criterionId: "detail", criterionName: "Detail", maxPoints: 10, awarded: 8 },
      ],
    });

    await expect(db.saveAiGradingBatch({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      items: [{
        itemId: staged.claim.itemId,
        grade: 17,
        feedback: "Reviewed.",
        rubricScores: [
          { criterionId: "clarity", criterionName: "Ignored", maxPoints: 999, awarded: 9 },
        ],
      }],
    })).resolves.toMatchObject({
      status: "invalid",
      message: "Rubric scores must include every rubric criterion.",
    });
    await expect(db.saveAiGradingBatch({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      items: [{
        itemId: staged.claim.itemId,
        grade: 18,
        feedback: "Reviewed.",
        rubricScores: [
          { criterionId: "clarity", criterionName: "Clarity", maxPoints: 10, awarded: 9 },
          { criterionId: "detail", criterionName: "Detail", maxPoints: 10, awarded: 8 },
        ],
      }],
    })).resolves.toMatchObject({
      status: "invalid",
      message: "The total score must match the rubric scores.",
    });
    await expect(db.findSubmissionById(submission.id, fixture.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "", rubricScores: null });
  });

  it("fails closed when the assignment changes before final approval", async () => {
    const fixture = await createAssignmentFixture(db, "assignment-conflict");
    const submission = await addSubmission(db, fixture.assignment.id, "assignment_conflict_one");
    const created = await createConfirmedBatch(db, {
      assignmentId: fixture.assignment.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      idempotencyKey: "assignment-conflict-click",
    });
    if (!created.batch) throw new Error("Batch was not created.");
    const staged = await claimAndStageNext({
      db,
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      cacheKey: "semantic-assignment-conflict",
    });
    await db.updateAssignment(fixture.assignment.id, fixture.teacherEmail, {
      title: fixture.assignment.title,
      description: fixture.assignment.description,
      instructions: "Changed instructions after AI grading.",
      targetLanguage: fixture.assignment.targetLanguage,
      maxPoints: fixture.assignment.maxPoints,
      maxSubmissions: fixture.assignment.maxSubmissions,
      maxRecordingSeconds: fixture.assignment.maxRecordingSeconds,
      rubric: fixture.assignment.rubric,
      attachmentName: fixture.assignment.attachmentName,
      attachmentUrl: fixture.assignment.attachmentUrl,
      attachmentContentType: fixture.assignment.attachmentContentType,
      autoTranscribe: fixture.assignment.autoTranscribe,
    });

    await expect(db.saveAiGradingBatch({
      batchId: created.batch.id,
      teacherEmail: fixture.teacherEmail,
      assignmentFingerprint: fixture.assignmentFingerprint,
      items: [{
        itemId: staged.claim.itemId,
        grade: 17,
        feedback: "Reviewed.",
        rubricScores: null,
      }],
    })).resolves.toEqual({
      status: "assignment_changed",
      batchId: created.batch.id,
    });
    await expect(db.findSubmissionById(submission.id, fixture.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "" });
  });
});

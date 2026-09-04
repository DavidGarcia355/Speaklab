import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";

const localDbPath = path.join(
  os.tmpdir(),
  `speaklab-ai-grading-batch-drafts-${process.pid}.db`,
);

async function loadDb() {
  vi.resetModules();
  return import("@/lib/db");
}

type Db = Awaited<ReturnType<typeof loadDb>>;
type TestRubric = Parameters<Db["createAssignment"]>[0]["rubric"];

async function fixture(db: Db, suffix: string, rubric: TestRubric = null) {
  const teacherEmail = `draft-${suffix}@example.test`;
  await db.setUserRoleTeacher(teacherEmail);
  const classroom = await db.createClass(`Draft ${suffix}`, teacherEmail);
  const assignment = await db.createAssignment({
    classId: classroom.id,
    ownerEmail: teacherEmail,
    title: `Speaking ${suffix}`,
    description: "Describe a tradition.",
    instructions: "Speak in Spanish.",
    targetLanguage: "Spanish",
    maxPoints: rubric
      ? rubric.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0)
      : 20,
    maxSubmissions: 0,
    maxRecordingSeconds: 180,
    rubric,
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

async function submission(db: Db, assignmentId: string, suffix: string) {
  return db.createSubmission({
    id: `sub_draft_${suffix}`,
    assignmentId,
    studentName: `Student ${suffix}`,
    studentEmail: `${suffix}@students.example.test`,
    audioBlobUrl: `submissions/${suffix}.webm`,
  });
}

async function batch(input: {
  db: Db;
  teacherEmail: string;
  assignmentId: string;
  assignmentFingerprint: string;
  submissionIds: string[];
  suffix: string;
}) {
  const result = await input.db.createOrResumeAiGradingBatch({
    assignmentId: input.assignmentId,
    teacherEmail: input.teacherEmail,
    assignmentFingerprint: input.assignmentFingerprint,
    idempotencyKey: `draft-${input.suffix}`,
    expectedSubmissionIds: input.submissionIds,
    newUnitsRequired: input.submissionIds.length,
    transcriptsRequired: input.submissionIds.length,
  });
  if (!result.batch) throw new Error("Batch fixture was not created.");
  return result.batch;
}

async function stageClaim(input: {
  db: Db;
  batchId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
  retryFailed?: boolean;
  suffix: string;
}) {
  const claim = await input.db.claimNextAiGradingBatchItem({
    batchId: input.batchId,
    teacherEmail: input.teacherEmail,
    assignmentFingerprint: input.assignmentFingerprint,
    retryFailed: input.retryFailed,
  });
  if (claim.status !== "claimed") throw new Error("Batch item was not claimed.");
  const attempt = await input.db.createAiGradingAttempt({
    submissionId: claim.item.submissionId,
    teacherEmail: input.teacherEmail,
    status: "completed",
    transcript: "Hola, esta tradicion es importante para mi.",
    detectedLanguage: "Spanish",
    transcriptQuality: "good",
    durationSeconds: 12,
    suggestedScore: 17,
    rubricScores: [],
    feedback: "Clear explanation with relevant details.",
    strengths: ["Clear explanation"],
    improvements: ["Add one example"],
    evidence: ["esta tradicion"],
    confidence: "high",
    warnings: [],
    teacherAttention: "review",
    transcriptionProvider: "mock",
    gradingProvider: "mock",
    transcriptionModel: "mock-transcription",
    gradingModel: "mock-grading",
    cacheKey: `draft-attempt-${input.suffix}`,
    assignmentFingerprint: input.assignmentFingerprint,
    promptVersion: "draft-persistence-v1",
  });
  await expect(input.db.stageAiGradingAttemptForBatchReview({
    batchItemId: claim.item.itemId,
    leaseToken: claim.item.leaseToken,
    attemptId: attempt.id,
    ownerEmail: input.teacherEmail,
    allowWithoutReservation: true,
  })).resolves.toEqual({ status: "staged", itemStatus: "review_ready" });
  return claim.item;
}

describe("AI batch private review-draft persistence", () => {
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

  it("survives reload and a failed-item retry without grading submissions or consuming units", async () => {
    const setup = await fixture(db, "retry");
    const firstSubmission = await submission(db, setup.assignment.id, "retry_one");
    const secondSubmission = await submission(db, setup.assignment.id, "retry_two");
    const created = await batch({
      db,
      teacherEmail: setup.teacherEmail,
      assignmentId: setup.assignment.id,
      assignmentFingerprint: setup.assignmentFingerprint,
      submissionIds: [firstSubmission.id, secondSubmission.id],
      suffix: "retry",
    });
    const ready = await stageClaim({
      db,
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      suffix: "retry-ready",
    });
    const failed = await db.claimNextAiGradingBatchItem({
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
    });
    if (failed.status !== "claimed") throw new Error("Failure fixture was not claimed.");
    await expect(db.markAiGradingBatchItemFailed({
      itemId: failed.item.itemId,
      leaseToken: failed.item.leaseToken,
      teacherEmail: setup.teacherEmail,
      status: "failed",
      errorCode: "provider_error",
      errorMessage: "Temporary provider failure.",
    })).resolves.toBe(true);

    const submissionBefore = await db.findSubmissionById(
      ready.submissionId,
      setup.teacherEmail,
    );
    const allowanceBefore = await db.getAiReviewAllowanceSummary({
      teacherEmail: setup.teacherEmail,
    });
    await expect(db.saveAiGradingBatchDraft({
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      items: [{
        itemId: ready.itemId,
        grade: 19,
        feedback: "Teacher wording that must survive.",
        rubricScores: null,
      }],
    })).resolves.toEqual({
      status: "updated",
      batchId: created.id,
      itemIds: [ready.itemId],
    });

    const reloaded = await db.findAiGradingBatchForOwner(created.id, setup.teacherEmail);
    expect(reloaded?.items.find((item) => item.id === ready.itemId)?.draft).toEqual({
      grade: 19,
      rubricScores: null,
      feedback: "Teacher wording that must survive.",
    });

    await stageClaim({
      db,
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      retryFailed: true,
      suffix: "retry-failed",
    });
    const afterRetry = await db.findAiGradingBatchForOwner(created.id, setup.teacherEmail);
    expect(afterRetry?.items.find((item) => item.id === ready.itemId)?.draft).toEqual({
      grade: 19,
      rubricScores: null,
      feedback: "Teacher wording that must survive.",
    });
    await expect(db.findSubmissionById(ready.submissionId, setup.teacherEmail))
      .resolves.toEqual(submissionBefore);
    await expect(db.findSubmissionById(failed.item.submissionId, setup.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "", rubricScores: null });
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail: setup.teacherEmail }))
      .resolves.toEqual(allowanceBefore);
  });

  it("enforces owner, fingerprint, status, and score validation atomically", async () => {
    const setup = await fixture(db, "guards");
    const createdSubmission = await submission(db, setup.assignment.id, "guards_one");
    const created = await batch({
      db,
      teacherEmail: setup.teacherEmail,
      assignmentId: setup.assignment.id,
      assignmentFingerprint: setup.assignmentFingerprint,
      submissionIds: [createdSubmission.id],
      suffix: "guards",
    });
    const ready = await stageClaim({
      db,
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      suffix: "guards-ready",
    });
    const invalidItem = {
      itemId: ready.itemId,
      grade: 21,
      feedback: "Out of range.",
      rubricScores: null,
    };

    await expect(db.saveAiGradingBatchDraft({
      batchId: created.id,
      teacherEmail: "other-teacher@example.test",
      assignmentFingerprint: setup.assignmentFingerprint,
      items: [{ ...invalidItem, grade: 18 }],
    })).resolves.toEqual({ status: "not_found", batchId: created.id });
    await expect(db.saveAiGradingBatchDraft({
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      items: [invalidItem],
    })).resolves.toMatchObject({ status: "invalid", batchId: created.id });
    expect((await db.findAiGradingBatchForOwner(created.id, setup.teacherEmail))
      ?.items.find((item) => item.id === ready.itemId)?.draft.grade).toBe(17);

    await db.updateAssignment(setup.assignment.id, setup.teacherEmail, {
      title: `${setup.assignment.title} revised`,
      description: setup.assignment.description,
      instructions: setup.assignment.instructions,
      targetLanguage: setup.assignment.targetLanguage,
      maxPoints: setup.assignment.maxPoints,
      maxSubmissions: setup.assignment.maxSubmissions,
      maxRecordingSeconds: setup.assignment.maxRecordingSeconds,
      rubric: setup.assignment.rubric,
      attachmentName: setup.assignment.attachmentName,
      attachmentUrl: setup.assignment.attachmentUrl,
      attachmentContentType: setup.assignment.attachmentContentType,
      autoTranscribe: setup.assignment.autoTranscribe,
    });
    await expect(db.saveAiGradingBatchDraft({
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      items: [{ ...invalidItem, grade: 18 }],
    })).resolves.toEqual({ status: "assignment_changed", batchId: created.id });
    await expect(db.findSubmissionById(createdSubmission.id, setup.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "", rubricScores: null });
  });

  it("validates every rubric bound and the derived total before persisting", async () => {
    const rubric = {
      title: "Speaking rubric",
      criteria: [
        { id: "clarity", name: "Clarity", description: "Easy to follow", maxPoints: 10 },
        { id: "detail", name: "Detail", description: "Uses evidence", maxPoints: 10 },
      ],
    };
    const setup = await fixture(db, "rubric", rubric);
    const createdSubmission = await submission(db, setup.assignment.id, "rubric_one");
    const created = await batch({
      db,
      teacherEmail: setup.teacherEmail,
      assignmentId: setup.assignment.id,
      assignmentFingerprint: setup.assignmentFingerprint,
      submissionIds: [createdSubmission.id],
      suffix: "rubric",
    });
    const ready = await stageClaim({
      db,
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      suffix: "rubric-ready",
    });

    await expect(db.saveAiGradingBatchDraft({
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      items: [{
        itemId: ready.itemId,
        grade: 20,
        feedback: "Invalid criterion bound.",
        rubricScores: [
          { criterionId: "clarity", criterionName: "Clarity", maxPoints: 10, awarded: 11 },
          { criterionId: "detail", criterionName: "Detail", maxPoints: 10, awarded: 9 },
        ],
      }],
    })).resolves.toMatchObject({ status: "invalid" });
    await expect(db.saveAiGradingBatchDraft({
      batchId: created.id,
      teacherEmail: setup.teacherEmail,
      assignmentFingerprint: setup.assignmentFingerprint,
      items: [{
        itemId: ready.itemId,
        grade: 18,
        feedback: "Rubric edit restored after reload.",
        rubricScores: [
          { criterionId: "clarity", criterionName: "ignored", maxPoints: 99, awarded: 9 },
          { criterionId: "detail", criterionName: "ignored", maxPoints: 99, awarded: 9 },
        ],
      }],
    })).resolves.toMatchObject({ status: "updated" });

    expect((await db.findAiGradingBatchForOwner(created.id, setup.teacherEmail))
      ?.items.find((item) => item.id === ready.itemId)?.draft).toEqual({
      grade: 18,
      feedback: "Rubric edit restored after reload.",
      rubricScores: [
        { criterionId: "clarity", criterionName: "Clarity", maxPoints: 10, awarded: 9 },
        { criterionId: "detail", criterionName: "Detail", maxPoints: 10, awarded: 9 },
      ],
    });
    await expect(db.findSubmissionById(createdSubmission.id, setup.teacherEmail))
      .resolves.toMatchObject({ grade: null, feedback: "", rubricScores: null });
  });
});

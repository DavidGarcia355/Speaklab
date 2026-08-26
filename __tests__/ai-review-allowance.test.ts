import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import { STRIPE_API_VERSION } from "@/lib/billing/config";
import { getStripeBillingContractId } from "@/lib/billing/contract";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";

const runtimeMocks = vi.hoisted(() => ({
  subscriptionReady: vi.fn(async () => true),
}));

vi.mock("@/lib/billing/catalog-validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/catalog-validation")>()),
  isStripeSubscriptionRuntimeReady: runtimeMocks.subscriptionReady,
}));

const localDbPath = path.join(os.tmpdir(), "speaklab-ai-review-allowance-test.db");
const accountId = "acct_ai_review_allowance_test";
const teacherPriceId = "price_teacher_allowance_test";
const billingContractId = getStripeBillingContractId({
  apiVersion: STRIPE_API_VERSION,
  accountId,
  keyMode: "test",
  priceIds: { teacher: teacherPriceId },
  automaticTaxEnabled: false,
});

async function loadDb() {
  vi.resetModules();
  return import("@/lib/db");
}

async function createCompletedAttempt(
  db: Awaited<ReturnType<typeof loadDb>>,
  teacherEmail: string,
  cacheKey: string,
  options: {
    transcript?: string;
    suggestedScore?: number | null;
    assignmentFingerprint?: string;
  } = {},
) {
  const classroom = await db.createClass("Allowance class", teacherEmail);
  const assignment = await db.createAssignment({
    classId: classroom.id,
    ownerEmail: teacherEmail,
    title: "Allowance assignment",
    description: "",
    instructions: "Speak.",
    maxPoints: 10,
    maxSubmissions: 0,
    maxRecordingSeconds: 300,
    rubric: null,
    attachmentName: "",
    attachmentUrl: "",
    attachmentContentType: "",
  });
  await db.upsertRosterEntry({
    classId: classroom.id,
    studentEmail: "student@example.com",
    studentName: "Student",
    addedBy: "teacher",
  });
  const submission = await db.createSubmission({
    assignmentId: assignment.id,
    studentName: "Student",
    studentEmail: "student@example.com",
    audioBlobUrl: "submissions/allowance/answer.webm",
  });
  const assignmentFingerprint =
    options.assignmentFingerprint ??
    processedAssignmentFingerprint(
      legacyAssignmentToGradingAssignment({
        submissionId: submission.id,
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        audioBlobUrl: submission.audioBlobUrl,
        description: assignment.description,
        instructions: assignment.instructions,
        targetLanguage: assignment.targetLanguage,
        rubric: assignment.rubric,
        maxPoints: assignment.maxPoints,
        finalGrade: null,
        finalFeedback: "",
      }),
    );
  const attempt = await db.createAiGradingAttempt({
    submissionId: submission.id,
    teacherEmail,
    status: "completed",
    transcript: options.transcript ?? "Hola.",
    detectedLanguage: "Spanish",
    transcriptQuality: "good",
    durationSeconds: 5,
    suggestedScore:
      options.suggestedScore === undefined ? 8 : options.suggestedScore,
    rubricScores: [],
    feedback: "Good work.",
    strengths: ["Clear"],
    improvements: [],
    evidence: ["Hola"],
    confidence: "high",
    warnings: [],
    teacherAttention: "review",
    transcriptionProvider: "mock",
    gradingProvider: "mock",
    transcriptionModel: "mock",
    gradingModel: "mock",
    cacheKey,
    assignmentFingerprint,
    promptVersion: "allowance-test-v1",
  });
  return { assignment, assignmentFingerprint, submission, attempt };
}

describe("atomic AI review allowance", () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  beforeAll(async () => {
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    process.env.STRIPE_SUBSCRIPTION_BILLING_ENABLED = "true";
    delete process.env.STRIPE_BILLING_ENABLED;
    delete process.env.STRIPE_USAGE_BILLING_ENABLED;
    process.env.STRIPE_SECRET_KEY = "sk_test_allowance";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_allowance";
    process.env.STRIPE_ACCOUNT_ID = accountId;
    process.env.STRIPE_TRYHABLA_TEACHER_PRICE_ID = teacherPriceId;
    process.env.STRIPE_AUTOMATIC_TAX_ENABLED = "false";
    fs.rmSync(localDbPath, { force: true });
    db = await loadDb();
  });

  afterAll(() => {
    delete process.env.HABLA_LOCAL_DB_PATH;
    delete process.env.STRIPE_SUBSCRIPTION_BILLING_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_ACCOUNT_ID;
    delete process.env.STRIPE_TRYHABLA_TEACHER_PRICE_ID;
    delete process.env.STRIPE_AUTOMATIC_TAX_ENABLED;
  });

  it("hard-caps the free lifetime bucket and releases failed work", async () => {
    const teacherEmail = "free-cap@example.com";
    await db.setUserRoleTeacher(teacherEmail);
    const reservations = [];
    for (let index = 0; index < 29; index += 1) {
      reservations.push(
        await db.reserveAiReviewAllowance({
          teacherEmail,
          semanticKey: `free-key-${index}`,
        }),
      );
    }
    expect(reservations.every((item) => item.reservationStatus === "reserved")).toBe(true);
    const edge = await Promise.all([
      db.reserveAiReviewAllowance({ teacherEmail, semanticKey: "free-key-edge-a" }),
      db.reserveAiReviewAllowance({ teacherEmail, semanticKey: "free-key-edge-b" }),
    ]);
    expect(edge.filter((item) => item.reservationStatus === "reserved")).toHaveLength(1);
    expect(edge.filter((item) => item.reservationStatus === "exhausted")).toHaveLength(1);
    const exhausted = edge.find((item) => item.reservationStatus === "exhausted");
    expect(exhausted).toMatchObject({
      reservationStatus: "exhausted",
      status: "free_lifetime",
      limit: 30,
      used: 30,
      remaining: 0,
    });
    const first = reservations[0];
    if (first.reservationStatus !== "reserved") throw new Error("Missing reservation.");
    expect(
      await db.releaseAiReviewAllowanceReservation({
        teacherEmail,
        reservationId: first.reservationId,
      }),
    ).toBe(true);
    expect(
      await db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "free-key-after-release",
      }),
    ).toMatchObject({ reservationStatus: "reserved", remaining: 0 });
  });

  it("consumes delivery atomically and reuses a semantic duplicate", async () => {
    const teacherEmail = "free-delivery@example.com";
    const semanticKey = "semantic-delivery-key";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, semanticKey);
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Expected a review reservation.");
    }
    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
        billingCandidate: false,
        allowUnmeteredAccess: false,
        reviewReservationId: reservation.reservationId,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: false });
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail })).toMatchObject({
      status: "free_lifetime",
      reserved: 0,
      consumed: 1,
      remaining: 29,
    });
    expect(await db.reserveAiReviewAllowance({ teacherEmail, semanticKey })).toMatchObject({
      reservationStatus: "duplicate",
      sourceAttemptId: fixture.attempt.id,
      used: 1,
    });
  });

  it("persists an owner-scoped transcript and transfers its one unit to grading", async () => {
    const teacherEmail = "transcript-then-grade@example.com";
    const semanticKey = "semantic-transcript-then-grade";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, semanticKey);
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Expected a transcript reservation.");
    }

    const transcript = await db.finalizeSubmissionTranscriptDelivery({
      reservationId: reservation.reservationId,
      value: {
        submissionId: fixture.submission.id,
        teacherEmail,
        semanticKey,
        assignmentFingerprint: fixture.assignmentFingerprint,
        transcriptCacheKey: "transcript-cache-key",
        transcript: "Hola, esta es mi respuesta.",
        detectedLanguage: "Spanish",
        transcriptQuality: "good",
        durationSeconds: 5,
        transcriptionProvider: "mock",
        transcriptionModel: "mock-transcriber",
      },
    });
    expect(transcript).toMatchObject({
      submissionId: fixture.submission.id,
      teacherEmail,
      semanticKey,
      transcript: "Hola, esta es mi respuesta.",
    });
    await expect(
      db.findSubmissionTranscriptForOwner(fixture.submission.id, "other@example.com"),
    ).resolves.toBeNull();
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail })).resolves.toMatchObject({
      reserved: 0,
      consumed: 1,
      remaining: 29,
    });

    const duplicate = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    expect(duplicate).toMatchObject({
      reservationStatus: "duplicate",
      reservationId: reservation.reservationId,
      sourceKind: "transcript",
      sourceResultId: transcript?.id,
      used: 1,
    });
    if (duplicate.reservationStatus !== "duplicate") {
      throw new Error("Expected the consumed transcript reservation.");
    }

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
        billingCandidate: false,
        allowUnmeteredAccess: false,
        reviewReservationId: duplicate.reservationId,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: false });
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail })).resolves.toMatchObject({
      reserved: 0,
      consumed: 1,
      remaining: 29,
    });
    await expect(db.reserveAiReviewAllowance({ teacherEmail, semanticKey })).resolves.toMatchObject({
      reservationStatus: "duplicate",
      sourceKind: "grading",
      sourceResultId: fixture.attempt.id,
      used: 1,
    });
  });

  it("consumes a clean transcript even when grading cannot suggest a score", async () => {
    const teacherEmail = "transcript-no-score@example.com";
    const semanticKey = "semantic-transcript-no-score";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, semanticKey, {
      suggestedScore: null,
    });
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Expected a review reservation.");
    }

    await expect(
      db.markAiGradingAttemptNotApplicable({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        reviewReservationId: reservation.reservationId,
      }),
    ).resolves.toBe(true);
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail })).resolves.toMatchObject({
      reserved: 0,
      consumed: 1,
      remaining: 29,
    });
    const duplicate = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    expect(duplicate).toMatchObject({
      reservationStatus: "duplicate",
      sourceKind: "grading",
      sourceResultId: fixture.attempt.id,
    });
    await expect(
      db.getReusableAiReviewAttempt({
        attemptId: fixture.attempt.id,
        teacherEmail,
        semanticKey,
      }),
    ).resolves.toMatchObject({
      id: fixture.attempt.id,
      suggestedScore: null,
      transcript: "Hola.",
      deliveryStatus: "not_applicable",
    });
    await expect(
      db.listUngradedSubmissionsForAiGrade(fixture.submission.assignmentId, teacherEmail),
    ).resolves.toEqual([
      expect.objectContaining({
        submissionId: fixture.submission.id,
        consumedTranscriptFingerprints: [
          fixture.assignmentFingerprint,
        ],
        completedAttemptFingerprints: [
          fixture.assignmentFingerprint,
        ],
      }),
    ]);

    const duplicateSubmission = await db.createSubmission({
      assignmentId: fixture.submission.assignmentId,
      studentName: "Second student",
      studentEmail: "second-student@example.com",
      audioBlobUrl: "submissions/allowance/answer-copy.webm",
    });
    const copied = await db.copyConsumedReviewTranscriptToSubmission({
      reservationId: reservation.reservationId,
      sourceResultId: fixture.attempt.id,
      sourceKind: "grading",
      submissionId: duplicateSubmission.id,
      teacherEmail,
      semanticKey,
      assignmentFingerprint: fixture.assignmentFingerprint,
    });
    expect(copied).toMatchObject({
      submissionId: duplicateSubmission.id,
      semanticKey,
      assignmentFingerprint: fixture.assignmentFingerprint,
      transcript: "Hola.",
    });
  });

  it.each([
    {
      label: "teacher feedback",
      feedback: "Teacher draft feedback",
      rubricScores: null,
    },
    {
      label: "teacher rubric work",
      feedback: "",
      rubricScores: [
        {
          criterionId: "draft",
          criterionName: "Draft criterion",
          maxPoints: 10,
          awarded: 7,
        },
      ],
    },
  ])("excludes an ungraded submission with $label from a bulk AI run", async ({
    label,
    feedback,
    rubricScores,
  }) => {
    const teacherEmail = `bulk-preserves-${label.replaceAll(" ", "-")}@example.com`;
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, `bulk-preserves-${label}`);
    await db.updateSubmission(fixture.submission.id, teacherEmail, {
      studentName: fixture.submission.studentName,
      grade: null,
      feedback,
      rubricScores,
    });

    await expect(
      db.listUngradedSubmissionsForAiGrade(fixture.assignment.id, teacherEmail),
    ).resolves.toEqual([]);
  });

  it("retrieves the exact consumed attempt after more than twenty retries", async () => {
    const teacherEmail = "many-retries@example.com";
    const semanticKey = "semantic-many-retries";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, semanticKey, {
      suggestedScore: null,
    });
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Expected a review reservation.");
    }
    await db.markAiGradingAttemptNotApplicable({
      attemptId: fixture.attempt.id,
      ownerEmail: teacherEmail,
      reviewReservationId: reservation.reservationId,
    });

    for (let index = 0; index < 21; index += 1) {
      const retry = await db.createAiGradingAttempt({
        submissionId: fixture.submission.id,
        teacherEmail,
        status: "completed",
        transcript: fixture.attempt.transcript,
        detectedLanguage: fixture.attempt.detectedLanguage,
        transcriptQuality: fixture.attempt.transcriptQuality,
        durationSeconds: fixture.attempt.durationSeconds,
        suggestedScore: null,
        rubricScores: fixture.attempt.rubricScores,
        feedback: fixture.attempt.feedback,
        strengths: fixture.attempt.strengths,
        improvements: fixture.attempt.improvements,
        evidence: fixture.attempt.evidence,
        confidence: fixture.attempt.confidence,
        warnings: fixture.attempt.warnings,
        teacherAttention: fixture.attempt.teacherAttention,
        transcriptionProvider: fixture.attempt.transcriptionProvider,
        gradingProvider: fixture.attempt.gradingProvider,
        transcriptionModel: fixture.attempt.transcriptionModel,
        gradingModel: fixture.attempt.gradingModel,
        cacheKey: semanticKey,
        assignmentFingerprint: fixture.assignmentFingerprint,
        promptVersion: fixture.attempt.promptVersion,
        resultSource: "allowance_duplicate",
      });
      await db.markAiGradingAttemptNotApplicable({
        attemptId: retry.id,
        ownerEmail: teacherEmail,
      });
    }

    await expect(
      db.getReusableAiReviewAttempt({
        attemptId: fixture.attempt.id,
        teacherEmail,
        semanticKey,
      }),
    ).resolves.toMatchObject({
      id: fixture.attempt.id,
      suggestedScore: null,
      transcript: "Hola.",
    });
  });

  it("refuses to consume a reservation for a blank transcript", async () => {
    const teacherEmail = "blank-transcript@example.com";
    const semanticKey = "semantic-blank-transcript";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, semanticKey, {
      transcript: "   ",
      suggestedScore: null,
    });
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Expected a review reservation.");
    }

    await expect(
      db.markAiGradingAttemptNotApplicable({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        reviewReservationId: reservation.reservationId,
      }),
    ).resolves.toBe(false);
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail })).resolves.toMatchObject({
      reserved: 1,
      consumed: 0,
      used: 1,
    });
    await db.releaseAiReviewAllowanceReservation({
      reservationId: reservation.reservationId,
      teacherEmail,
    });
  });

  it("withholds an automatic grade when the assignment changes during provider work", async () => {
    const teacherEmail = "assignment-race-grade@example.com";
    const semanticKey = "semantic-assignment-race-grade";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, semanticKey);
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Expected a review reservation.");
    }
    await db.updateAssignment(fixture.assignment.id, teacherEmail, {
      title: fixture.assignment.title,
      description: fixture.assignment.description,
      instructions: `${fixture.assignment.instructions} Updated while grading.`,
      targetLanguage: fixture.assignment.targetLanguage,
      maxPoints: fixture.assignment.maxPoints,
      maxSubmissions: fixture.assignment.maxSubmissions,
      maxRecordingSeconds: fixture.assignment.maxRecordingSeconds,
      rubric: fixture.assignment.rubric,
      attachmentName: fixture.assignment.attachmentName,
      attachmentUrl: fixture.assignment.attachmentUrl,
      attachmentContentType: fixture.assignment.attachmentContentType,
    });

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
        billingCandidate: false,
        allowUnmeteredAccess: false,
        reviewReservationId: reservation.reservationId,
      }),
    ).resolves.toEqual({
      status: "not_applied",
      billingRequired: false,
      reason: "submission_changed",
    });
    await expect(db.findOwnedSubmissionForAiReview(fixture.submission.id, teacherEmail)).resolves
      .toMatchObject({ finalGrade: null, finalFeedback: "" });
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail })).resolves.toMatchObject({
      reserved: 1,
      consumed: 0,
    });
    await db.releaseAiReviewAllowanceReservation({
      reservationId: reservation.reservationId,
      teacherEmail,
    });
  });

  it("withholds a non-applicable result when the assignment changes during provider work", async () => {
    const teacherEmail = "assignment-race-review@example.com";
    const semanticKey = "semantic-assignment-race-review";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, semanticKey, {
      suggestedScore: null,
    });
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Expected a review reservation.");
    }
    await db.updateAssignment(fixture.assignment.id, teacherEmail, {
      title: fixture.assignment.title,
      description: fixture.assignment.description,
      instructions: fixture.assignment.instructions,
      targetLanguage: fixture.assignment.targetLanguage,
      maxPoints: fixture.assignment.maxPoints + 5,
      maxSubmissions: fixture.assignment.maxSubmissions,
      maxRecordingSeconds: fixture.assignment.maxRecordingSeconds,
      rubric: fixture.assignment.rubric,
      attachmentName: fixture.assignment.attachmentName,
      attachmentUrl: fixture.assignment.attachmentUrl,
      attachmentContentType: fixture.assignment.attachmentContentType,
    });

    await expect(
      db.markAiGradingAttemptNotApplicable({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        reviewReservationId: reservation.reservationId,
      }),
    ).resolves.toBe(false);
    await expect(db.getAiReviewAllowanceSummary({ teacherEmail })).resolves.toMatchObject({
      reserved: 1,
      consumed: 0,
    });
    await db.releaseAiReviewAllowanceReservation({
      reservationId: reservation.reservationId,
      teacherEmail,
    });
  });

  it("does not treat an unmetered transcript as a reusable paid unit", async () => {
    const teacherEmail = "unmetered-transcript@example.com";
    const semanticKey = "semantic-unmetered-transcript";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, "unused-attempt-key");
    await db.saveUnmeteredSubmissionTranscript({
      value: {
        submissionId: fixture.submission.id,
        teacherEmail,
        semanticKey,
        assignmentFingerprint: "assignment-fingerprint-unmetered",
        transcript: "Transcript created before metering.",
        detectedLanguage: "English",
        transcriptQuality: "good",
        durationSeconds: 5,
        transcriptionProvider: "mock",
        transcriptionModel: "mock-transcriber",
      },
    });

    await expect(
      db.listUngradedSubmissionsForAiGrade(fixture.submission.assignmentId, teacherEmail),
    ).resolves.toEqual([
      expect.objectContaining({
        submissionId: fixture.submission.id,
        hasPersistedTranscript: true,
        consumedTranscriptFingerprints: [],
      }),
    ]);

    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Expected the first metered transcript reservation.");
    }
    await db.finalizeSubmissionTranscriptDelivery({
      reservationId: reservation.reservationId,
      value: {
        submissionId: fixture.submission.id,
        teacherEmail,
        semanticKey,
        assignmentFingerprint: "assignment-fingerprint-unmetered",
        transcript: "Transcript created before metering.",
        detectedLanguage: "English",
        transcriptQuality: "good",
        durationSeconds: 5,
        transcriptionProvider: "mock",
        transcriptionModel: "mock-transcriber",
      },
    });
    await expect(
      db.listUngradedSubmissionsForAiGrade(fixture.submission.assignmentId, teacherEmail),
    ).resolves.toEqual([
      expect.objectContaining({
        submissionId: fixture.submission.id,
        hasPersistedTranscript: true,
        consumedTranscriptFingerprints: ["assignment-fingerprint-unmetered"],
      }),
    ]);
  });

  it("keeps an old consumed transcript source immutable after a second semantic save", async () => {
    const teacherEmail = "immutable-transcript-source@example.com";
    const oldKey = "semantic-transcript-old";
    const newKey = "semantic-transcript-new";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedAttempt(db, teacherEmail, "unused-immutable-key");

    const save = async (semanticKey: string, transcript: string) => {
      const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
      if (reservation.reservationStatus !== "reserved") {
        throw new Error("Expected a transcript reservation.");
      }
      const item = await db.finalizeSubmissionTranscriptDelivery({
        reservationId: reservation.reservationId,
        value: {
          submissionId: fixture.submission.id,
          teacherEmail,
          semanticKey,
          assignmentFingerprint: `assignment-fingerprint-${semanticKey}`,
          transcript,
          detectedLanguage: "English",
          transcriptQuality: "good",
          durationSeconds: 5,
          transcriptionProvider: "mock",
          transcriptionModel: "mock-transcriber",
        },
      });
      if (!item) throw new Error("Expected a saved transcript.");
      return item;
    };

    const oldTranscript = await save(oldKey, "Original transcript.");
    const newTranscript = await save(newKey, "New semantic transcript.");
    expect(newTranscript.id).not.toBe(oldTranscript.id);
    await expect(
      db.findSubmissionTranscriptByIdForOwner(oldTranscript.id, teacherEmail),
    ).resolves.toMatchObject({
      id: oldTranscript.id,
      semanticKey: oldKey,
      transcript: "Original transcript.",
    });
    await expect(db.reserveAiReviewAllowance({ teacherEmail, semanticKey: oldKey })).resolves.toMatchObject({
      reservationStatus: "duplicate",
      sourceKind: "transcript",
      sourceResultId: oldTranscript.id,
    });
  });

  it("reclaims abandoned reservations after the provider lease", async () => {
    const teacherEmail = "crashed-review@example.com";
    const startedAt = 10_000_000;
    await db.setUserRoleTeacher(teacherEmail);
    expect(
      await db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "crashed-key",
        now: startedAt,
      }),
    ).toMatchObject({ reservationStatus: "reserved", used: 1 });
    expect(
      await db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "after-crash",
        now: startedAt + 16 * 60 * 1_000,
      }),
    ).toMatchObject({ reservationStatus: "reserved", used: 1, remaining: 29 });
  });

  it("uses the exact active Stripe period without burning the free bucket", async () => {
    const teacherEmail = "paid-period@example.com";
    const now = Date.now();
    await db.setUserRoleTeacher(teacherEmail);
    const free = await db.reserveAiReviewAllowance({
      teacherEmail,
      semanticKey: "free-before-paid",
      now,
    });
    expect(free).toMatchObject({ status: "free_lifetime", used: 1 });
    const account = await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_paid_period",
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      now,
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: account.stripeCustomerId,
      stripeSubscriptionId: "sub_paid_period",
      subscriptionStatus: "active",
      subscriptionPeriodStart: now - 1_000,
      subscriptionPeriodEnd: now + 10_000,
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      stripeEventCreated: 1,
      now,
    });
    expect(
      await db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "paid-current-period",
        now,
      }),
    ).toMatchObject({
      reservationStatus: "reserved",
      status: "teacher_period",
      limit: 300,
      used: 1,
      remaining: 299,
      stripeSubscriptionId: "sub_paid_period",
      periodStart: now - 1_000,
      periodEnd: now + 10_000,
    });

    await db.upsertStripeBillingSubscription({
      stripeCustomerId: account.stripeCustomerId,
      stripeSubscriptionId: "sub_paid_period",
      subscriptionStatus: "canceled",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      stripeEventCreated: 2,
      now,
    });
    expect(
      await db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "free-after-paid",
        now,
      }),
    ).toMatchObject({
      reservationStatus: "reserved",
      status: "free_lifetime",
      limit: 30,
      used: 2,
      remaining: 28,
    });
  });

  it("fails closed for mismatched or expired nonterminal subscriptions", async () => {
    const teacherEmail = "stale-paid@example.com";
    const now = Date.now();
    await db.setUserRoleTeacher(teacherEmail);
    await db.setUserPaid(teacherEmail, true);
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_stale_paid",
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      now,
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_stale_paid",
      stripeSubscriptionId: "sub_stale_paid",
      subscriptionStatus: "active",
      subscriptionPeriodStart: now - 10_000,
      subscriptionPeriodEnd: now - 1,
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      stripeEventCreated: 1,
      now,
    });
    expect(
      await db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "must-not-fall-back",
        now,
      }),
    ).toMatchObject({
      reservationStatus: "subscription_unavailable",
      status: "subscription_unavailable",
      limit: 0,
      used: 0,
    });

    const mismatchedEmail = "catalog-mismatch@example.com";
    await db.setUserRoleTeacher(mismatchedEmail);
    await db.upsertStripeBillingCustomer({
      teacherEmail: mismatchedEmail,
      stripeCustomerId: "cus_catalog_mismatch",
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      now,
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_catalog_mismatch",
      stripeSubscriptionId: "sub_catalog_mismatch",
      subscriptionStatus: "active",
      subscriptionPeriodStart: now - 1_000,
      subscriptionPeriodEnd: now + 10_000,
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: "wrong-catalog-fingerprint",
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      stripeEventCreated: 1,
      now,
    });
    expect(
      await db.reserveAiReviewAllowance({
        teacherEmail: mismatchedEmail,
        semanticKey: "must-not-burn-free",
        now,
      }),
    ).toMatchObject({
      reservationStatus: "subscription_unavailable",
      status: "subscription_unavailable",
      used: 0,
    });
  });

  it("exposes legacy manual grants as a finite lifetime bucket", async () => {
    const teacherEmail = "manual-founder@example.com";
    await db.setUserRoleTeacher(teacherEmail);
    await db.setUserPaid(teacherEmail, true);
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail })).toMatchObject({
      status: "manual_lifetime",
      limit: 300,
      used: 0,
      remaining: 300,
    });
  });

  it("does not converge an active projection across different verified periods", async () => {
    const teacherEmail = "period-cas@example.com";
    const now = Date.now();
    const account = await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_period_cas",
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      now,
    });
    const common = {
      stripeCustomerId: account.stripeCustomerId,
      stripeSubscriptionId: "sub_period_cas",
      subscriptionStatus: "active",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      observedEventCreated: 10,
      expectedAccount: account,
      now,
    };
    await expect(
      db.projectCurrentStripeEntitledSubscription({
        ...common,
        subscriptionPeriodStart: now - 1_000,
        subscriptionPeriodEnd: now + 10_000,
      }),
    ).resolves.toMatchObject({ subscriptionPeriodEnd: now + 10_000 });
    await expect(
      db.projectCurrentStripeEntitledSubscription({
        ...common,
        subscriptionPeriodStart: now - 1_000,
        subscriptionPeriodEnd: now + 20_000,
      }),
    ).resolves.toBeNull();
  });
});

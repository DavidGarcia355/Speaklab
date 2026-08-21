import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const localDbPath = path.join(os.tmpdir(), "speaklab-stripe-persistence-test.db");

async function loadDbModule() {
  vi.resetModules();
  return import("@/lib/db");
}

type DbModule = Awaited<ReturnType<typeof loadDbModule>>;

async function createCompletedGradingFixture(
  db: DbModule,
  teacherEmail: string,
  label: string,
  billing?: { required: boolean; priceBookId: string; outputTokens: number },
) {
  const classroom = await db.createClass(`${label} Class`, teacherEmail);
  const assignment = await db.createAssignment({
    classId: classroom.id,
    ownerEmail: teacherEmail,
    title: `${label} Assignment`,
    description: "Billing persistence fixture.",
    instructions: "Give a short spoken answer.",
    maxPoints: 10,
    maxSubmissions: 0,
    maxRecordingSeconds: 180,
    rubric: null,
    attachmentName: "",
    attachmentUrl: "",
    attachmentContentType: "",
  });
  await db.upsertRosterEntry({
    classId: classroom.id,
    studentEmail: `${label}-student@example.com`,
    studentName: `${label} Student`,
    addedBy: "teacher",
  });
  const submission = await db.createSubmission({
    assignmentId: assignment.id,
    studentName: `${label} Student`,
    studentEmail: `${label}-student@example.com`,
    audioBlobUrl: `submissions/${label}/answer.webm`,
  });
  const cacheKey = `${label}-cache-v1`;
  const attempt = await db.createAiGradingAttempt({
    submissionId: submission.id,
    teacherEmail,
    status: "completed",
    transcript: "A synthetic answer.",
    detectedLanguage: "English",
    transcriptQuality: "good",
    durationSeconds: 65,
    suggestedScore: 8,
    rubricScores: [],
    feedback: "Synthetic feedback.",
    strengths: [],
    improvements: [],
    evidence: [],
    confidence: "high",
    warnings: [],
    teacherAttention: "review",
    transcriptionProvider: "mock",
    gradingProvider: "mock",
    transcriptionModel: "mock-transcriber",
    gradingModel: "mock-grader",
    cacheKey,
    promptVersion: "prompt-v1",
    billingRequired: billing?.required,
    billingPriceBookId: billing?.priceBookId,
    billableOutputTokens: billing?.outputTokens,
  });
  return { classroom, assignment, submission, attempt, cacheKey };
}

describe("Stripe and AI billing persistence", () => {
  let db: DbModule;

  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
    db = await loadDbModule();
  });

  it("projects Stripe state monotonically while retaining manual access", async () => {
    const teacherEmail = "Stripe-Teacher@Example.com";
    await db.setUserRoleTeacher(teacherEmail);
    await expect(db.getUserHasAiAccess(teacherEmail)).resolves.toBe(false);

    const customer = await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_teacher_1",
      now: 1_000,
    });
    expect(customer).toMatchObject({
      teacherEmail: "stripe-teacher@example.com",
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: null,
    });
    await expect(db.getStripeBillingAccountByCustomerId("cus_teacher_1")).resolves.toEqual(customer);

    const active = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: "sub_teacher_1",
      subscriptionStatus: "active",
      priceBookId: "habla-teacher-ai-usd-v1",
      stripeEventCreated: 200,
      now: 2_000,
    });
    expect(active).toMatchObject({ subscriptionStatus: "active", stripeEventCreated: 200 });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(true);
    await expect(db.getUserHasAiAccess(teacherEmail)).resolves.toBe(true);

    const stale = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: "sub_teacher_1",
      subscriptionStatus: "canceled",
      priceBookId: "habla-teacher-ai-usd-v1",
      stripeEventCreated: 199,
      now: 3_000,
    });
    expect(stale).toMatchObject({ subscriptionStatus: "active", stripeEventCreated: 200 });

    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: "sub_teacher_1",
      subscriptionStatus: "canceled",
      priceBookId: "habla-teacher-ai-usd-v1",
      stripeEventCreated: 201,
      now: 4_000,
    });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);
    await expect(db.getUserHasAiAccess(teacherEmail)).resolves.toBe(false);

    const sameSecondStaleGrant = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: "sub_teacher_1",
      subscriptionStatus: "active",
      priceBookId: "habla-teacher-ai-usd-v1",
      stripeEventCreated: 201,
      now: 4_100,
    });
    expect(sameSecondStaleGrant).toMatchObject({
      subscriptionStatus: "canceled",
      stripeEventCreated: 201,
    });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);

    await db.setUserPaid(teacherEmail, true);
    await expect(db.getUserHasAiAccess(teacherEmail)).resolves.toBe(true);
  });

  it("records successfully processed webhook event IDs only once", async () => {
    await expect(db.hasProcessedStripeWebhookEvent("evt_once")).resolves.toBe(false);
    await expect(
      db.recordProcessedStripeWebhookEvent({
        eventId: "evt_once",
        eventType: "customer.subscription.updated",
        stripeEventCreated: 500,
        processedAt: 5_000,
      })
    ).resolves.toBe(true);
    await expect(
      db.recordProcessedStripeWebhookEvent({
        eventId: "evt_once",
        eventType: "customer.subscription.updated",
        stripeEventCreated: 500,
        processedAt: 6_000,
      })
    ).resolves.toBe(false);
    await expect(db.getProcessedStripeWebhookEvent("evt_once")).resolves.toMatchObject({
      eventId: "evt_once",
      processedAt: 5_000,
    });
  });

  it("durably finds subscribed-at-delivery attempts until their usage row is queued", async () => {
    const teacherEmail = "durable-billing@example.com";
    const priceBookId = "habla-teacher-ai-usd-v1";
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_durable_billing",
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_durable_billing",
      stripeSubscriptionId: "sub_durable_billing",
      subscriptionStatus: "active",
      priceBookId,
      stripeEventCreated: 1,
    });
    const fixture = await createCompletedGradingFixture(db, teacherEmail, "durable", {
      required: true,
      priceBookId,
      outputTokens: 321,
    });

    expect(fixture.attempt).toMatchObject({
      billingRequired: true,
      billingPriceBookId: priceBookId,
      billableOutputTokens: 321,
    });
    await expect(db.listUnqueuedAiBillingAttempts(priceBookId)).resolves.toEqual([
      expect.objectContaining({
        attemptId: fixture.attempt.id,
        cacheKey: fixture.cacheKey,
        durationSeconds: 65,
        outputTokens: 321,
      }),
    ]);

    await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: fixture.cacheKey,
      priceBookId,
      attemptId: fixture.attempt.id,
      submissionId: fixture.submission.id,
      durationSeconds: 65,
      outputTokens: 321,
    });
    await expect(db.listUnqueuedAiBillingAttempts(priceBookId)).resolves.toEqual([]);
  });

  it("atomically deduplicates semantic results and allocates full-result monthly credits", async () => {
    const teacherEmail = "credit-teacher@example.com";
    const first = await createCompletedGradingFixture(db, teacherEmail, "credit-first");
    const second = await createCompletedGradingFixture(db, teacherEmail, "credit-second");
    await db.createClass("Not qualifying", teacherEmail);

    await expect(db.countQualifyingAiBillingClasses(teacherEmail)).resolves.toBe(2);
    const createFirst = () =>
      db.createAiBillingUsage({
        teacherEmail,
        cacheKey: first.cacheKey,
        priceBookId: "habla-teacher-ai-usd-v1",
        attemptId: first.attempt.id,
        submissionId: first.submission.id,
        durationSeconds: 65,
        outputTokens: 400,
        now: Date.UTC(2026, 7, 21, 12),
      });
    const [duplicateA, duplicateB] = await Promise.all([createFirst(), createFirst()]);
    expect(duplicateA).not.toBeNull();
    expect(duplicateB).toEqual(duplicateA);
    expect(duplicateA).toMatchObject({ freeCreditApplied: true, status: "credited" });

    const billable = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: second.cacheKey,
      priceBookId: "habla-teacher-ai-usd-v1",
      attemptId: second.attempt.id,
      submissionId: second.submission.id,
      durationSeconds: 75,
      outputTokens: 450,
      now: Date.UTC(2026, 7, 21, 12, 1),
    });
    expect(billable).toMatchObject({ freeCreditApplied: false, status: "pending" });

    const third = await createCompletedGradingFixture(db, teacherEmail, "credit-third");
    const newlyEarnedCredit = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: third.cacheKey,
      priceBookId: "habla-teacher-ai-usd-v1",
      attemptId: third.attempt.id,
      submissionId: third.submission.id,
      durationSeconds: 80,
      outputTokens: 500,
      now: Date.UTC(2026, 7, 21, 12, 2),
    });
    expect(newlyEarnedCredit).toMatchObject({ freeCreditApplied: true, status: "credited" });

    await expect(db.getAiBillingMonthlySummary(teacherEmail, "2026-08")).resolves.toMatchObject({
      qualifyingClassHighWater: 3,
      earnedCredits: 2,
      usedCredits: 2,
      remainingCredits: 0,
      successfulResults: 3,
      freeCreditResults: 2,
      billableResults: 1,
      billableBaseUnits: 1,
      billableDurationSeconds: 75,
      billableOutputTokens: 450,
    });

    const pending = await db.listPendingAiBillingUsage();
    expect(pending.map((item) => item.id)).toContain(billable?.id);
    expect(pending.map((item) => item.id)).not.toContain(duplicateA?.id);

    const deliveryClaim = await db.claimAiBillingUsageDimensionForDelivery({
      usageId: billable!.id,
      dimension: "audio",
      attemptedAt: 9_000,
    });
    expect(deliveryClaim).toMatchObject({
      claimed: true,
      usage: { audioAttemptedAt: 9_000 },
    });
    await expect(
      db.claimAiBillingUsageDimensionForDelivery({
        usageId: billable!.id,
        dimension: "audio",
        attemptedAt: 9_500,
      }),
    ).resolves.toMatchObject({ claimed: false, usage: { audioAttemptedAt: 9_000 } });

    const failed = await db.markAiBillingUsageDimensionFailed({
      usageId: billable!.id,
      dimension: "audio",
      error: "temporary Stripe error",
      failedAt: 10_000,
    });
    expect(failed).toMatchObject({
      status: "failed",
      lastErrorDimension: "audio",
      lastError: "temporary Stripe error",
    });
    await db.markAiBillingUsageDimensionReported({
      usageId: billable!.id,
      dimension: "base",
      reportedAt: 11_000,
    });
    const audioReported = await db.markAiBillingUsageDimensionReported({
      usageId: billable!.id,
      dimension: "audio",
      reportedAt: 12_000,
    });
    expect(audioReported).toMatchObject({ status: "pending", lastError: "" });
    const fullyReported = await db.markAiBillingUsageDimensionReported({
      usageId: billable!.id,
      dimension: "output",
      reportedAt: 13_000,
    });
    expect(fullyReported).toMatchObject({
      status: "reported",
      baseReportedAt: 11_000,
      audioReportedAt: 12_000,
      outputReportedAt: 13_000,
    });
    await expect(db.listPendingAiBillingUsage()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: billable!.id })])
    );
  });

  it("applies AI grade fields only to an active submission owned by the teacher", async () => {
    const teacherEmail = "grade-owner@example.com";
    const fixture = await createCompletedGradingFixture(db, teacherEmail, "auto-grade");
    await expect(
      db.applyAiGradeToSubmission(fixture.submission.id, "other@example.com", {
        grade: 8,
        feedback: "Should not save.",
        rubricScores: null,
      })
    ).resolves.toBeNull();

    const updated = await db.applyAiGradeToSubmission(fixture.submission.id, teacherEmail, {
      grade: 8,
      feedback: "Clear pronunciation and complete evidence.",
      rubricScores: [
        {
          criterionId: "pronunciation",
          criterionName: "Pronunciation",
          maxPoints: 10,
          awarded: 8,
        },
      ],
    });
    expect(updated).toMatchObject({
      id: fixture.submission.id,
      studentName: "auto-grade Student",
      grade: 8,
      feedback: "Clear pronunciation and complete evidence.",
      rubricScores: [expect.objectContaining({ criterionId: "pronunciation", awarded: 8 })],
    });

    await expect(
      db.applyAiGradeToSubmission(fixture.submission.id, teacherEmail, {
        grade: 2,
        feedback: "A late AI result must not overwrite the saved grade.",
        rubricScores: null,
      }),
    ).resolves.toBeNull();
    await expect(db.findSubmissionById(fixture.submission.id, teacherEmail)).resolves.toMatchObject({
      grade: 8,
      feedback: "Clear pronunciation and complete evidence.",
    });

    const feedbackFixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "teacher-feedback",
    );
    await db.updateSubmission(feedbackFixture.submission.id, teacherEmail, {
      studentName: feedbackFixture.submission.studentName,
      grade: null,
      feedback: "Teacher feedback must win.",
      rubricScores: null,
    });
    await expect(
      db.applyAiGradeToSubmission(feedbackFixture.submission.id, teacherEmail, {
        grade: 7,
        feedback: "Late AI feedback.",
        rubricScores: null,
      }),
    ).resolves.toBeNull();
    await expect(
      db.findSubmissionById(feedbackFixture.submission.id, teacherEmail),
    ).resolves.toMatchObject({
      grade: null,
      feedback: "Teacher feedback must win.",
    });

    const rubricFixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "teacher-rubric",
    );
    const teacherRubricScores = [
      {
        criterionId: "teacher-score",
        criterionName: "Teacher score",
        maxPoints: 10,
        awarded: 6,
      },
    ];
    await db.updateSubmission(rubricFixture.submission.id, teacherEmail, {
      studentName: rubricFixture.submission.studentName,
      grade: null,
      feedback: "",
      rubricScores: teacherRubricScores,
    });
    await expect(
      db.applyAiGradeToSubmission(rubricFixture.submission.id, teacherEmail, {
        grade: 9,
        feedback: "Late AI rubric.",
        rubricScores: null,
      }),
    ).resolves.toBeNull();
    await expect(
      db.findSubmissionById(rubricFixture.submission.id, teacherEmail),
    ).resolves.toMatchObject({
      grade: null,
      feedback: "",
      rubricScores: teacherRubricScores,
    });
  });
});

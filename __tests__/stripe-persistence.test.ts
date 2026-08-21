import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  TEACHER_AI_PRICE_BOOK,
  TEACHER_AI_PRICING_LIMITS,
} from "@/lib/teacher-ai-pricing";

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
  attemptOverrides?: { status?: "completed" | "failed"; cacheKey?: string },
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
  const cacheKey = attemptOverrides?.cacheKey ?? `${label}-cache-v1`;
  const attempt = await db.createAiGradingAttempt({
    submissionId: submission.id,
    teacherEmail,
    status: attemptOverrides?.status ?? "completed",
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

async function grantStripeBilling(
  db: DbModule,
  teacherEmail: string,
  priceBookId: string,
) {
  const existing = await db.getStripeBillingAccountByTeacherEmail(teacherEmail);
  const slug = teacherEmail.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const stripeCustomerId = existing?.stripeCustomerId ?? `cus_${slug}`;
  if (!existing) {
    await db.upsertStripeBillingCustomer({ teacherEmail, stripeCustomerId });
  }
  return db.upsertStripeBillingSubscription({
    stripeCustomerId,
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? `sub_${slug}`,
    subscriptionStatus: "active",
    priceBookId,
    stripeEventCreated: (existing?.stripeEventCreated ?? 0) + 1,
  });
}

async function applyAndMarkFixtureForBilling(
  db: DbModule,
  fixture: Awaited<ReturnType<typeof createCompletedGradingFixture>>,
  teacherEmail: string,
  priceBookId: string,
) {
  await grantStripeBilling(db, teacherEmail, priceBookId);
  const applied = await db.applyAiGradeToSubmission(fixture.submission.id, teacherEmail, {
    grade: fixture.attempt.suggestedScore!,
    feedback: fixture.attempt.feedback,
    rubricScores: null,
  });
  if (!applied) throw new Error("Billing test fixture could not apply its AI grade.");
  const marked = await db.markAiGradingAttemptBillingRequired({
    attemptId: fixture.attempt.id,
    ownerEmail: teacherEmail,
    priceBookId,
  });
  if (!marked) throw new Error("Billing test fixture could not persist its billing marker.");
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
      required: false,
      priceBookId,
      outputTokens: 321,
    });
    await applyAndMarkFixtureForBilling(db, fixture, teacherEmail, priceBookId);

    expect(fixture.attempt).toMatchObject({
      billingRequired: false,
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

  it("marks billing only after an owner-scoped completed result has durable Stripe entitlement", async () => {
    const teacherEmail = "post-apply-billing@example.com";
    const priceBookId = "habla-teacher-ai-usd-v1";
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_post_apply_billing",
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_post_apply_billing",
      stripeSubscriptionId: "sub_post_apply_billing",
      subscriptionStatus: "active",
      priceBookId,
      stripeEventCreated: 1,
    });
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "post-apply",
      { required: false, priceBookId, outputTokens: 222 },
    );
    expect(fixture.attempt).toMatchObject({
      billingRequired: false,
      billingPriceBookId: priceBookId,
    });
    await expect(
      db.applyAiGradeToSubmission(fixture.submission.id, teacherEmail, {
        grade: 8,
        feedback: "Applied before billing is marked.",
        rubricScores: null,
      }),
    ).resolves.not.toBeNull();

    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: fixture.attempt.id,
        ownerEmail: "other@example.com",
        priceBookId,
      }),
    ).resolves.toBe(false);
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail.toUpperCase(),
        priceBookId,
      }),
    ).resolves.toBe(true);

    await expect(
      db.listAiGradingAttemptsForSubmission(fixture.submission.id, teacherEmail),
    ).resolves.toEqual([
      expect.objectContaining({
        id: fixture.attempt.id,
        billingRequired: true,
        billingPriceBookId: priceBookId,
      }),
    ]);
    await expect(db.listUnqueuedAiBillingAttempts(priceBookId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attemptId: fixture.attempt.id, cacheKey: fixture.cacheKey }),
      ]),
    );
  });

  it("refuses the post-apply billing marker when any durable prerequisite is missing", async () => {
    const priceBookId = "habla-teacher-ai-usd-v1";

    const noSubscription = await createCompletedGradingFixture(
      db,
      "no-post-apply-subscription@example.com",
      "post-apply-no-subscription",
      { required: false, priceBookId, outputTokens: 10 },
    );
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: noSubscription.attempt.id,
        ownerEmail: "no-post-apply-subscription@example.com",
        priceBookId,
      }),
    ).resolves.toBe(false);
    await expect(
      db.createAiBillingUsage({
        teacherEmail: "no-post-apply-subscription@example.com",
        cacheKey: noSubscription.cacheKey,
        priceBookId,
        attemptId: noSubscription.attempt.id,
        submissionId: noSubscription.submission.id,
        baseUnits: 1,
        durationSeconds: 65,
        outputTokens: 10,
      }),
    ).resolves.toBeNull();

    const teacherEmail = "post-apply-guards@example.com";
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_post_apply_guards",
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_post_apply_guards",
      stripeSubscriptionId: "sub_post_apply_guards",
      subscriptionStatus: "trialing",
      priceBookId: "different-price-book",
      stripeEventCreated: 1,
    });
    const wrongBook = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "post-apply-wrong-book",
      { required: false, priceBookId, outputTokens: 11 },
    );
    await expect(
      db.applyAiGradeToSubmission(wrongBook.submission.id, teacherEmail, {
        grade: wrongBook.attempt.suggestedScore!,
        feedback: wrongBook.attempt.feedback,
        rubricScores: null,
      }),
    ).resolves.not.toBeNull();
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: wrongBook.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(false);

    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_post_apply_guards",
      stripeSubscriptionId: "sub_post_apply_guards",
      subscriptionStatus: "trialing",
      priceBookId,
      stripeEventCreated: 2,
    });
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: wrongBook.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(true);
    await expect(
      db.createAiBillingUsage({
        teacherEmail,
        cacheKey: wrongBook.cacheKey,
        priceBookId: "different-price-book",
        attemptId: wrongBook.attempt.id,
        submissionId: wrongBook.submission.id,
        baseUnits: 1,
        durationSeconds: 65,
        outputTokens: 11,
      }),
    ).resolves.toBeNull();

    const mismatchedAppliedGrade = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "post-apply-mismatched-grade",
      { required: false, priceBookId, outputTokens: 0 },
    );
    await expect(
      db.applyAiGradeToSubmission(mismatchedAppliedGrade.submission.id, teacherEmail, {
        grade: 7,
        feedback: mismatchedAppliedGrade.attempt.feedback,
        rubricScores: null,
      }),
    ).resolves.not.toBeNull();
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: mismatchedAppliedGrade.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(false);

    const teacherAuthoredGrade = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "post-apply-teacher-grade",
      { required: false, priceBookId, outputTokens: 0 },
    );
    await db.updateSubmission(teacherAuthoredGrade.submission.id, teacherEmail, {
      studentName: teacherAuthoredGrade.submission.studentName,
      grade: teacherAuthoredGrade.attempt.suggestedScore,
      feedback: teacherAuthoredGrade.attempt.feedback,
      rubricScores: null,
    });
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: teacherAuthoredGrade.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(false);

    const emptyCache = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "post-apply-empty-cache",
      { required: false, priceBookId, outputTokens: 12 },
      { cacheKey: "" },
    );
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: emptyCache.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(false);

    const failedAttempt = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "post-apply-failed-attempt",
      { required: false, priceBookId, outputTokens: 13 },
      { status: "failed" },
    );
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: failedAttempt.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(false);

    const deletedSubmission = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "post-apply-deleted-submission",
      { required: false, priceBookId, outputTokens: 14 },
    );
    await expect(
      db.deleteSubmission(deletedSubmission.submission.id, teacherEmail),
    ).resolves.toBe(true);
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: deletedSubmission.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(false);
  });

  it("atomically deduplicates semantic results and allocates full-result monthly credits", async () => {
    const teacherEmail = "credit-teacher@example.com";
    const priceBookId = "habla-teacher-ai-usd-v1";
    const first = await createCompletedGradingFixture(db, teacherEmail, "credit-first", {
      required: false,
      priceBookId,
      outputTokens: 400,
    });
    const second = await createCompletedGradingFixture(db, teacherEmail, "credit-second", {
      required: false,
      priceBookId,
      outputTokens: 450,
    });
    await db.createClass("Not qualifying", teacherEmail);
    await applyAndMarkFixtureForBilling(db, first, teacherEmail, priceBookId);
    await applyAndMarkFixtureForBilling(db, second, teacherEmail, priceBookId);

    await expect(db.countQualifyingAiBillingClasses(teacherEmail)).resolves.toBe(2);
    const createFirst = () =>
      db.createAiBillingUsage({
        teacherEmail,
        cacheKey: first.cacheKey,
        priceBookId,
        attemptId: first.attempt.id,
        submissionId: first.submission.id,
        baseUnits: 999,
        durationSeconds: 999,
        outputTokens: 999,
        now: Date.UTC(2026, 7, 21, 12),
      });
    const [duplicateA, duplicateB] = await Promise.all([createFirst(), createFirst()]);
    expect(duplicateA).not.toBeNull();
    expect(duplicateB).toEqual(duplicateA);
    expect(duplicateA).toMatchObject({
      freeCreditApplied: true,
      status: "credited",
      baseUnits: 1,
      durationSeconds: 65,
      outputTokens: 400,
    });

    const billable = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: second.cacheKey,
      priceBookId,
      attemptId: second.attempt.id,
      submissionId: second.submission.id,
      durationSeconds: 999,
      outputTokens: 999,
      now: Date.UTC(2026, 7, 21, 12, 1),
    });
    expect(billable).toMatchObject({ freeCreditApplied: false, status: "pending" });

    const third = await createCompletedGradingFixture(db, teacherEmail, "credit-third", {
      required: false,
      priceBookId,
      outputTokens: 500,
    });
    await applyAndMarkFixtureForBilling(db, third, teacherEmail, priceBookId);
    const newlyEarnedCredit = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: third.cacheKey,
      priceBookId,
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
      billableDurationSeconds: 65,
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

  it("caps the qualifying-class high-water at 30 and free whole-result credits at 29", async () => {
    const teacherEmail = "class-cap-teacher@example.com";
    const classCap = TEACHER_AI_PRICING_LIMITS.classCount.max;
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const fixtures = [];
    for (let index = 0; index < classCap + 1; index += 1) {
      fixtures.push(
        await createCompletedGradingFixture(db, teacherEmail, `class-cap-${index}`),
      );
    }
    for (const fixture of fixtures) {
      await applyAndMarkFixtureForBilling(db, fixture, teacherEmail, priceBookId);
    }
    await expect(db.countQualifyingAiBillingClasses(teacherEmail)).resolves.toBe(classCap + 1);

    const usageRows = [];
    for (const fixture of fixtures) {
      usageRows.push(
        await db.createAiBillingUsage({
          teacherEmail,
          cacheKey: fixture.cacheKey,
          priceBookId,
          attemptId: fixture.attempt.id,
          submissionId: fixture.submission.id,
          durationSeconds: 65,
          outputTokens: 100,
          now: Date.UTC(2026, 7, 21, 13),
        }),
      );
    }

    expect(usageRows.filter((row) => row?.freeCreditApplied)).toHaveLength(classCap - 1);
    expect(usageRows.filter((row) => row && !row.freeCreditApplied)).toHaveLength(2);
    await expect(
      db.getAiBillingMonthlySummary(teacherEmail, "2026-08"),
    ).resolves.toMatchObject({
      qualifyingClassHighWater: classCap,
      earnedCredits: classCap - 1,
      usedCredits: classCap - 1,
      remainingCredits: 0,
      successfulResults: classCap + 1,
      freeCreditResults: classCap - 1,
      billableResults: 2,
      billableBaseUnits: 2,
      billableDurationSeconds: 130,
      billableOutputTokens: 0,
    });
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

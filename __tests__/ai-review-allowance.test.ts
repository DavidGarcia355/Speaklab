import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import { STRIPE_API_VERSION } from "@/lib/billing/config";
import { getStripeBillingContractId } from "@/lib/billing/contract";

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
  const attempt = await db.createAiGradingAttempt({
    submissionId: submission.id,
    teacherEmail,
    status: "completed",
    transcript: "Hola.",
    detectedLanguage: "Spanish",
    transcriptQuality: "good",
    durationSeconds: 5,
    suggestedScore: 8,
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
    promptVersion: "allowance-test-v1",
  });
  return { submission, attempt };
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

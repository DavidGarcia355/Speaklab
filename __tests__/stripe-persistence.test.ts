import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import { STRIPE_API_VERSION } from "@/lib/billing/config";
import { getStripeBillingContractId } from "@/lib/billing/contract";
import { STRIPE_AUTOMATIC_USAGE_RECOVERY_WINDOW_MS } from "@/lib/billing/recovery-policy";
import {
  TEACHER_AI_PRICE_BOOK,
  TEACHER_AI_PRICING_LIMITS,
} from "@/lib/teacher-ai-pricing";

const billingRuntimeMocks = vi.hoisted(() => ({
  isReady: vi.fn(async () => true),
}));

vi.mock("@/lib/billing/catalog-validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/catalog-validation")>()),
  isStripeUsageRuntimeReady: billingRuntimeMocks.isReady,
}));

const localDbPath = path.join(os.tmpdir(), "speaklab-stripe-persistence-test.db");
const stripeEnvKeys = [
  "STRIPE_USAGE_BILLING_ENABLED",
  "STRIPE_BILLING_ENABLED",
  "CRON_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_ACCOUNT_ID",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_AI_GRADE_PRICE_ID",
  "STRIPE_AI_AUDIO_SECONDS_PRICE_ID",
] as const;
const originalStripeEnv = Object.fromEntries(
  stripeEnvKeys.map((key) => [key, process.env[key]]),
);
const TEST_STRIPE_ACCOUNT_ID = "acct_habla_persistence_test";
const TEST_BILLING_CONTRACT_ID = getStripeBillingContractId({
  apiVersion: STRIPE_API_VERSION,
  accountId: TEST_STRIPE_ACCOUNT_ID,
  keyMode: "test",
  priceIds: {
    aiGrade: "price_ai_grade",
    audioMinute: "price_audio_seconds",
  },
  automaticTaxEnabled: false,
});
const testStripeScope = {
  stripeAccountId: TEST_STRIPE_ACCOUNT_ID,
  billingContractId: TEST_BILLING_CONTRACT_ID,
} as const;
const testBillingScope = {
  priceBookId: TEACHER_AI_PRICE_BOOK.id,
  catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
  billingContractId: TEST_BILLING_CONTRACT_ID,
  livemode: false,
};

async function loadDbModule() {
  vi.resetModules();
  return import("@/lib/db");
}

type DbModule = Awaited<ReturnType<typeof loadDbModule>>;

type TestScopedInput<
  Input extends { stripeAccountId: string; billingContractId: string },
> = Omit<Input, "stripeAccountId" | "billingContractId"> &
  Partial<Pick<Input, "stripeAccountId" | "billingContractId">>;

type TestDbModule = Omit<
  DbModule,
  | "upsertStripeBillingCustomer"
  | "upsertStripeBillingSubscription"
  | "projectCurrentStripeNonEntitledSubscription"
  | "projectCurrentStripeEntitledSubscription"
  | "replaceTerminalStripeSubscriptionFromCheckout"
> & {
  upsertStripeBillingCustomer(
    input: TestScopedInput<Parameters<DbModule["upsertStripeBillingCustomer"]>[0]>,
  ): ReturnType<DbModule["upsertStripeBillingCustomer"]>;
  upsertStripeBillingSubscription(
    input: TestScopedInput<Parameters<DbModule["upsertStripeBillingSubscription"]>[0]>,
  ): ReturnType<DbModule["upsertStripeBillingSubscription"]>;
  projectCurrentStripeNonEntitledSubscription(
    input: TestScopedInput<
      Parameters<DbModule["projectCurrentStripeNonEntitledSubscription"]>[0]
    >,
  ): ReturnType<DbModule["projectCurrentStripeNonEntitledSubscription"]>;
  projectCurrentStripeEntitledSubscription(
    input: TestScopedInput<
      Parameters<DbModule["projectCurrentStripeEntitledSubscription"]>[0]
    >,
  ): ReturnType<DbModule["projectCurrentStripeEntitledSubscription"]>;
  replaceTerminalStripeSubscriptionFromCheckout(
    input: TestScopedInput<
      Parameters<DbModule["replaceTerminalStripeSubscriptionFromCheckout"]>[0]
    >,
  ): ReturnType<DbModule["replaceTerminalStripeSubscriptionFromCheckout"]>;
};

function withTestStripeScope(rawDb: DbModule): TestDbModule {
  return {
    ...rawDb,
    upsertStripeBillingCustomer: (input) =>
      rawDb.upsertStripeBillingCustomer({ ...testStripeScope, ...input }),
    upsertStripeBillingSubscription: (input) =>
      rawDb.upsertStripeBillingSubscription({ ...testStripeScope, ...input }),
    projectCurrentStripeNonEntitledSubscription: (input) =>
      rawDb.projectCurrentStripeNonEntitledSubscription({ ...testStripeScope, ...input }),
    projectCurrentStripeEntitledSubscription: (input) =>
      rawDb.projectCurrentStripeEntitledSubscription({ ...testStripeScope, ...input }),
    replaceTerminalStripeSubscriptionFromCheckout: (input) =>
      rawDb.replaceTerminalStripeSubscriptionFromCheckout({ ...testStripeScope, ...input }),
  };
}

async function createCompletedGradingFixture(
  db: TestDbModule,
  teacherEmail: string,
  label: string,
  billing?: { required: boolean; priceBookId: string; outputTokens: number },
  attemptOverrides?: {
    status?: "completed" | "failed";
    cacheKey?: string;
    durationSeconds?: number;
  },
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
    durationSeconds: attemptOverrides?.durationSeconds ?? 65,
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
  db: TestDbModule,
  teacherEmail: string,
  priceBookId: string,
) {
  const existing = await db.getStripeBillingAccountByTeacherEmail(teacherEmail);
  const slug = teacherEmail.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const stripeCustomerId = existing?.stripeCustomerId ?? `cus_${slug}`;
  if (!existing) {
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId,
      ...testStripeScope,
    });
  }
  return db.upsertStripeBillingSubscription({
    stripeCustomerId,
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? `sub_${slug}`,
    subscriptionStatus: "active",
    priceBookId,
    catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    ...testStripeScope,
    stripeEventCreated: (existing?.stripeEventCreated ?? 0) + 1,
  });
}

async function applyAndMarkFixtureForBilling(
  db: TestDbModule,
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
  let db: TestDbModule;

  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    process.env.STRIPE_USAGE_BILLING_ENABLED = "true";
    process.env.STRIPE_BILLING_ENABLED = "false";
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_persistence";
    process.env.STRIPE_ACCOUNT_ID = TEST_STRIPE_ACCOUNT_ID;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_persistence";
    process.env.STRIPE_AI_GRADE_PRICE_ID = "price_ai_grade";
    process.env.STRIPE_AI_AUDIO_SECONDS_PRICE_ID = "price_audio_seconds";
    fs.rmSync(localDbPath, { force: true });
    db = withTestStripeScope(await loadDbModule());
  });

  afterAll(() => {
    for (const key of stripeEnvKeys) {
      const original = originalStripeEnv[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  beforeEach(() => {
    billingRuntimeMocks.isReady.mockReset();
    billingRuntimeMocks.isReady.mockResolvedValue(true);
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
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
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
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 199,
      now: 3_000,
    });
    expect(stale).toMatchObject({ subscriptionStatus: "active", stripeEventCreated: 200 });

    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: "sub_teacher_1",
      subscriptionStatus: "canceled",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 201,
      now: 4_000,
    });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);
    await expect(db.getUserHasAiAccess(teacherEmail)).resolves.toBe(false);

    const sameSecondStaleGrant = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: "sub_teacher_1",
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 201,
      now: 4_100,
    });
    expect(sameSecondStaleGrant).toMatchObject({
      subscriptionStatus: "canceled",
      stripeEventCreated: 201,
    });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);

    const invalidCatalog = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: "sub_teacher_1",
      subscriptionStatus: "invalid_catalog",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: "",
      stripeEventCreated: 202,
      now: 4_200,
    });
    expect(invalidCatalog).toMatchObject({
      subscriptionStatus: "invalid_catalog",
      catalogFingerprint: "",
    });
    const verifiedRetry = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_1",
      stripeSubscriptionId: "sub_teacher_1",
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 202,
      now: 4_300,
    });
    expect(verifiedRetry).toMatchObject({
      subscriptionStatus: "active",
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(true);

    billingRuntimeMocks.isReady.mockResolvedValue(false);
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);
    await expect(db.getUserHasAiAccess(teacherEmail)).resolves.toBe(false);
    await db.setUserPaid(teacherEmail, true);
    await expect(db.getUserHasAiAccess(teacherEmail)).resolves.toBe(true);
  });

  it("keeps a teacher's Stripe Customer and mode mapping one-way", async () => {
    const teacherEmail = "immutable-customer@example.com";
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_immutable_original",
      livemode: false,
      now: 1_000,
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_immutable_original",
      stripeSubscriptionId: "sub_immutable_original",
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      livemode: false,
      stripeEventCreated: 10,
      now: 1_100,
    });

    await expect(
      db.upsertStripeBillingCustomer({
        teacherEmail,
        stripeCustomerId: "cus_immutable_stale",
        livemode: false,
        now: 2_000,
      }),
    ).rejects.toThrow("manual reconciliation");
    await expect(
      db.upsertStripeBillingCustomer({
        teacherEmail,
        stripeCustomerId: "cus_immutable_original",
        livemode: true,
        now: 2_100,
      }),
    ).rejects.toThrow("manual reconciliation");
    await expect(
      db.getStripeBillingAccountByTeacherEmail(teacherEmail),
    ).resolves.toMatchObject({
      stripeCustomerId: "cus_immutable_original",
      stripeSubscriptionId: "sub_immutable_original",
      subscriptionStatus: "active",
      livemode: false,
      stripeEventCreated: 10,
    });

    await expect(
      db.upsertStripeBillingCustomer({
        teacherEmail,
        stripeCustomerId: "cus_immutable_original",
        livemode: false,
        now: 2_200,
      }),
    ).resolves.toMatchObject({
      stripeCustomerId: "cus_immutable_original",
      stripeSubscriptionId: "sub_immutable_original",
      subscriptionStatus: "active",
      stripeEventCreated: 10,
    });
  });

  it("CAS-projects current Stripe state and recovers invalid_catalog despite an old trigger", async () => {
    const teacherEmail = "stripe-current-state-cas@example.com";
    const stripeCustomerId = "cus_current_state_cas";
    const stripeSubscriptionId = "sub_current_state_cas";
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId,
      now: 1_000,
    });
    const active = await db.upsertStripeBillingSubscription({
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 200,
      now: 2_000,
    });
    if (!active) throw new Error("Active Stripe fixture was not persisted.");

    const strictStaleCas = await db.upsertStripeBillingSubscription({
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "canceled",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: "",
      stripeEventCreated: 199,
      expectedAccount: active,
      now: 3_000,
    });
    expect(strictStaleCas).toBeNull();

    const invalid = await db.projectCurrentStripeNonEntitledSubscription({
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "invalid_catalog",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      observedEventCreated: 100,
      expectedAccount: active,
      now: 4_000,
    });
    expect(invalid).toMatchObject({
      subscriptionStatus: "invalid_catalog",
      catalogFingerprint: "",
      stripeEventCreated: 200,
      projectionRevision: active.projectionRevision + 1,
    });
    if (!invalid) throw new Error("Fail-closed current-state projection was not persisted.");

    const recovered = await db.projectCurrentStripeEntitledSubscription({
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      observedEventCreated: 100,
      expectedAccount: invalid,
      now: 4_000,
    });
    expect(recovered).toMatchObject({
      subscriptionStatus: "active",
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 200,
      projectionRevision: invalid.projectionRevision + 1,
    });
  });

  it("allows only one same-revision projection to win even in the same millisecond", async () => {
    const stripeCustomerId = "cus_projection_revision_race";
    const stripeSubscriptionId = "sub_projection_revision_race";
    await db.upsertStripeBillingCustomer({
      teacherEmail: "projection-revision-race@example.com",
      stripeCustomerId,
      now: 5_000,
    });
    const snapshot = await db.upsertStripeBillingSubscription({
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 300,
      now: 5_100,
    });
    if (!snapshot) throw new Error("Projection race fixture was not persisted.");

    const contenders = await Promise.all([
      db.projectCurrentStripeEntitledSubscription({
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: "active",
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        observedEventCreated: 300,
        expectedAccount: snapshot,
        now: 6_000,
      }),
      db.projectCurrentStripeNonEntitledSubscription({
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: "invalid_catalog",
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        observedEventCreated: 300,
        expectedAccount: snapshot,
        now: 6_000,
      }),
    ]);

    expect(contenders.filter(Boolean)).toHaveLength(1);
    await expect(db.getStripeBillingAccountByCustomerId(stripeCustomerId)).resolves.toMatchObject({
      projectionRevision: snapshot.projectionRevision + 1,
    });
  });

  it("replaces a terminal Subscription exactly once and rejects stale old-sub projections", async () => {
    const stripeCustomerId = "cus_terminal_replacement";
    const oldSubscriptionId = "sub_terminal_old";
    const newSubscriptionId = "sub_terminal_new";
    await db.upsertStripeBillingCustomer({
      teacherEmail: "terminal-replacement@example.com",
      stripeCustomerId,
      now: 7_000,
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId,
      stripeSubscriptionId: oldSubscriptionId,
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 400,
      now: 7_100,
    });
    const terminal = await db.upsertStripeBillingSubscription({
      stripeCustomerId,
      stripeSubscriptionId: oldSubscriptionId,
      subscriptionStatus: "canceled",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: "",
      stripeEventCreated: 500,
      now: 7_200,
    });
    if (!terminal) throw new Error("Terminal Stripe fixture was not persisted.");

    const replacementInput = {
      stripeCustomerId,
      stripeSubscriptionId: newSubscriptionId,
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      observedEventCreated: 450,
      expectedAccount: terminal,
      now: 7_300,
    };
    const replacement = await db.replaceTerminalStripeSubscriptionFromCheckout(
      replacementInput,
    );
    expect(replacement).toMatchObject({
      stripeSubscriptionId: newSubscriptionId,
      subscriptionStatus: "active",
      stripeEventCreated: 500,
      projectionRevision: terminal.projectionRevision + 1,
    });
    await expect(
      db.replaceTerminalStripeSubscriptionFromCheckout(replacementInput),
    ).resolves.toBeNull();
    await expect(
      db.projectCurrentStripeNonEntitledSubscription({
        stripeCustomerId,
        stripeSubscriptionId: oldSubscriptionId,
        subscriptionStatus: "canceled",
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        observedEventCreated: 600,
        expectedAccount: terminal,
        now: 7_400,
      }),
    ).resolves.toBeNull();
    await expect(db.getStripeBillingAccountByCustomerId(stripeCustomerId)).resolves.toMatchObject({
      stripeSubscriptionId: newSubscriptionId,
      subscriptionStatus: "active",
    });
  });

  it("requires the current price book and exact catalog fingerprint for Stripe access", async () => {
    const teacherEmail = "catalog-entitlement@example.com";
    await db.setUserRoleTeacher(teacherEmail);
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_catalog_entitlement",
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_catalog_entitlement",
      stripeSubscriptionId: "sub_catalog_entitlement",
      subscriptionStatus: "active",
      priceBookId: "habla-teacher-ai-usd-v1",
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 1,
    });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);

    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_catalog_entitlement",
      stripeSubscriptionId: "sub_catalog_entitlement",
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: "wrong-fingerprint",
      stripeEventCreated: 2,
    });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);

    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_catalog_entitlement",
      stripeSubscriptionId: "sub_catalog_entitlement",
      subscriptionStatus: "trialing",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 3,
    });
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);
  });

  it("never grants test-runtime access from a live-mode billing projection", async () => {
    const teacherEmail = "wrong-stripe-mode@example.com";
    await db.setUserRoleTeacher(teacherEmail);
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_wrong_stripe_mode",
      livemode: true,
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_wrong_stripe_mode",
      stripeSubscriptionId: "sub_wrong_stripe_mode",
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      livemode: true,
      stripeEventCreated: 1,
    });

    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);
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
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_durable_billing",
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_durable_billing",
      stripeSubscriptionId: "sub_durable_billing",
      subscriptionStatus: "active",
      priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
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

  it("materializes a billable delivery marker into the scoped v3 outbox", async () => {
    const teacherEmail = "v3-marker-materialization@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "v3-marker-materialization",
      { required: false, priceBookId, outputTokens: 37 },
    );
    await applyAndMarkFixtureForBilling(db, fixture, teacherEmail, priceBookId);

    const [marker] = await db.listAiGradingAttemptsForSubmission(
      fixture.submission.id,
      teacherEmail,
    );
    expect(marker).toMatchObject({
      billingRequired: true,
      billingContractId: TEST_BILLING_CONTRACT_ID,
      billingFreeCreditApplied: false,
    });

    const usage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: fixture.cacheKey,
      priceBookId,
      attemptId: fixture.attempt.id,
      submissionId: fixture.submission.id,
      baseUnits: 999,
      durationSeconds: 999,
      outputTokens: 999,
    });
    expect(usage).toMatchObject({
      teacherEmail,
      cacheKey: fixture.cacheKey,
      attemptId: fixture.attempt.id,
      submissionId: fixture.submission.id,
      billingContractId: TEST_BILLING_CONTRACT_ID,
      freeCreditApplied: false,
      baseUnits: 1,
      durationSeconds: 65,
      outputTokens: 37,
      status: "pending",
    });

    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const persisted = await raw.execute({
        sql: `SELECT
          teacher_email as teacherEmail,
          cache_key as cacheKey,
          attempt_id as attemptId,
          submission_id as submissionId,
          billing_contract_id as billingContractId,
          base_units as baseUnits,
          duration_seconds as durationSeconds,
          output_tokens as outputTokens,
          status
        FROM ai_billing_usage_v3
        WHERE id = ?`,
        args: [usage!.id],
      });
      expect(persisted.rows).toEqual([
        expect.objectContaining({
          teacherEmail,
          cacheKey: fixture.cacheKey,
          attemptId: fixture.attempt.id,
          submissionId: fixture.submission.id,
          billingContractId: TEST_BILLING_CONTRACT_ID,
          baseUnits: 1,
          durationSeconds: 65,
          outputTokens: 37,
          status: "pending",
        }),
      ]);
      const legacy = await raw.execute({
        sql: "SELECT COUNT(*) as count FROM ai_billing_usage_v2 WHERE cache_key = ?",
        args: [fixture.cacheKey],
      });
      expect(Number(legacy.rows[0]?.count)).toBe(0);
    } finally {
      raw.close();
    }
  });

  it("ceilings the immutable fractional attempt duration during outbox recovery", async () => {
    const teacherEmail = "fractional-duration-recovery@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "fractional-duration-recovery",
      { required: false, priceBookId, outputTokens: 41 },
      { durationSeconds: 65.25 },
    );
    await applyAndMarkFixtureForBilling(db, fixture, teacherEmail, priceBookId);

    const recovered = (
      await db.listUnqueuedAiBillingAttempts(
        priceBookId,
        100,
        Date.now(),
        false,
        TEST_BILLING_CONTRACT_ID,
      )
    ).find((item) => item.attemptId === fixture.attempt.id);
    expect(recovered).toMatchObject({
      durationSeconds: 65.25,
      outputTokens: 41,
      billingContractId: TEST_BILLING_CONTRACT_ID,
    });

    const usage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: fixture.cacheKey,
      priceBookId,
      attemptId: fixture.attempt.id,
      submissionId: fixture.submission.id,
      durationSeconds: 1,
      outputTokens: 1,
      occurredAt: recovered!.occurredAt,
    });
    expect(usage).toMatchObject({
      durationSeconds: 66,
      outputTokens: 41,
      billingContractId: TEST_BILLING_CONTRACT_ID,
    });
  });

  it("keeps an old credited marker automatically recoverable beyond the replay cutoff", async () => {
    const teacherEmail = "credited-marker-long-recovery@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const credited = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "credited-marker-long-recovery",
      { required: false, priceBookId, outputTokens: 9 },
    );
    await createCompletedGradingFixture(
      db,
      teacherEmail,
      "credited-marker-qualifying-class",
    );
    await applyAndMarkFixtureForBilling(db, credited, teacherEmail, priceBookId);
    const [marker] = await db.listAiGradingAttemptsForSubmission(
      credited.submission.id,
      teacherEmail,
    );
    expect(marker).toMatchObject({
      billingRequired: true,
      billingFreeCreditApplied: true,
    });

    const occurredAt = credited.attempt.completedAt ?? credited.attempt.createdAt;
    const recoveryNow = occurredAt + STRIPE_AUTOMATIC_USAGE_RECOVERY_WINDOW_MS + 1;
    const recovered = (
      await db.listUnqueuedAiBillingAttempts(
        priceBookId,
        100,
        recoveryNow,
        false,
        TEST_BILLING_CONTRACT_ID,
      )
    ).find((item) => item.attemptId === credited.attempt.id);
    expect(recovered).toMatchObject({ attemptId: credited.attempt.id, occurredAt });

    await expect(
      db.createAiBillingUsage({
        teacherEmail,
        cacheKey: credited.cacheKey,
        priceBookId,
        attemptId: credited.attempt.id,
        submissionId: credited.submission.id,
        durationSeconds: credited.attempt.durationSeconds,
        outputTokens: credited.attempt.billableOutputTokens,
        occurredAt,
        now: recoveryNow,
      }),
    ).resolves.toMatchObject({
      freeCreditApplied: true,
      status: "credited",
      createdAt: occurredAt,
    });
  });

  it("keeps recovered usage in the attempt occurrence month across a UTC rollover", async () => {
    const teacherEmail = "month-rollover@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const occurrenceClock = Date.UTC(2026, 7, 31, 23, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(occurrenceClock);
    const fixture = await createCompletedGradingFixture(db, teacherEmail, "month-rollover", {
      required: false,
      priceBookId,
      outputTokens: 15,
    });
    await applyAndMarkFixtureForBilling(db, fixture, teacherEmail, priceBookId);
    nowSpy.mockRestore();
    const occurredAt = fixture.attempt.completedAt ?? fixture.attempt.createdAt;
    const occurred = new Date(occurredAt);
    const recoveryNow = Date.UTC(
      occurred.getUTCFullYear(),
      occurred.getUTCMonth() + 1,
      1,
      0,
      5,
    );
    const recovered = (await db.listUnqueuedAiBillingAttempts(
      priceBookId,
      100,
      recoveryNow,
    )).find((item) => item.attemptId === fixture.attempt.id);
    expect(recovered).toMatchObject({ attemptId: fixture.attempt.id, occurredAt });

    const usage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: fixture.cacheKey,
      priceBookId,
      attemptId: fixture.attempt.id,
      submissionId: fixture.submission.id,
      durationSeconds: fixture.attempt.durationSeconds,
      outputTokens: fixture.attempt.billableOutputTokens,
      occurredAt: recovered!.occurredAt,
      now: recoveryNow,
    });
    const occurrenceMonth = db.getAiBillingUtcMonth(occurredAt);
    const recoveryMonth = db.getAiBillingUtcMonth(recoveryNow);
    expect(occurrenceMonth).not.toBe(recoveryMonth);
    expect(usage).toMatchObject({ billingMonth: occurrenceMonth, createdAt: occurredAt });
    await expect(
      db.getAiBillingMonthlySummary(teacherEmail, occurrenceMonth, testBillingScope),
    ).resolves.toMatchObject({
      successfulResults: 1,
    });
    await expect(
      db.getAiBillingMonthlySummary(teacherEmail, recoveryMonth, testBillingScope),
    ).resolves.toMatchObject({
      successfulResults: 0,
    });
  });

  it("recovers from a soft-deleted source and bills the immutable delivery-time destination", async () => {
    const teacherEmail = "snapshot-recovery@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "snapshot-recovery",
      { required: false, priceBookId, outputTokens: 77 },
    );
    await applyAndMarkFixtureForBilling(db, fixture, teacherEmail, priceBookId);
    const deliveryAccount = await db.getStripeBillingAccountByTeacherEmail(teacherEmail);
    expect(deliveryAccount?.stripeSubscriptionId).toBeTruthy();

    const markerBefore = (await db.listAiGradingAttemptsForSubmission(
      fixture.submission.id,
      teacherEmail,
    ))[0]!;

    const remap = createClient({ url: `file:${localDbPath}` });
    try {
      await remap.execute({
        sql: `UPDATE stripe_billing_accounts
        SET stripe_customer_id = 'cus_snapshot_replacement',
            stripe_subscription_id = 'sub_snapshot_replacement',
            subscription_status = 'active',
            price_book_id = ?,
            catalog_fingerprint = ?,
            livemode = 0,
            stripe_event_created = 50
        WHERE teacher_email = ?`,
        args: [priceBookId, STRIPE_CATALOG_MANIFEST.fingerprint, teacherEmail],
      });
    } finally {
      remap.close();
    }
    await createCompletedGradingFixture(
      db,
      teacherEmail,
      "snapshot-recovery-new-class",
      { required: false, priceBookId, outputTokens: 0 },
    );
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(true);
    const markerAfter = (await db.listAiGradingAttemptsForSubmission(
      fixture.submission.id,
      teacherEmail,
    ))[0]!;
    expect(markerAfter).toMatchObject({
      billingStripeCustomerId: markerBefore.billingStripeCustomerId,
      billingStripeSubscriptionId: markerBefore.billingStripeSubscriptionId,
      billingCatalogFingerprint: markerBefore.billingCatalogFingerprint,
      billingLivemode: markerBefore.billingLivemode,
      billingQualifyingClassHighWater: markerBefore.billingQualifyingClassHighWater,
    });
    expect(markerAfter.billingStripeCustomerId).not.toBe("cus_snapshot_replacement");

    await expect(db.deleteSubmission(fixture.submission.id, teacherEmail)).resolves.toBe(true);

    const usage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: fixture.cacheKey,
      priceBookId,
      attemptId: fixture.attempt.id,
      submissionId: fixture.submission.id,
      durationSeconds: fixture.attempt.durationSeconds,
      outputTokens: fixture.attempt.billableOutputTokens,
      livemode: false,
    });
    expect(usage).toMatchObject({
      stripeCustomerId: deliveryAccount!.stripeCustomerId,
      stripeSubscriptionId: deliveryAccount!.stripeSubscriptionId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      livemode: false,
      createdAt: fixture.attempt.completedAt ?? fixture.attempt.createdAt,
    });
    expect(usage?.stripeCustomerId).not.toBe("cus_snapshot_replacement");
  });

  it("reports attempted-unreported dimensions and expired unqueued attempts for reconciliation", async () => {
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const attemptedTeacher = "attempted-reconciliation@example.com";
    const attempted = await createCompletedGradingFixture(
      db,
      attemptedTeacher,
      "attempted-reconciliation",
      { required: false, priceBookId, outputTokens: 0 },
    );
    await applyAndMarkFixtureForBilling(db, attempted, attemptedTeacher, priceBookId);
    const usage = await db.createAiBillingUsage({
      teacherEmail: attemptedTeacher,
      cacheKey: attempted.cacheKey,
      priceBookId,
      attemptId: attempted.attempt.id,
      submissionId: attempted.submission.id,
      durationSeconds: attempted.attempt.durationSeconds,
      outputTokens: 0,
    });
    expect(usage).not.toBeNull();
    await db.claimAiBillingUsageDimensionForDelivery({
      usageId: usage!.id,
      dimension: "base",
    });

    const expiredTeacher = "expired-reconciliation@example.com";
    const expired = await createCompletedGradingFixture(
      db,
      expiredTeacher,
      "expired-reconciliation",
      { required: false, priceBookId, outputTokens: 0 },
    );
    await applyAndMarkFixtureForBilling(db, expired, expiredTeacher, priceBookId);
    const expiredAt =
      (expired.attempt.completedAt ?? expired.attempt.createdAt) +
      STRIPE_AUTOMATIC_USAGE_RECOVERY_WINDOW_MS +
      1;

    await expect(
      db.getAiBillingReconciliationHealth(priceBookId, expiredAt, {
        livemode: false,
        billingContractId: TEST_BILLING_CONTRACT_ID,
      }),
    ).resolves.toMatchObject({ attemptedUnreported: 1, expiredUnqueued: 1 });
    await expect(
      db.listUnqueuedAiBillingAttempts(priceBookId, 100, expiredAt),
    ).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ attemptId: expired.attempt.id })]),
    );
  });

  it("classifies old-contract billing rows as manual while current-contract rows stay recoverable", async () => {
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const scope = {
      livemode: false,
      billingContractId: TEST_BILLING_CONTRACT_ID,
    } as const;
    const baseline = await db.getAiBillingReconciliationHealth(
      priceBookId,
      Date.now(),
      scope,
    );

    async function markedFixture(label: string) {
      const teacherEmail = `${label}@example.com`;
      const fixture = await createCompletedGradingFixture(
        db,
        teacherEmail,
        label,
        { required: false, priceBookId, outputTokens: 0 },
      );
      await applyAndMarkFixtureForBilling(db, fixture, teacherEmail, priceBookId);
      return { teacherEmail, fixture };
    }

    const oldUsageFixture = await markedFixture("old-contract-usage");
    const oldUsage = await db.createAiBillingUsage({
      teacherEmail: oldUsageFixture.teacherEmail,
      cacheKey: oldUsageFixture.fixture.cacheKey,
      priceBookId,
      attemptId: oldUsageFixture.fixture.attempt.id,
      submissionId: oldUsageFixture.fixture.submission.id,
      durationSeconds: oldUsageFixture.fixture.attempt.durationSeconds,
      outputTokens: 0,
    });
    const currentUsageFixture = await markedFixture("current-contract-usage");
    const currentUsage = await db.createAiBillingUsage({
      teacherEmail: currentUsageFixture.teacherEmail,
      cacheKey: currentUsageFixture.fixture.cacheKey,
      priceBookId,
      attemptId: currentUsageFixture.fixture.attempt.id,
      submissionId: currentUsageFixture.fixture.submission.id,
      durationSeconds: currentUsageFixture.fixture.attempt.durationSeconds,
      outputTokens: 0,
    });
    const oldMarker = await markedFixture("old-contract-marker");
    const currentMarker = await markedFixture("current-contract-marker");

    const oldContractId = "contract_superseded_manual_reconciliation";
    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      await raw.execute({
        sql: "UPDATE ai_billing_usage_v3 SET billing_contract_id = ? WHERE id = ?",
        args: [oldContractId, oldUsage!.id],
      });
      await raw.execute({
        sql: "UPDATE ai_grading_attempts SET billing_contract_id = ? WHERE id = ?",
        args: [oldContractId, oldMarker.fixture.attempt.id],
      });
    } finally {
      raw.close();
    }

    const health = await db.getAiBillingReconciliationHealth(
      priceBookId,
      Date.now(),
      scope,
    );
    expect(health.pendingUnattempted - baseline.pendingUnattempted).toBe(2);
    expect(health.invalidPendingUnattempted - baseline.invalidPendingUnattempted).toBe(2);
    expect(health.recoverableUnqueued - baseline.recoverableUnqueued).toBe(1);
    expect(health.invalidUnqueued - baseline.invalidUnqueued).toBe(1);

    const pending = await db.listPendingAiBillingUsage(
      100,
      false,
      Date.now(),
      TEST_BILLING_CONTRACT_ID,
    );
    expect(pending).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: currentUsage!.id })]),
    );
    expect(pending).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: oldUsage!.id })]),
    );

    const unqueued = await db.listUnqueuedAiBillingAttempts(
      priceBookId,
      100,
      Date.now(),
      false,
      TEST_BILLING_CONTRACT_ID,
    );
    expect(unqueued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attemptId: currentMarker.fixture.attempt.id }),
      ]),
    );
    expect(unqueued).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attemptId: oldMarker.fixture.attempt.id }),
      ]),
    );
  });

  it("marks billing only after an owner-scoped completed result has durable Stripe entitlement", async () => {
    const teacherEmail = "post-apply-billing@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_post_apply_billing",
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_post_apply_billing",
      stripeSubscriptionId: "sub_post_apply_billing",
      subscriptionStatus: "active",
      priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
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

  it("atomically applies a persisted grade and snapshots its Stripe billing destination", async () => {
    const teacherEmail = "atomic-finalize@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "atomic-finalize",
      { required: false, priceBookId, outputTokens: 88 },
    );
    const account = await grantStripeBilling(db, teacherEmail, priceBookId);

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
        billingCandidate: true,
        allowUnmeteredAccess: false,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: true });
    await expect(
      db.findSubmissionById(fixture.submission.id, teacherEmail),
    ).resolves.toMatchObject({
      grade: fixture.attempt.suggestedScore,
      feedback: fixture.attempt.feedback,
      gradeSource: "ai",
    });
    await expect(
      db.listAiGradingAttemptsForSubmission(fixture.submission.id, teacherEmail),
    ).resolves.toEqual([
      expect.objectContaining({
        id: fixture.attempt.id,
        deliveryStatus: "delivered",
        billingRequired: true,
        billingStripeCustomerId: account!.stripeCustomerId,
        billingStripeSubscriptionId: account!.stripeSubscriptionId,
        billingCatalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        billingLivemode: false,
      }),
    ]);
    await expect(db.listUnqueuedAiBillingAttempts(priceBookId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attemptId: fixture.attempt.id }),
      ]),
    );
  });

  it("preserves a teacher edit and writes no billing marker when the apply race is lost", async () => {
    const teacherEmail = "atomic-teacher-race@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "atomic-teacher-race",
      { required: false, priceBookId, outputTokens: 12 },
    );
    await grantStripeBilling(db, teacherEmail, priceBookId);
    await db.updateSubmission(fixture.submission.id, teacherEmail, {
      studentName: fixture.submission.studentName,
      grade: 6,
      feedback: "Teacher-authored grade won the race.",
      rubricScores: null,
    });

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
        billingCandidate: true,
        allowUnmeteredAccess: false,
      }),
    ).resolves.toEqual({
      status: "not_applied",
      billingRequired: false,
      reason: "submission_changed",
    });
    await expect(
      db.findSubmissionById(fixture.submission.id, teacherEmail),
    ).resolves.toMatchObject({
      grade: 6,
      feedback: "Teacher-authored grade won the race.",
      gradeSource: "teacher",
    });
    await expect(
      db.listAiGradingAttemptsForSubmission(fixture.submission.id, teacherEmail),
    ).resolves.toEqual([]);
    await expect(
      db.withholdAiGradingAttemptResult({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        reason: "Teacher-authored grade won the delivery race.",
      }),
    ).resolves.toBe(true);
    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const audit = await raw.execute({
        sql: `SELECT status, delivery_status, transcript, suggested_score, feedback, error_code
          FROM ai_grading_attempts
          WHERE id = ?`,
        args: [fixture.attempt.id],
      });
      expect(audit.rows[0]).toMatchObject({
        status: "failed",
        delivery_status: "withheld",
        transcript: "",
        suggested_score: null,
        feedback: "",
        error_code: "result_not_delivered",
      });
    } finally {
      raw.close();
    }
  });

  it("rolls the grade back when the atomic billing marker write fails", async () => {
    const teacherEmail = "atomic-rollback@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "atomic-rollback",
      { required: false, priceBookId, outputTokens: 55 },
    );
    await grantStripeBilling(db, teacherEmail, priceBookId);
    const raw = createClient({ url: `file:${localDbPath}` });
    await raw.execute(`CREATE TRIGGER test_atomic_billing_marker_failure
      BEFORE UPDATE OF billing_required ON ai_grading_attempts
      BEGIN
        SELECT RAISE(ABORT, 'forced atomic marker failure');
      END`);
    try {
      await expect(
        db.finalizeAiGradeDelivery({
          attemptId: fixture.attempt.id,
          ownerEmail: teacherEmail,
          priceBookId,
          billingCandidate: true,
          allowUnmeteredAccess: false,
        }),
      ).rejects.toThrow();
    } finally {
      await raw.execute("DROP TRIGGER test_atomic_billing_marker_failure");
      raw.close();
    }

    await expect(
      db.findSubmissionById(fixture.submission.id, teacherEmail),
    ).resolves.toMatchObject({
      grade: null,
      feedback: "",
      gradeSource: "teacher",
    });
    await expect(
      db.listAiGradingAttemptsForSubmission(fixture.submission.id, teacherEmail),
    ).resolves.toEqual([]);
  });

  it("allows explicit unmetered access but fails closed for Stripe-only access when billing is unavailable", async () => {
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const unmeteredTeacher = "atomic-unmetered@example.com";
    const unmetered = await createCompletedGradingFixture(
      db,
      unmeteredTeacher,
      "atomic-unmetered",
      { required: false, priceBookId, outputTokens: 10 },
    );
    billingRuntimeMocks.isReady.mockResolvedValue(false);
    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: unmetered.attempt.id,
        ownerEmail: unmeteredTeacher,
        priceBookId,
        billingCandidate: true,
        allowUnmeteredAccess: true,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: false });

    billingRuntimeMocks.isReady.mockResolvedValue(true);
    const stripeTeacher = "atomic-stripe-only@example.com";
    const stripeOnly = await createCompletedGradingFixture(
      db,
      stripeTeacher,
      "atomic-stripe-only",
      { required: false, priceBookId, outputTokens: 10 },
    );
    await grantStripeBilling(db, stripeTeacher, priceBookId);
    billingRuntimeMocks.isReady.mockResolvedValue(false);
    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: stripeOnly.attempt.id,
        ownerEmail: stripeTeacher,
        priceBookId,
        billingCandidate: true,
        allowUnmeteredAccess: false,
      }),
    ).resolves.toEqual({
      status: "not_applied",
      billingRequired: false,
      reason: "billing_unavailable",
    });
    await expect(
      db.findSubmissionById(stripeOnly.submission.id, stripeTeacher),
    ).resolves.toMatchObject({ grade: null, feedback: "" });
  });

  it("never creates a billing marker while usage runtime is off, including for manual access", async () => {
    const teacherEmail = "runtime-off-marker@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "runtime-off-marker",
      { required: false, priceBookId, outputTokens: 40 },
    );
    await grantStripeBilling(db, teacherEmail, priceBookId);
    await db.setUserRoleTeacher(teacherEmail);
    await db.setUserPaid(teacherEmail, true);
    await expect(
      db.applyAiGradeToSubmission(fixture.submission.id, teacherEmail, {
        grade: fixture.attempt.suggestedScore!,
        feedback: fixture.attempt.feedback,
        rubricScores: null,
      }),
    ).resolves.not.toBeNull();

    billingRuntimeMocks.isReady.mockResolvedValue(false);
    await expect(db.getUserHasAiAccess(teacherEmail)).resolves.toBe(true);
    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
      }),
    ).resolves.toBe(false);
    await expect(db.listUnqueuedAiBillingAttempts(priceBookId)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ attemptId: fixture.attempt.id })]),
    );
  });

  it("refuses the post-apply billing marker when any durable prerequisite is missing", async () => {
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;

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
      subscriptionStatus: "active",
      priceBookId: "different-price-book",
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
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
      subscriptionStatus: "active",
      priceBookId,
      catalogFingerprint: "wrong-fingerprint",
      stripeEventCreated: 2,
    });
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
      subscriptionStatus: "active",
      priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 3,
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
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
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

    await expect(
      db.getAiBillingMonthlySummary(teacherEmail, "2026-08", testBillingScope),
    ).resolves.toMatchObject({
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

    const billingNow = billable!.createdAt + 1_000;
    const pending = await db.listPendingAiBillingUsage(100, undefined, billingNow);
    expect(pending.map((item) => item.id)).toContain(billable?.id);
    expect(pending.map((item) => item.id)).not.toContain(duplicateA?.id);
    await expect(
      db.listPendingAiBillingUsage(
        100,
        undefined,
        billable!.createdAt + STRIPE_AUTOMATIC_USAGE_RECOVERY_WINDOW_MS + 1,
      ),
    ).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: billable!.id })]),
    );
    const expiredHealth = await db.getAiBillingReconciliationHealth(
      priceBookId,
      billable!.createdAt + STRIPE_AUTOMATIC_USAGE_RECOVERY_WINDOW_MS + 1,
      { livemode: false, billingContractId: TEST_BILLING_CONTRACT_ID },
    );
    expect(expiredHealth.expiredPendingUnattempted).toBeGreaterThanOrEqual(2);

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
    expect(audioReported).toMatchObject({
      status: "reported",
      baseReportedAt: 11_000,
      audioReportedAt: 12_000,
      outputReportedAt: null,
    });
    await expect(db.listPendingAiBillingUsage(100, undefined, billingNow)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: billable!.id })])
    );
  });

  it("keeps first-result credit assignment immutable across an outbox crash and recovery", async () => {
    const teacherEmail = "credit-crash-order@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const first = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "credit-crash-first",
      { required: false, priceBookId, outputTokens: 10 },
    );
    const second = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "credit-crash-second",
      { required: false, priceBookId, outputTokens: 20 },
    );
    await grantStripeBilling(db, teacherEmail, priceBookId);

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: first.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
        billingCandidate: true,
        allowUnmeteredAccess: false,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: true });
    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: second.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
        billingCandidate: true,
        allowUnmeteredAccess: false,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: true });

    const [firstMarker] = await db.listAiGradingAttemptsForSubmission(
      first.submission.id,
      teacherEmail,
    );
    const [secondMarker] = await db.listAiGradingAttemptsForSubmission(
      second.submission.id,
      teacherEmail,
    );
    expect(firstMarker).toMatchObject({ billingFreeCreditApplied: true });
    expect(secondMarker).toMatchObject({ billingFreeCreditApplied: false });

    // Simulate A crashing after its atomic marker but before outbox creation:
    // B queues first, then recovery materializes A later.
    const secondUsage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: second.cacheKey,
      priceBookId,
      attemptId: second.attempt.id,
      submissionId: second.submission.id,
      durationSeconds: 65,
      outputTokens: 20,
    });
    const recoveredFirstUsage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: first.cacheKey,
      priceBookId,
      attemptId: first.attempt.id,
      submissionId: first.submission.id,
      durationSeconds: 65,
      outputTokens: 10,
    });

    expect(secondUsage).toMatchObject({ freeCreditApplied: false, status: "pending" });
    expect(recoveredFirstUsage).toMatchObject({
      freeCreditApplied: true,
      status: "credited",
    });
  });

  it("does not reserve another credit when durable usage outlives its source attempt", async () => {
    const teacherEmail = "credit-retention-dedup@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const sharedCacheKey = "credit-retention-semantic-result";
    const original = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "credit-retention-original",
      { required: false, priceBookId, outputTokens: 5 },
      { cacheKey: sharedCacheKey },
    );
    await createCompletedGradingFixture(
      db,
      teacherEmail,
      "credit-retention-qualifying-class",
    );
    await grantStripeBilling(db, teacherEmail, priceBookId);
    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: original.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
        billingCandidate: true,
        allowUnmeteredAccess: false,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: true });
    const originalUsage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: sharedCacheKey,
      priceBookId,
      attemptId: original.attempt.id,
      submissionId: original.submission.id,
      durationSeconds: 65,
      outputTokens: 5,
    });
    expect(originalUsage).toMatchObject({ freeCreditApplied: true });

    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      await raw.execute({
        sql: "DELETE FROM submissions WHERE id = ?",
        args: [original.submission.id],
      });
    } finally {
      raw.close();
    }
    await expect(db.getAiBillingUsageById(originalUsage!.id)).resolves.toMatchObject({
      cacheKey: sharedCacheKey,
      freeCreditApplied: true,
    });

    const duplicate = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "credit-retention-duplicate",
      { required: false, priceBookId, outputTokens: 6 },
      { cacheKey: sharedCacheKey },
    );
    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: duplicate.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId,
        billingCandidate: true,
        allowUnmeteredAccess: false,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: false });

    const billingMonth = db.getAiBillingUtcMonth(originalUsage!.createdAt);
    await expect(
      db.getAiBillingMonthlySummary(teacherEmail, billingMonth, testBillingScope),
    ).resolves.toMatchObject({ usedCredits: 1, freeCreditResults: 1 });
  });

  it("caps the qualifying-class allowance and bills results beyond the published limit", async () => {
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
    await expect(db.countQualifyingAiBillingClasses(teacherEmail)).resolves.toBe(classCap);

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
      db.getAiBillingMonthlySummary(teacherEmail, "2026-08", testBillingScope),
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

  it("isolates semantic usage and monthly credits across Stripe modes", async () => {
    const teacherEmail = "scope-isolation@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const sharedCacheKey = "same-semantic-result-across-stripe-modes";
    const testFixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "scope-isolation-test",
      { required: false, priceBookId, outputTokens: 20 },
      { cacheKey: sharedCacheKey },
    );
    const liveFixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "scope-isolation-live",
      { required: false, priceBookId, outputTokens: 20 },
      { cacheKey: sharedCacheKey },
    );
    await applyAndMarkFixtureForBilling(db, testFixture, teacherEmail, priceBookId);
    await db.applyAiGradeToSubmission(liveFixture.submission.id, teacherEmail, {
      grade: liveFixture.attempt.suggestedScore!,
      feedback: liveFixture.attempt.feedback,
      rubricScores: null,
    });
    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      await raw.execute({
        sql: `UPDATE ai_grading_attempts
        SET billing_required = 1,
            delivery_status = 'delivered',
            billing_price_book_id = ?,
            billing_stripe_customer_id = 'cus_scope_live',
            billing_stripe_subscription_id = 'sub_scope_live',
            billing_catalog_fingerprint = ?,
            billing_contract_id = ?,
            billing_livemode = 1,
            billing_qualifying_class_high_water = 2,
            billing_free_credit_applied = 1
        WHERE id = ?`,
        args: [
          priceBookId,
          STRIPE_CATALOG_MANIFEST.fingerprint,
          TEST_BILLING_CONTRACT_ID,
          liveFixture.attempt.id,
        ],
      });
    } finally {
      raw.close();
    }

    const testUsage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: sharedCacheKey,
      priceBookId,
      attemptId: testFixture.attempt.id,
      submissionId: testFixture.submission.id,
      durationSeconds: 65,
      outputTokens: 20,
      livemode: false,
    });
    const liveUsage = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: sharedCacheKey,
      priceBookId,
      attemptId: liveFixture.attempt.id,
      submissionId: liveFixture.submission.id,
      durationSeconds: 65,
      outputTokens: 20,
      livemode: true,
    });
    expect(testUsage).toMatchObject({ freeCreditApplied: true, livemode: false });
    expect(liveUsage).toMatchObject({ freeCreditApplied: true, livemode: true });
    expect(liveUsage?.id).not.toBe(testUsage?.id);

    const billingMonth = db.getAiBillingUtcMonth(testUsage!.createdAt);
    await expect(
      db.getAiBillingMonthlySummary(teacherEmail, billingMonth, testBillingScope),
    ).resolves.toMatchObject({ successfulResults: 1, freeCreditResults: 1, usedCredits: 1 });
    await expect(
      db.getAiBillingMonthlySummary(teacherEmail, billingMonth, {
        ...testBillingScope,
        livemode: true,
      }),
    ).resolves.toMatchObject({ successfulResults: 1, freeCreditResults: 1, usedCredits: 1 });
    await expect(
      db.getAiBillingMonthlySummary(teacherEmail, billingMonth, {
        ...testBillingScope,
        billingContractId: "different-billing-contract",
      }),
    ).resolves.toMatchObject({
      successfulResults: 0,
      freeCreditResults: 0,
      billableResults: 0,
    });
  });

  it("does not let an invalid legacy-shaped ledger row starve valid pending usage", async () => {
    const teacherEmail = "invalid-ledger-queue@example.com";
    const priceBookId = TEACHER_AI_PRICE_BOOK.id;
    const first = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "invalid-ledger-first",
      { required: false, priceBookId, outputTokens: 0 },
    );
    const second = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "invalid-ledger-second",
      { required: false, priceBookId, outputTokens: 0 },
    );
    await applyAndMarkFixtureForBilling(db, first, teacherEmail, priceBookId);
    await applyAndMarkFixtureForBilling(db, second, teacherEmail, priceBookId);
    await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: first.cacheKey,
      priceBookId,
      attemptId: first.attempt.id,
      submissionId: first.submission.id,
      durationSeconds: 65,
      outputTokens: 0,
      livemode: false,
    });
    const validPending = await db.createAiBillingUsage({
      teacherEmail,
      cacheKey: second.cacheKey,
      priceBookId,
      attemptId: second.attempt.id,
      submissionId: second.submission.id,
      durationSeconds: 65,
      outputTokens: 0,
      livemode: false,
    });
    expect(validPending).toMatchObject({ status: "pending", freeCreditApplied: false });

    const invalidId = "aiu_invalid_legacy_shaped_queue";
    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const queueNow = validPending!.createdAt + 1_000;
      const validCreatedAt = queueNow - 22 * 60 * 60 * 1_000;
      await raw.execute({
        sql: `UPDATE ai_billing_usage_v3
        SET created_at = ?, updated_at = ?
        WHERE id = ?`,
        args: [validCreatedAt, validCreatedAt, validPending!.id],
      });
      await raw.execute({
        sql: `INSERT INTO ai_billing_usage_v3 (
          id, teacher_email, billing_month, cache_key, price_book_id,
          attempt_id, submission_id, stripe_customer_id,
          stripe_subscription_id, catalog_fingerprint, billing_contract_id, livemode,
          free_credit_applied, base_units, duration_seconds, output_tokens,
          status, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '', '', 0, 0, 1, 1, 0, 'pending', '', ?, ?)`,
        args: [
          invalidId,
          "legacy-invalid@example.com",
          db.getAiBillingUtcMonth(validPending!.createdAt),
          "legacy-invalid-cache",
          priceBookId,
          "legacy-invalid-attempt",
          "legacy-invalid-submission",
          validCreatedAt - 1,
          validCreatedAt - 1,
        ],
      });
      await expect(
        db.listPendingAiBillingUsage(1, false, queueNow),
      ).resolves.toEqual([expect.objectContaining({ id: validPending!.id })]);
      const health = await db.getAiBillingReconciliationHealth(
        priceBookId,
        queueNow,
      );
      expect(health.invalidPendingUnattempted).toBeGreaterThanOrEqual(2);
    } finally {
      await raw.execute({
        sql: "DELETE FROM ai_billing_usage_v3 WHERE id = ?",
        args: [invalidId],
      });
      raw.close();
    }
  });

  it("keeps ambiguous unscoped legacy billing rows quarantined and billing fail-closed", async () => {
    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const tableInfo = await raw.execute("PRAGMA table_info(ai_billing_credit_periods_v2)");
      const primaryKeyColumns = tableInfo.rows
        .filter((row) => Number(row.pk) > 0)
        .sort((left, right) => Number(left.pk) - Number(right.pk))
        .map((row) => String(row.name));
      expect(primaryKeyColumns).toEqual([
        "teacher_email",
        "billing_month",
        "price_book_id",
        "catalog_fingerprint",
        "livemode",
      ]);

      await raw.execute(`INSERT INTO ai_billing_credit_periods (
        teacher_email, billing_month, qualifying_class_high_water,
        used_credits, created_at, updated_at
      ) VALUES ('ambiguous-legacy@example.com', '2026-08', 2, 1, 1, 1)`);
      await expect(db.getStripeBillingStorageHealth()).resolves.toMatchObject({
        ready: false,
        legacyCreditPeriods: 1,
      });
    } finally {
      await raw.execute(
        "DELETE FROM ai_billing_credit_periods WHERE teacher_email = 'ambiguous-legacy@example.com'",
      );
      raw.close();
    }
    await expect(db.isStripeBillingStorageReady()).resolves.toBe(true);
  });

  it("quarantines populated v2 ledgers during upgrade without changing semantic uniqueness", async () => {
    const upgradeDbPath = path.join(
      os.tmpdir(),
      `speaklab-stripe-v2-upgrade-${process.pid}-${Date.now()}.db`,
    );
    const previousDbPath = process.env.HABLA_LOCAL_DB_PATH;
    fs.rmSync(upgradeDbPath, { force: true });
    const seed = createClient({ url: `file:${upgradeDbPath}` });
    try {
      await seed.execute(`CREATE TABLE ai_billing_credit_periods_v2 (
        teacher_email TEXT NOT NULL COLLATE NOCASE,
        billing_month TEXT NOT NULL,
        price_book_id TEXT NOT NULL,
        catalog_fingerprint TEXT NOT NULL,
        livemode INTEGER NOT NULL,
        qualifying_class_high_water INTEGER NOT NULL DEFAULT 0,
        used_credits INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(
          teacher_email, billing_month, price_book_id, catalog_fingerprint, livemode
        )
      )`);
      await seed.execute(`CREATE TABLE ai_billing_usage_v2 (
        id TEXT PRIMARY KEY,
        teacher_email TEXT NOT NULL COLLATE NOCASE,
        billing_month TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        price_book_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        submission_id TEXT NOT NULL,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT NOT NULL,
        catalog_fingerprint TEXT NOT NULL,
        livemode INTEGER NOT NULL,
        free_credit_applied INTEGER NOT NULL DEFAULT 0,
        base_units INTEGER NOT NULL DEFAULT 1,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        base_attempted_at INTEGER,
        audio_attempted_at INTEGER,
        output_attempted_at INTEGER,
        base_reported_at INTEGER,
        audio_reported_at INTEGER,
        output_reported_at INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error_dimension TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        last_failed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(
          teacher_email, cache_key, price_book_id, catalog_fingerprint, livemode
        )
      )`);
      await seed.execute({
        sql: `INSERT INTO ai_billing_credit_periods_v2 (
          teacher_email, billing_month, price_book_id, catalog_fingerprint,
          livemode, qualifying_class_high_water, used_credits, created_at, updated_at
        ) VALUES (?, '2026-08', ?, ?, 0, 2, 1, 1, 1)`,
        args: [
          "legacy-v2-upgrade@example.com",
          TEACHER_AI_PRICE_BOOK.id,
          STRIPE_CATALOG_MANIFEST.fingerprint,
        ],
      });
      await seed.execute({
        sql: `INSERT INTO ai_billing_usage_v2 (
          id, teacher_email, billing_month, cache_key, price_book_id,
          attempt_id, submission_id, stripe_customer_id, stripe_subscription_id,
          catalog_fingerprint, livemode, free_credit_applied, base_units,
          duration_seconds, output_tokens, status, last_error, created_at, updated_at
        ) VALUES (
          'legacy_v2_usage', ?, '2026-08', 'legacy-v2-cache', ?,
          'legacy-v2-attempt', 'legacy-v2-submission', 'cus_legacy_v2', 'sub_legacy_v2',
          ?, 0, 0, 1, 65, 4, 'pending', '', 1, 1
        )`,
        args: [
          "legacy-v2-upgrade@example.com",
          TEACHER_AI_PRICE_BOOK.id,
          STRIPE_CATALOG_MANIFEST.fingerprint,
        ],
      });
    } finally {
      seed.close();
    }

    process.env.HABLA_LOCAL_DB_PATH = upgradeDbPath;
    try {
      const upgradeDb = await loadDbModule();
      await expect(upgradeDb.getStripeBillingStorageHealth()).resolves.toMatchObject({
        ready: false,
        legacyV2CreditPeriods: 1,
        legacyV2UsageRows: 1,
      });

      const verify = createClient({ url: `file:${upgradeDbPath}` });
      try {
        const v2Rows = await verify.execute(
          "SELECT id, cache_key as cacheKey FROM ai_billing_usage_v2",
        );
        expect(v2Rows.rows).toEqual([
          expect.objectContaining({ id: "legacy_v2_usage", cacheKey: "legacy-v2-cache" }),
        ]);

        async function semanticUniqueColumns(table: string) {
          const indexes = await verify.execute(`PRAGMA index_list(${table})`);
          const uniqueColumnSets = [];
          for (const index of indexes.rows.filter((row) => Number(row.unique) === 1)) {
            const details = await verify.execute(
              `PRAGMA index_info(${String(index.name)})`,
            );
            uniqueColumnSets.push(details.rows.map((row) => String(row.name)));
          }
          return uniqueColumnSets;
        }

        const semanticColumns = [
          "teacher_email",
          "cache_key",
          "price_book_id",
          "catalog_fingerprint",
          "livemode",
        ];
        await expect(semanticUniqueColumns("ai_billing_usage_v2")).resolves.toContainEqual(
          semanticColumns,
        );
        await expect(semanticUniqueColumns("ai_billing_usage_v3")).resolves.toContainEqual(
          semanticColumns,
        );

        await expect(
          verify.execute(`INSERT INTO ai_billing_usage_v2 (
            id, teacher_email, billing_month, cache_key, price_book_id,
            attempt_id, submission_id, stripe_customer_id, stripe_subscription_id,
            catalog_fingerprint, livemode, free_credit_applied, base_units,
            duration_seconds, output_tokens, status, last_error, created_at, updated_at
          ) SELECT
            'legacy_v2_usage_duplicate', teacher_email, billing_month, cache_key,
            price_book_id, 'other-attempt', 'other-submission', stripe_customer_id,
            stripe_subscription_id, catalog_fingerprint, livemode, free_credit_applied,
            base_units, duration_seconds, output_tokens, status, last_error, created_at, updated_at
          FROM ai_billing_usage_v2 WHERE id = 'legacy_v2_usage'`),
        ).rejects.toThrow();

        const insertV3Sql = `INSERT INTO ai_billing_usage_v3 (
          id, teacher_email, billing_month, cache_key, price_book_id,
          attempt_id, submission_id, stripe_customer_id, stripe_subscription_id,
          catalog_fingerprint, billing_contract_id, livemode, free_credit_applied,
          base_units, duration_seconds, output_tokens, status, last_error,
          created_at, updated_at
        ) VALUES (?, 'v3-upgrade@example.com', '2026-08', 'v3-upgrade-cache', ?,
          ?, ?, 'cus_v3_upgrade', 'sub_v3_upgrade', ?, ?, 0, 0, 1, 65, 4,
          'pending', '', 1, 1)`;
        await verify.execute({
          sql: insertV3Sql,
          args: [
            "v3_upgrade_usage",
            TEACHER_AI_PRICE_BOOK.id,
            "v3-upgrade-attempt",
            "v3-upgrade-submission",
            STRIPE_CATALOG_MANIFEST.fingerprint,
            TEST_BILLING_CONTRACT_ID,
          ],
        });
        await expect(
          verify.execute({
            sql: insertV3Sql,
            args: [
              "v3_upgrade_usage_duplicate",
              TEACHER_AI_PRICE_BOOK.id,
              "v3-upgrade-attempt-duplicate",
              "v3-upgrade-submission-duplicate",
              STRIPE_CATALOG_MANIFEST.fingerprint,
              "contract_changed_but_same_semantic_result",
            ],
          }),
        ).rejects.toThrow();
      } finally {
        verify.close();
      }
    } finally {
      if (previousDbPath === undefined) delete process.env.HABLA_LOCAL_DB_PATH;
      else process.env.HABLA_LOCAL_DB_PATH = previousDbPath;
      vi.resetModules();
      try {
        fs.rmSync(upgradeDbPath, { force: true });
      } catch (error) {
        // The module-scoped libSQL client keeps its Windows file handle until
        // the Vitest worker exits; the fixture is isolated in the OS temp dir.
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      }
    }
  });

  it("resumes the delivery-status backfill exactly once after a partial schema upgrade", async () => {
    const upgradeDbPath = path.join(
      os.tmpdir(),
      `speaklab-delivery-upgrade-${process.pid}-${Date.now()}.db`,
    );
    const previousDbPath = process.env.HABLA_LOCAL_DB_PATH;
    fs.rmSync(upgradeDbPath, { force: true });
    process.env.HABLA_LOCAL_DB_PATH = upgradeDbPath;
    try {
      const initialDb = withTestStripeScope(await loadDbModule());
      const fixture = await createCompletedGradingFixture(
        initialDb,
        "delivery-upgrade@example.com",
        "delivery-upgrade-pending",
      );
      const verify = createClient({ url: `file:${upgradeDbPath}` });
      try {
        const readDeliveryStatus = async () => {
          const result = await verify.execute({
            sql: "SELECT delivery_status FROM ai_grading_attempts WHERE id = ?",
            args: [fixture.attempt.id],
          });
          return String(result.rows[0]?.delivery_status ?? "");
        };

        await expect(readDeliveryStatus()).resolves.toBe("pending");

        // A normal cold start must not re-run the completed migration against
        // an in-flight attempt created after the migration marker.
        const normalRestart = await loadDbModule();
        await normalRestart.findSubmissionById(
          fixture.submission.id,
          "delivery-upgrade@example.com",
        );
        await expect(readDeliveryStatus()).resolves.toBe("pending");

        // Simulate ALTER succeeding while the transactional backfill/marker
        // never committed. The next cold start must finish it.
        await verify.execute({
          sql: "DELETE FROM schema_migrations WHERE name = ?",
          args: ["2026-08-25-ai-attempt-delivery-status-v1"],
        });
        const resumed = await loadDbModule();
        await resumed.findSubmissionById(
          fixture.submission.id,
          "delivery-upgrade@example.com",
        );
        await expect(readDeliveryStatus()).resolves.toBe("withheld");
      } finally {
        verify.close();
      }
    } finally {
      if (previousDbPath === undefined) delete process.env.HABLA_LOCAL_DB_PATH;
      else process.env.HABLA_LOCAL_DB_PATH = previousDbPath;
      vi.resetModules();
      try {
        fs.rmSync(upgradeDbPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      }
    }
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import { STRIPE_API_VERSION } from "@/lib/billing/config";
import { getStripeBillingContractId } from "@/lib/billing/contract";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

const billingRuntimeMocks = vi.hoisted(() => ({
  subscriptionReady: vi.fn(async () => true),
}));

vi.mock("@/lib/billing/catalog-validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/catalog-validation")>()),
  isStripeSubscriptionRuntimeReady: billingRuntimeMocks.subscriptionReady,
}));

const localDbPath = path.join(os.tmpdir(), "speaklab-stripe-persistence-test.db");
const stripeEnvKeys = [
  "STRIPE_SUBSCRIPTION_BILLING_ENABLED",
  "STRIPE_CHECKOUT_ENABLED",
  "STRIPE_USAGE_BILLING_ENABLED",
  "STRIPE_BILLING_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_ACCOUNT_ID",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_TRYHABLA_TEACHER_PRICE_ID",
  "STRIPE_AUTOMATIC_TAX_ENABLED",
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
    teacher: "price_teacher",
  },
  automaticTaxEnabled: false,
});
const testStripeScope = {
  stripeAccountId: TEST_STRIPE_ACCOUNT_ID,
  billingContractId: TEST_BILLING_CONTRACT_ID,
} as const;
const RETIRED_V2_PRICE_BOOK_ID = "habla-teacher-ai-usd-v2";
const RETIRED_V2_CATALOG_FINGERPRINT = "retired-v2-catalog-fingerprint";

async function loadDbModule() {
  vi.resetModules();
  return import("@/lib/db");
}

type DbModule = Awaited<ReturnType<typeof loadDbModule>>;

type TestScopedInput<
  Input extends { stripeAccountId: string; billingContractId: string },
> = Omit<Input, "stripeAccountId" | "billingContractId"> &
  Partial<Pick<Input, "stripeAccountId" | "billingContractId">>;

type TestEntitledInput = Omit<
  TestScopedInput<Parameters<DbModule["projectCurrentStripeEntitledSubscription"]>[0]>,
  "subscriptionPeriodStart" | "subscriptionPeriodEnd"
> &
  Partial<
    Pick<
      Parameters<DbModule["projectCurrentStripeEntitledSubscription"]>[0],
      "subscriptionPeriodStart" | "subscriptionPeriodEnd"
    >
  >;

type TestReplacementInput = Omit<
  TestScopedInput<Parameters<DbModule["replaceTerminalStripeSubscriptionFromCheckout"]>[0]>,
  "subscriptionPeriodStart" | "subscriptionPeriodEnd"
> &
  Partial<
    Pick<
      Parameters<DbModule["replaceTerminalStripeSubscriptionFromCheckout"]>[0],
      "subscriptionPeriodStart" | "subscriptionPeriodEnd"
    >
  >;

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
    input: TestEntitledInput,
  ): ReturnType<DbModule["projectCurrentStripeEntitledSubscription"]>;
  replaceTerminalStripeSubscriptionFromCheckout(
    input: TestReplacementInput,
  ): ReturnType<DbModule["replaceTerminalStripeSubscriptionFromCheckout"]>;
};

function withTestStripeScope(rawDb: DbModule): TestDbModule {
  const periodDefaults = {
    subscriptionPeriodStart: Date.now() - 86_400_000,
    subscriptionPeriodEnd: Date.now() + 31 * 86_400_000,
  } as const;
  return {
    ...rawDb,
    upsertStripeBillingCustomer: (input) =>
      rawDb.upsertStripeBillingCustomer({ ...testStripeScope, ...input }),
    upsertStripeBillingSubscription: (input) =>
      rawDb.upsertStripeBillingSubscription({
        ...(input.subscriptionStatus.trim().toLowerCase() === "active"
          ? periodDefaults
          : {}),
        ...testStripeScope,
        ...input,
      }),
    projectCurrentStripeNonEntitledSubscription: (input) =>
      rawDb.projectCurrentStripeNonEntitledSubscription({ ...testStripeScope, ...input }),
    projectCurrentStripeEntitledSubscription: (input) =>
      rawDb.projectCurrentStripeEntitledSubscription({
        ...periodDefaults,
        ...testStripeScope,
        ...input,
      }),
    replaceTerminalStripeSubscriptionFromCheckout: (input) =>
      rawDb.replaceTerminalStripeSubscriptionFromCheckout({
        ...periodDefaults,
        ...testStripeScope,
        ...input,
      }),
  };
}

async function createCompletedGradingFixture(
  db: TestDbModule,
  teacherEmail: string,
  label: string,
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
    assignmentFingerprint: processedAssignmentFingerprint(
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
    ),
    promptVersion: "prompt-v1",
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

describe("Stripe and AI billing persistence", () => {
  let db: TestDbModule;

  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    process.env.STRIPE_SUBSCRIPTION_BILLING_ENABLED = "true";
    delete process.env.STRIPE_CHECKOUT_ENABLED;
    delete process.env.STRIPE_USAGE_BILLING_ENABLED;
    delete process.env.STRIPE_BILLING_ENABLED;
    process.env.STRIPE_SECRET_KEY = "sk_test_persistence";
    process.env.STRIPE_ACCOUNT_ID = TEST_STRIPE_ACCOUNT_ID;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_persistence";
    process.env.STRIPE_TRYHABLA_TEACHER_PRICE_ID = "price_teacher";
    process.env.STRIPE_AUTOMATIC_TAX_ENABLED = "false";
    delete process.env.STRIPE_AI_GRADE_PRICE_ID;
    delete process.env.STRIPE_AI_AUDIO_SECONDS_PRICE_ID;
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
    billingRuntimeMocks.subscriptionReady.mockReset();
    billingRuntimeMocks.subscriptionReady.mockResolvedValue(true);
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

    billingRuntimeMocks.subscriptionReady.mockResolvedValue(false);
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

  it("converges concurrent identical Subscription and Checkout projections", async () => {
    const stripeCustomerId = "cus_identical_projection_race";
    const stripeSubscriptionId = "sub_identical_projection_race";
    await db.upsertStripeBillingCustomer({
      teacherEmail: "identical-projection-race@example.com",
      stripeCustomerId,
      now: 4_500,
    });
    const snapshot = await db.getStripeBillingAccountByCustomerId(stripeCustomerId);
    if (!snapshot) throw new Error("Projection race account fixture was not persisted.");

    // Stripe can deliver customer.subscription.created and
    // checkout.session.completed together. Both handlers can validate remote
    // current state before either local projection commits.
    const projections = await Promise.all([
      db.projectCurrentStripeEntitledSubscription({
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: "active",
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        observedEventCreated: 500,
        expectedAccount: snapshot,
        now: 4_600,
      }),
      db.projectCurrentStripeEntitledSubscription({
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: "active",
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        observedEventCreated: 501,
        expectedAccount: snapshot,
        now: 4_601,
      }),
    ]);

    expect(projections).toHaveLength(2);
    expect(projections.every(Boolean)).toBe(true);
    await expect(db.getStripeBillingAccountByCustomerId(stripeCustomerId)).resolves.toMatchObject({
      stripeSubscriptionId,
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 501,
    });

    const afterConcurrentProjection = await db.getStripeBillingAccountByCustomerId(
      stripeCustomerId,
    );
    if (!afterConcurrentProjection) {
      throw new Error("Converged projection fixture was not persisted.");
    }
    const staleSameState = await db.projectCurrentStripeEntitledSubscription({
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      observedEventCreated: 499,
      expectedAccount: snapshot,
      now: 4_700,
    });
    expect(staleSameState).toMatchObject({
      stripeEventCreated: 501,
      projectionRevision: afterConcurrentProjection.projectionRevision,
    });
  });

  it("does not converge an active projection over a newer revocation or another scope", async () => {
    const stripeCustomerId = "cus_divergent_projection_race";
    const stripeSubscriptionId = "sub_divergent_projection_race";
    await db.upsertStripeBillingCustomer({
      teacherEmail: "divergent-projection-race@example.com",
      stripeCustomerId,
      now: 4_800,
    });
    const emptySnapshot = await db.getStripeBillingAccountByCustomerId(stripeCustomerId);
    if (!emptySnapshot) throw new Error("Divergent race account fixture was not persisted.");
    const active = await db.projectCurrentStripeEntitledSubscription({
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "active",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      observedEventCreated: 600,
      expectedAccount: emptySnapshot,
      now: 4_900,
    });
    if (!active) throw new Error("Active race fixture was not persisted.");
    const revoked = await db.upsertStripeBillingSubscription({
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "canceled",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: "",
      stripeEventCreated: 700,
      expectedAccount: active,
      now: 5_000,
    });
    if (!revoked) throw new Error("Revoked race fixture was not persisted.");

    await expect(
      db.projectCurrentStripeEntitledSubscription({
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: "active",
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        observedEventCreated: 600,
        expectedAccount: active,
        now: 5_100,
      }),
    ).resolves.toBeNull();
    await expect(
      db.projectCurrentStripeEntitledSubscription({
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: "active",
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        billingContractId: "contract_other_scope",
        observedEventCreated: 800,
        expectedAccount: revoked,
        now: 5_200,
      }),
    ).resolves.toBeNull();
    await expect(db.getStripeBillingAccountByCustomerId(stripeCustomerId)).resolves.toMatchObject({
      subscriptionStatus: "canceled",
      catalogFingerprint: "",
      stripeEventCreated: 700,
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
      priceBookId: RETIRED_V2_PRICE_BOOK_ID,
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

  it("serializes the Free lifetime cap and persists released capacity", async () => {
    const teacherEmail = "free-allowance-cap@example.com";
    const now = Date.now();
    await db.setUserRoleTeacher(teacherEmail);

    const results = await Promise.all(
      Array.from({ length: 31 }, (_, index) =>
        db.reserveAiReviewAllowance({
          teacherEmail,
          semanticKey: "free-cap-" + index,
          now,
        }),
      ),
    );
    const reserved = results.filter((result) => result.reservationStatus === "reserved");
    const exhausted = results.filter((result) => result.reservationStatus === "exhausted");
    expect(reserved).toHaveLength(30);
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]).toMatchObject({
      status: "free_lifetime",
      limit: 30,
      reserved: 30,
      consumed: 0,
      used: 30,
      remaining: 0,
    });
    await expect(
      db.getAiReviewAllowanceSummary({ teacherEmail, now }),
    ).resolves.toMatchObject({
      status: "free_lifetime",
      limit: 30,
      reserved: 30,
      consumed: 0,
      used: 30,
      remaining: 0,
    });

    const released = reserved[0];
    if (released?.reservationStatus !== "reserved") {
      throw new Error("Free allowance fixture did not retain a reservation.");
    }
    await expect(
      db.releaseAiReviewAllowanceReservation({
        reservationId: released.reservationId,
        teacherEmail,
        now: now + 1,
      }),
    ).resolves.toBe(true);
    await expect(
      db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "free-cap-replacement",
        now: now + 2,
      }),
    ).resolves.toMatchObject({
      reservationStatus: "reserved",
      status: "free_lifetime",
      used: 30,
      remaining: 0,
    });
  });

  it("atomically consumes a delivered review and reuses its semantic result", async () => {
    const teacherEmail = "allowance-delivery@example.com";
    const semanticKey = "allowance-delivery-result";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "allowance-delivery",
      { cacheKey: semanticKey },
    );
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("AI review fixture did not reserve capacity.");
    }

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: "other-owner@example.com",
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        billingCandidate: false,
        allowUnmeteredAccess: false,
        reviewReservationId: reservation.reservationId,
      }),
    ).resolves.toEqual({
      status: "not_applied",
      billingRequired: false,
      reason: "attempt_ineligible",
    });
    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        billingCandidate: false,
        allowUnmeteredAccess: false,
        reviewReservationId: reservation.reservationId,
      }),
    ).resolves.toEqual({ status: "applied", billingRequired: false });

    await expect(
      db.findSubmissionById(fixture.submission.id, teacherEmail),
    ).resolves.toMatchObject({
      grade: fixture.attempt.suggestedScore,
      feedback: fixture.attempt.feedback,
    });
    await expect(
      db.listAiGradingAttemptsForSubmission(fixture.submission.id, teacherEmail),
    ).resolves.toEqual([
      expect.objectContaining({
        id: fixture.attempt.id,
        deliveryStatus: "delivered",
        billingRequired: false,
        billingPriceBookId: "",
        billingStripeCustomerId: "",
        billingStripeSubscriptionId: "",
      }),
    ]);
    await expect(
      db.getAiReviewAllowanceSummary({ teacherEmail }),
    ).resolves.toMatchObject({
      status: "free_lifetime",
      reserved: 0,
      consumed: 1,
      used: 1,
      remaining: 29,
    });
    await expect(
      db.reserveAiReviewAllowance({ teacherEmail, semanticKey }),
    ).resolves.toMatchObject({
      reservationStatus: "duplicate",
      sourceAttemptId: fixture.attempt.id,
      used: 1,
      remaining: 29,
    });
  });

  it("preserves a teacher edit when finalization loses its submission CAS", async () => {
    const teacherEmail = "allowance-teacher-edit@example.com";
    const semanticKey = "allowance-teacher-edit-result";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "allowance-teacher-edit",
      { cacheKey: semanticKey },
    );
    const reservation = await db.reserveAiReviewAllowance({ teacherEmail, semanticKey });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("AI review fixture did not reserve capacity.");
    }
    await db.updateSubmission(fixture.submission.id, teacherEmail, {
      studentName: fixture.submission.studentName,
      grade: 6,
      feedback: "Teacher decision wins.",
      rubricScores: null,
    });

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        billingCandidate: false,
        allowUnmeteredAccess: false,
        reviewReservationId: reservation.reservationId,
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
      feedback: "Teacher decision wins.",
    });
    await expect(
      db.getAiReviewAllowanceSummary({ teacherEmail }),
    ).resolves.toMatchObject({ reserved: 1, consumed: 0, used: 1 });
    await expect(
      db.releaseAiReviewAllowanceReservation({
        reservationId: reservation.reservationId,
        teacherEmail,
      }),
    ).resolves.toBe(true);
    await expect(
      db.getAiReviewAllowanceSummary({ teacherEmail }),
    ).resolves.toMatchObject({ reserved: 0, consumed: 0, used: 0, remaining: 30 });
  });

  it("rolls the grade back when a reserved Stripe allowance changes scope", async () => {
    const teacherEmail = "allowance-scope-race@example.com";
    const semanticKey = "allowance-scope-race-result";
    const now = Date.now();
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "allowance-scope-race",
      { cacheKey: semanticKey },
    );
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_allowance_scope_race",
      now,
    });
    const active = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_allowance_scope_race",
      stripeSubscriptionId: "sub_allowance_scope_race",
      subscriptionStatus: "active",
      subscriptionPeriodStart: now - 1_000,
      subscriptionPeriodEnd: now + 60_000,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 1,
      now,
    });
    if (!active) throw new Error("Active allowance fixture was not persisted.");
    const reservation = await db.reserveAiReviewAllowance({
      teacherEmail,
      semanticKey,
      now: now + 1,
    });
    if (reservation.reservationStatus !== "reserved") {
      throw new Error("Teacher allowance fixture did not reserve capacity.");
    }
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_allowance_scope_race",
      stripeSubscriptionId: "sub_allowance_scope_race",
      subscriptionStatus: "canceled",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: "",
      stripeEventCreated: 2,
      expectedAccount: active,
      now: now + 2,
    });

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        billingCandidate: false,
        allowUnmeteredAccess: false,
        reviewReservationId: reservation.reservationId,
      }),
    ).rejects.toThrow("AI review allowance changed before result delivery");
    await expect(
      db.findSubmissionById(fixture.submission.id, teacherEmail),
    ).resolves.toMatchObject({ grade: null, feedback: "" });

    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const rows = await raw.execute({
        sql: `SELECT status, attempt_id as attemptId
          FROM ai_review_allowance_reservations_v1
          WHERE id = ?`,
        args: [reservation.reservationId],
      });
      expect(rows.rows).toEqual([
        expect.objectContaining({ status: "reserved", attemptId: "" }),
      ]);
    } finally {
      raw.close();
    }
  });

  it("starts each verified Teacher period empty while preserving the prior period archive", async () => {
    const teacherEmail = "teacher-period-archive@example.com";
    const firstSemanticKey = "teacher-period-one-result";
    const now = Date.now();
    const firstPeriodStart = now - 1_000;
    const firstPeriodEnd = now + 60_000;
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "teacher-period-archive",
      { cacheKey: firstSemanticKey },
    );
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_teacher_period_archive",
      now,
    });
    const firstPeriod = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_period_archive",
      stripeSubscriptionId: "sub_teacher_period_archive",
      subscriptionStatus: "active",
      subscriptionPeriodStart: firstPeriodStart,
      subscriptionPeriodEnd: firstPeriodEnd,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 10,
      now,
    });
    if (!firstPeriod) throw new Error("First Teacher period was not persisted.");
    const firstReservation = await db.reserveAiReviewAllowance({
      teacherEmail,
      semanticKey: firstSemanticKey,
      now: now + 1,
    });
    if (firstReservation.reservationStatus !== "reserved") {
      throw new Error("First Teacher period did not reserve capacity.");
    }
    expect(firstReservation).toMatchObject({
      status: "teacher_period",
      limit: 300,
      used: 1,
      remaining: 299,
      periodStart: firstPeriodStart,
      periodEnd: firstPeriodEnd,
    });
    await db.finalizeAiGradeDelivery({
      attemptId: fixture.attempt.id,
      ownerEmail: teacherEmail,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      billingCandidate: false,
      allowUnmeteredAccess: false,
      reviewReservationId: firstReservation.reservationId,
    });

    const secondPeriodStart = firstPeriodEnd;
    const secondPeriodEnd = secondPeriodStart + 60_000;
    const secondPeriod = await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_teacher_period_archive",
      stripeSubscriptionId: "sub_teacher_period_archive",
      subscriptionStatus: "active",
      subscriptionPeriodStart: secondPeriodStart,
      subscriptionPeriodEnd: secondPeriodEnd,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 11,
      expectedAccount: firstPeriod,
      now: now + 2,
    });
    if (!secondPeriod) throw new Error("Second Teacher period was not persisted.");
    await expect(
      db.getAiReviewAllowanceSummary({
        teacherEmail,
        now: secondPeriodStart + 1,
      }),
    ).resolves.toMatchObject({
      status: "teacher_period",
      limit: 300,
      reserved: 0,
      consumed: 0,
      used: 0,
      remaining: 300,
      periodStart: secondPeriodStart,
      periodEnd: secondPeriodEnd,
    });
    await expect(
      db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "teacher-period-two-result",
        now: secondPeriodStart + 2,
      }),
    ).resolves.toMatchObject({
      reservationStatus: "reserved",
      status: "teacher_period",
      used: 1,
      remaining: 299,
    });

    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const rows = await raw.execute({
        sql: `SELECT scope_key as scopeKey, status
          FROM ai_review_allowance_reservations_v1
          WHERE teacher_email = ?
          ORDER BY created_at ASC, id ASC`,
        args: [teacherEmail],
      });
      expect(rows.rows).toEqual([
        expect.objectContaining({
          scopeKey:
            "teacher_period:sub_teacher_period_archive:" +
            firstPeriodStart +
            ":" +
            firstPeriodEnd,
          status: "consumed",
        }),
        expect.objectContaining({
          scopeKey:
            "teacher_period:sub_teacher_period_archive:" +
            secondPeriodStart +
            ":" +
            secondPeriodEnd,
          status: "reserved",
        }),
      ]);
    } finally {
      raw.close();
    }
  });

  it("fails closed instead of falling back from a stale nonterminal Stripe mapping", async () => {
    const teacherEmail = "stale-subscription-allowance@example.com";
    const now = Date.now();
    await db.setUserRoleTeacher(teacherEmail);
    await db.setUserPaid(teacherEmail, true);
    await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_stale_subscription_allowance",
      now,
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: "cus_stale_subscription_allowance",
      stripeSubscriptionId: "sub_stale_subscription_allowance",
      subscriptionStatus: "active",
      subscriptionPeriodStart: now - 60_000,
      subscriptionPeriodEnd: now - 1,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeEventCreated: 1,
      now,
    });

    await expect(
      db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "must-not-fall-back-to-manual-or-free",
        now,
      }),
    ).resolves.toMatchObject({
      reservationStatus: "subscription_unavailable",
      status: "subscription_unavailable",
      limit: 0,
      reserved: 0,
      consumed: 0,
      used: 0,
      remaining: 0,
    });
    await expect(
      db.getAiReviewAllowanceSummary({ teacherEmail, now }),
    ).resolves.toMatchObject({
      status: "subscription_unavailable",
      limit: 0,
      used: 0,
      remaining: 0,
    });

    billingRuntimeMocks.subscriptionReady.mockResolvedValue(false);
    await expect(db.getStripeSubscriptionGrantsAiAccess(teacherEmail)).resolves.toBe(false);
    await expect(
      db.reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: "runtime-must-not-fall-back",
        now,
      }),
    ).resolves.toMatchObject({
      reservationStatus: "subscription_unavailable",
      status: "subscription_unavailable",
      limit: 0,
    });
  });

  it("keeps retired metering archive-only for an active Teacher subscription", async () => {
    const teacherEmail = "retired-metering-archive@example.com";
    await db.setUserRoleTeacher(teacherEmail);
    const fixture = await createCompletedGradingFixture(
      db,
      teacherEmail,
      "retired-metering-archive",
    );
    await grantStripeBilling(db, teacherEmail, TEACHER_AI_PRICE_BOOK.id);
    await db.applyAiGradeToSubmission(fixture.submission.id, teacherEmail, {
      grade: fixture.attempt.suggestedScore!,
      feedback: fixture.attempt.feedback,
      rubricScores: null,
    });

    await expect(
      db.markAiGradingAttemptBillingRequired({
        attemptId: fixture.attempt.id,
        ownerEmail: teacherEmail,
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
      }),
    ).resolves.toBe(false);
    await expect(
      db.createAiBillingUsage({
        teacherEmail,
        cacheKey: fixture.cacheKey,
        priceBookId: TEACHER_AI_PRICE_BOOK.id,
        attemptId: fixture.attempt.id,
        submissionId: fixture.submission.id,
        durationSeconds: fixture.attempt.durationSeconds,
        outputTokens: fixture.attempt.billableOutputTokens,
        livemode: false,
      }),
    ).resolves.toBeNull();
    await expect(
      db.listUnqueuedAiBillingAttempts(TEACHER_AI_PRICE_BOOK.id),
    ).resolves.toEqual([]);

    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const marker = await raw.execute({
        sql: `SELECT billing_required as billingRequired,
          billing_price_book_id as billingPriceBookId
          FROM ai_grading_attempts WHERE id = ?`,
        args: [fixture.attempt.id],
      });
      expect(marker.rows).toEqual([
        expect.objectContaining({ billingRequired: 0, billingPriceBookId: "" }),
      ]);
      const usage = await raw.execute({
        sql: `SELECT COUNT(*) as count FROM ai_billing_usage_v3
          WHERE teacher_email = ?`,
        args: [teacherEmail],
      });
      expect(Number(usage.rows[0]?.count ?? -1)).toBe(0);
    } finally {
      raw.close();
    }
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
          RETIRED_V2_PRICE_BOOK_ID,
          RETIRED_V2_CATALOG_FINGERPRINT,
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
          RETIRED_V2_PRICE_BOOK_ID,
          RETIRED_V2_CATALOG_FINGERPRINT,
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
          `SELECT id, cache_key as cacheKey, price_book_id as priceBookId,
            catalog_fingerprint as catalogFingerprint
          FROM ai_billing_usage_v2`,
        );
        expect(v2Rows.rows).toEqual([
          expect.objectContaining({
            id: "legacy_v2_usage",
            cacheKey: "legacy-v2-cache",
            priceBookId: RETIRED_V2_PRICE_BOOK_ID,
            catalogFingerprint: RETIRED_V2_CATALOG_FINGERPRINT,
          }),
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
            RETIRED_V2_PRICE_BOOK_ID,
            "v3-upgrade-attempt",
            "v3-upgrade-submission",
            RETIRED_V2_CATALOG_FINGERPRINT,
            TEST_BILLING_CONTRACT_ID,
          ],
        });
        await expect(
          verify.execute({
            sql: insertV3Sql,
            args: [
              "v3_upgrade_usage_duplicate",
              RETIRED_V2_PRICE_BOOK_ID,
              "v3-upgrade-attempt-duplicate",
              "v3-upgrade-submission-duplicate",
              RETIRED_V2_CATALOG_FINGERPRINT,
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type InStatement } from "@libsql/client";
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

const envKeys = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "HABLA_LOCAL_DB_PATH",
  "STRIPE_SUBSCRIPTION_BILLING_ENABLED",
  "STRIPE_BILLING_ENABLED",
  "STRIPE_USAGE_BILLING_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_ACCOUNT_ID",
  "STRIPE_TRYHABLA_TEACHER_PRICE_ID",
  "STRIPE_AUTOMATIC_TAX_ENABLED",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const localDbPath = path.join(
  os.tmpdir(),
  `tryhabla-ai-review-lifetime-bonus-${randomUUID()}.db`,
);
const accountId = "acct_ai_review_lifetime_bonus_test";
const teacherPriceId = "price_ai_review_lifetime_bonus_test";
const billingContractId = getStripeBillingContractId({
  apiVersion: STRIPE_API_VERSION,
  accountId,
  keyMode: "test",
  priceIds: { teacher: teacherPriceId },
  automaticTaxEnabled: false,
});

let db: typeof import("@/lib/db");

async function rawBatch(statements: InStatement[]) {
  const raw = createClient({ url: `file:${localDbPath}` });
  try {
    return await raw.batch(statements, "write");
  } finally {
    raw.close();
  }
}

function consumedReservations(input: {
  teacherEmail: string;
  prefix: string;
  count: number;
  consumedAt: number;
}): InStatement[] {
  return Array.from({ length: input.count }, (_, index) => ({
    sql: `INSERT INTO ai_review_allowance_reservations_v1 (
      id, teacher_email, semantic_key, allowance_kind, scope_key,
      stripe_subscription_id, period_start, period_end, status, attempt_id,
      source_kind, created_at, updated_at, consumed_at, released_at
    ) VALUES (?, ?, ?, 'free_lifetime', 'free_lifetime', '', 0, 0,
      'consumed', ?, 'grading', ?, ?, ?, NULL)`,
    args: [
      `${input.prefix}-reservation-${index}`,
      input.teacherEmail,
      `${input.prefix}-semantic-${index}`,
      `${input.prefix}-attempt-${index}`,
      input.consumedAt,
      input.consumedAt,
      input.consumedAt,
    ],
  }));
}

function reservedReservations(input: {
  teacherEmail: string;
  prefix: string;
  count: number;
  createdAt: number;
}): InStatement[] {
  return Array.from({ length: input.count }, (_, index) => ({
    sql: `INSERT INTO ai_review_allowance_reservations_v1 (
      id, teacher_email, semantic_key, allowance_kind, scope_key,
      stripe_subscription_id, period_start, period_end, status, attempt_id,
      source_kind, created_at, updated_at, consumed_at, released_at
    ) VALUES (?, ?, ?, 'free_lifetime', 'free_lifetime', '', 0, 0,
      'reserved', ?, 'grading', ?, ?, NULL, NULL)`,
    args: [
      `${input.prefix}-reservation-${index}`,
      input.teacherEmail,
      `${input.prefix}-semantic-${index}`,
      `${input.prefix}-attempt-${index}`,
      input.createdAt,
      input.createdAt,
    ],
  }));
}

beforeAll(async () => {
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.STRIPE_BILLING_ENABLED;
  delete process.env.STRIPE_USAGE_BILLING_ENABLED;
  process.env.HABLA_LOCAL_DB_PATH = localDbPath;
  process.env.STRIPE_SUBSCRIPTION_BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_lifetime_bonus";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_lifetime_bonus";
  process.env.STRIPE_ACCOUNT_ID = accountId;
  process.env.STRIPE_TRYHABLA_TEACHER_PRICE_ID = teacherPriceId;
  process.env.STRIPE_AUTOMATIC_TAX_ENABLED = "false";
  fs.rmSync(localDbPath, { force: true });
  vi.resetModules();
  db = await import("@/lib/db");
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("AI review lifetime bonus grants", () => {
  it("grants before registration and retries idempotently across email casing", async () => {
    const first = await db.grantAiReviewLifetimeBonus({
      teacherEmail: "  PreRegister@Example.COM ",
      grantKey: "school-login-apology-2026-08-26",
      units: 30,
      reason: "School Google sign-in inconvenience",
      grantedBy: "support@example.com",
      now: 1_000,
    });
    expect(first).toEqual({
      teacherEmail: "preregister@example.com",
      grantKey: "school-login-apology-2026-08-26",
      units: 30,
      reason: "School Google sign-in inconvenience",
      grantedBy: "support@example.com",
      createdAt: 1_000,
      created: true,
      totalBonusUnits: 30,
    });

    const retry = await db.grantAiReviewLifetimeBonus({
      teacherEmail: "PREREGISTER@example.com",
      grantKey: "school-login-apology-2026-08-26",
      units: 30,
      reason: "School Google sign-in inconvenience",
      grantedBy: "support@example.com",
      now: 9_999,
    });
    expect(retry).toMatchObject({
      teacherEmail: "preregister@example.com",
      createdAt: 1_000,
      created: false,
      totalBonusUnits: 30,
    });

    const raw = createClient({ url: `file:${localDbPath}` });
    try {
      const users = await raw.execute({
        sql: "SELECT COUNT(*) as count FROM users WHERE LOWER(email) = LOWER(?)",
        args: ["preregister@example.com"],
      });
      const foreignKeys = await raw.execute(
        "PRAGMA foreign_key_list(ai_review_lifetime_bonus_grants_v1)",
      );
      expect(Number(users.rows[0]?.count)).toBe(0);
      expect(foreignKeys.rows).toHaveLength(0);
    } finally {
      raw.close();
    }
    expect(
      await db.getAiReviewAllowanceSummary({ teacherEmail: "PreRegister@Example.com" }),
    ).toMatchObject({
      status: "free_lifetime",
      limit: 60,
      used: 0,
      remaining: 60,
    });
  });

  it("rejects grant-key reuse with a different payload", async () => {
    const common = {
      teacherEmail: "mismatch@example.com",
      grantKey: "courtesy-2026-08-26",
      units: 30,
      reason: "Courtesy",
      grantedBy: "support@example.com",
      now: 2_000,
    };
    await expect(db.grantAiReviewLifetimeBonus(common)).resolves.toMatchObject({
      created: true,
      totalBonusUnits: 30,
    });
    await expect(
      db.grantAiReviewLifetimeBonus({ ...common, units: 31 }),
    ).rejects.toThrow("grant key already exists with different payload");
    await expect(
      db.grantAiReviewLifetimeBonus({ ...common, reason: "Different reason" }),
    ).rejects.toThrow("grant key already exists with different payload");
    await expect(
      db.grantAiReviewLifetimeBonus({ ...common, grantedBy: "other@example.com" }),
    ).rejects.toThrow("grant key already exists with different payload");
    await expect(
      db.grantAiReviewLifetimeBonus({ ...common, grantKey: "invalid", units: 0 }),
    ).rejects.toThrow("units must be a positive safe integer");
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail: common.teacherEmail }))
      .toMatchObject({ limit: 60, remaining: 60 });
  });

  it("does not double-add concurrent retries", async () => {
    const input = {
      teacherEmail: "concurrent-bonus@example.com",
      grantKey: "concurrent-courtesy",
      units: 30,
      reason: "Courtesy",
      grantedBy: "support@example.com",
      now: 2_500,
    };
    const results = await Promise.all([
      db.grantAiReviewLifetimeBonus(input),
      db.grantAiReviewLifetimeBonus(input),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.every((result) => result.totalBonusUnits === 30)).toBe(true);
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail: input.teacherEmail }))
      .toMatchObject({ limit: 60, remaining: 60 });
  });

  it("adds exactly 30 after prior use and does not burn a released retry", async () => {
    const teacherEmail = "prior-use@example.com";
    await db.grantAiReviewLifetimeBonus({
      teacherEmail,
      grantKey: "prior-use-courtesy",
      units: 30,
      reason: "Courtesy",
      grantedBy: "support@example.com",
    });
    await rawBatch(consumedReservations({
      teacherEmail,
      prefix: "prior-use",
      count: 30,
      consumedAt: 3_000,
    }));
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail })).toMatchObject({
      status: "free_lifetime",
      limit: 60,
      consumed: 30,
      used: 30,
      remaining: 30,
    });

    const failedAttempt = await db.reserveAiReviewAllowance({
      teacherEmail,
      semanticKey: "retry-after-release",
    });
    if (failedAttempt.reservationStatus !== "reserved") {
      throw new Error("Expected the courtesy capacity to be reservable.");
    }
    await expect(db.releaseAiReviewAllowanceReservation({
      teacherEmail,
      reservationId: failedAttempt.reservationId,
    })).resolves.toBe(true);
    await expect(db.releaseAiReviewAllowanceReservation({
      teacherEmail,
      reservationId: failedAttempt.reservationId,
    })).resolves.toBe(false);
    expect(await db.reserveAiReviewAllowance({
      teacherEmail,
      semanticKey: "retry-after-release",
    })).toMatchObject({
      reservationStatus: "reserved",
      used: 31,
      remaining: 29,
    });

    await rawBatch(reservedReservations({
      teacherEmail,
      prefix: "courtesy-capacity",
      count: 28,
      createdAt: Date.now(),
    }));
    const boundary = await Promise.all([
      db.reserveAiReviewAllowance({ teacherEmail, semanticKey: "courtesy-final-a" }),
      db.reserveAiReviewAllowance({ teacherEmail, semanticKey: "courtesy-final-b" }),
    ]);
    expect(boundary.map((item) => item.reservationStatus).sort()).toEqual([
      "exhausted",
      "reserved",
    ]);
    expect(boundary.find((item) => item.reservationStatus === "exhausted")).toMatchObject({
      status: "free_lifetime",
      limit: 60,
      used: 60,
      remaining: 0,
    });
  });

  it("leaves manual and active Stripe allowance limits unchanged", async () => {
    const teacherEmail = "paid-precedence@example.com";
    const now = Date.now();
    await db.grantAiReviewLifetimeBonus({
      teacherEmail,
      grantKey: "paid-precedence-courtesy",
      units: 30,
      reason: "Courtesy",
      grantedBy: "support@example.com",
      now,
    });
    await db.setUserRoleTeacher(teacherEmail);
    await db.setUserPaid(teacherEmail, true);
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail, now })).toMatchObject({
      status: "manual_lifetime",
      limit: 300,
      remaining: 300,
    });
    await db.setUserPaid(teacherEmail, false);
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail, now })).toMatchObject({
      status: "free_lifetime",
      limit: 60,
      remaining: 60,
    });

    const account = await db.upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: "cus_bonus_precedence",
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      now,
    });
    await db.upsertStripeBillingSubscription({
      stripeCustomerId: account.stripeCustomerId,
      stripeSubscriptionId: "sub_bonus_precedence",
      subscriptionStatus: "active",
      subscriptionPeriodStart: now - 1_000,
      subscriptionPeriodEnd: now + 60_000,
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeAccountId: accountId,
      billingContractId,
      livemode: false,
      stripeEventCreated: 1,
      now,
    });
    expect(await db.getAiReviewAllowanceSummary({ teacherEmail, now })).toMatchObject({
      status: "teacher_period",
      limit: 300,
      remaining: 300,
    });
  });

  it("does not classify the base 30 as exhausted after a bonus", async () => {
    const teacherEmail = "aggregate-bonus@example.com";
    await db.grantAiReviewLifetimeBonus({
      teacherEmail,
      grantKey: "aggregate-courtesy",
      units: 30,
      reason: "Courtesy",
      grantedBy: "support@example.com",
      now: 1_000,
    });
    await rawBatch(consumedReservations({
      teacherEmail,
      prefix: "aggregate-first-half",
      count: 30,
      consumedAt: 2_000,
    }));
    await expect(db.getAdminAlertPeriodAggregate({
      startAt: 1_000,
      endAt: 10_000,
      snapshotAt: 9_000,
      environment: "test",
      livemode: false,
    })).resolves.toMatchObject({ eligibleFreeTeachers: 0 });

    await rawBatch(consumedReservations({
      teacherEmail,
      prefix: "aggregate-second-half",
      count: 30,
      consumedAt: 3_000,
    }));
    await expect(db.getAdminAlertPeriodAggregate({
      startAt: 1_000,
      endAt: 10_000,
      snapshotAt: 9_000,
      environment: "test",
      livemode: false,
    })).resolves.toMatchObject({ eligibleFreeTeachers: 1 });
  });
});

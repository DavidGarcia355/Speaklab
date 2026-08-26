import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import type { StripeBillingAccountRow } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  getConsumedFreeAiReviewCount: vi.fn(),
  getStripeBillingAccountByCustomerId: vi.fn(),
  getStripeBillingAccountByTeacherEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getConsumedFreeAiReviewCount: mocks.getConsumedFreeAiReviewCount,
  getStripeBillingAccountByCustomerId: mocks.getStripeBillingAccountByCustomerId,
  getStripeBillingAccountByTeacherEmail: mocks.getStripeBillingAccountByTeacherEmail,
}));

import { buildProcessedStripeAdminAlerts } from "@/lib/admin-alerts/stripe";

const scope = {
  livemode: false,
  stripeAccountId: "acct_tryhabla",
  billingContractId: "teacher-monthly-v1",
};

function account(
  overrides: Partial<StripeBillingAccountRow> = {},
): StripeBillingAccountRow {
  return {
    teacherEmail: "teacher@example.com",
    stripeCustomerId: "cus_teacher",
    stripeSubscriptionId: "sub_teacher",
    subscriptionStatus: "active",
    subscriptionPeriodStart: Date.UTC(2026, 7, 1),
    subscriptionPeriodEnd: Date.UTC(2026, 8, 1),
    priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
    catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    stripeAccountId: scope.stripeAccountId,
    billingContractId: scope.billingContractId,
    livemode: false,
    stripeEventCreated: 1_700_000_000,
    projectionRevision: 1,
    createdAt: Date.UTC(2026, 6, 1),
    updatedAt: Date.UTC(2026, 7, 1),
    ...overrides,
  };
}

function stripeEvent(
  type: Stripe.Event.Type,
  object: unknown,
  overrides: Partial<Stripe.Event> = {},
) {
  return {
    id: `evt_${type.replaceAll(".", "_")}`,
    object: "event",
    api_version: "2026-06-30.basil",
    created: 1_777_000_000,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    ...overrides,
  } as unknown as Stripe.Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DISCORD_ALERTS_REFERENCE_SECRET = "r".repeat(48);
  mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account());
  mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(account());
  mocks.getConsumedFreeAiReviewCount.mockResolvedValue(30);
});

describe("safe Stripe admin alert projection", () => {
  it("creates one anonymized paid-conversion event after local entitlement exists", async () => {
    const alerts = await buildProcessedStripeAdminAlerts(
      stripeEvent("checkout.session.completed", {
        customer: "cus_teacher",
        subscription: "sub_teacher",
        client_reference_id: "teacher@example.com",
        metadata: {
          habla_app: "tryhabla",
          teacher_email: "teacher@example.com",
        },
      }),
      scope,
    );

    expect(alerts).toEqual([{
      type: "subscription.started",
      teacherRef: expect.stringMatching(/^T-[A-F0-9]{12}$/),
      amountCents: 2_000,
      freeReviewsUsed: 30,
    }]);
    expect(JSON.stringify(alerts)).not.toContain("teacher@example.com");
    expect(JSON.stringify(alerts)).not.toContain("cus_teacher");
  });

  it("reports a fixed safe incident when Checkout maps to the wrong billing scope", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ livemode: true }),
    );

    const alerts = await buildProcessedStripeAdminAlerts(
      stripeEvent("checkout.session.completed", {
        customer: "cus_teacher",
        subscription: "sub_teacher",
        metadata: {
          habla_app: "tryhabla",
          teacher_email: "teacher@example.com",
        },
      }),
      scope,
    );

    expect(alerts).toEqual([{
      type: "incident",
      code: "stripe_checkout_scope_mismatch",
      summary: "A completed TryHabla Checkout does not match the active billing scope.",
    }]);
  });

  it("projects renewals and payment failures without raw Stripe identifiers", async () => {
    const parent = {
      type: "subscription_details",
      subscription_details: {
        subscription: "sub_teacher",
        metadata: { habla_app: "tryhabla" },
      },
    };
    const renewal = await buildProcessedStripeAdminAlerts(
      stripeEvent("invoice.paid", {
        parent,
        customer: "cus_teacher",
        billing_reason: "subscription_cycle",
        currency: "usd",
        collection_method: "charge_automatically",
        status: "paid",
        amount_paid: 2_000,
        period_start: 1_777_000_000,
      }),
      scope,
    );
    const failure = await buildProcessedStripeAdminAlerts(
      stripeEvent("invoice.payment_failed", {
        parent,
        customer: "cus_teacher",
        next_payment_attempt: 1_777_086_400,
      }),
      scope,
    );

    expect(renewal).toEqual([expect.objectContaining({
      type: "subscription.renewed",
      amountCents: 2_000,
      subscriptionMonth: expect.any(Number),
    })]);
    expect(failure).toEqual([expect.objectContaining({
      type: "payment.failed",
      stripeStatus: "unknown",
      retryAt: new Date(1_777_086_400_000).toISOString(),
    })]);
    expect(JSON.stringify([renewal, failure])).not.toContain("sub_teacher");
    expect(JSON.stringify([renewal, failure])).not.toContain("cus_teacher");
  });

  it("ignores unrelated Checkout activity", async () => {
    const alerts = await buildProcessedStripeAdminAlerts(
      stripeEvent("checkout.session.completed", {
        customer: "cus_unrelated",
        subscription: "sub_unrelated",
        metadata: {},
      }),
      scope,
    );

    expect(alerts).toEqual([]);
    expect(mocks.getStripeBillingAccountByTeacherEmail).not.toHaveBeenCalled();
  });
});

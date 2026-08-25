import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  getStripeBillingAccountByTeacherEmail: vi.fn(),
  getStripeBillingAccountByCustomerId: vi.fn(),
  getUserIsPaid: vi.fn(),
  getAiBillingMonthlySummary: vi.fn(),
  upsertStripeBillingCustomer: vi.fn(),
  upsertStripeBillingSubscription: vi.fn(),
  hasProcessedStripeWebhookEvent: vi.fn(),
  recordProcessedStripeWebhookEvent: vi.fn(),
  getStripeBillingAvailability: vi.fn(),
  requireStripeBillingConfig: vi.fn(),
  constructWebhookEvent: vi.fn(),
  customersCreate: vi.fn(),
  checkoutSessionsCreate: vi.fn(),
  portalSessionsCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  getEnv: vi.fn(),
  getAiConfig: vi.fn(),
  assertAiProviderConfig: vi.fn(),
  isAiTeacherDenied: vi.fn(),
  getGradingConfig: vi.fn(),
  assertGradingProviderConfiguration: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/db", () => ({
  getStripeBillingAccountByTeacherEmail: mocks.getStripeBillingAccountByTeacherEmail,
  getStripeBillingAccountByCustomerId: mocks.getStripeBillingAccountByCustomerId,
  getUserIsPaid: mocks.getUserIsPaid,
  getAiBillingMonthlySummary: mocks.getAiBillingMonthlySummary,
  upsertStripeBillingCustomer: mocks.upsertStripeBillingCustomer,
  upsertStripeBillingSubscription: mocks.upsertStripeBillingSubscription,
  hasProcessedStripeWebhookEvent: mocks.hasProcessedStripeWebhookEvent,
  recordProcessedStripeWebhookEvent: mocks.recordProcessedStripeWebhookEvent,
}));

vi.mock("@/lib/env", () => ({
  getEnv: mocks.getEnv,
}));

vi.mock("@/lib/ai/config", () => ({
  getAiConfig: mocks.getAiConfig,
  assertAiProviderConfig: mocks.assertAiProviderConfig,
  isAiTeacherDenied: mocks.isAiTeacherDenied,
}));

vi.mock("@/lib/grading/config", () => ({
  getGradingConfig: mocks.getGradingConfig,
  assertGradingProviderConfiguration: mocks.assertGradingProviderConfiguration,
}));

vi.mock("@/lib/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing")>();
  return {
    ...actual,
    getStripeBillingAvailability: mocks.getStripeBillingAvailability,
    requireStripeBillingConfig: mocks.requireStripeBillingConfig,
    constructWebhookEvent: mocks.constructWebhookEvent,
    getStripeClient: () => ({
      customers: { create: mocks.customersCreate },
      checkout: { sessions: { create: mocks.checkoutSessionsCreate } },
      billingPortal: { sessions: { create: mocks.portalSessionsCreate } },
      subscriptions: { retrieve: mocks.subscriptionsRetrieve },
    }),
  };
});

const config = {
  enabled: true as const,
  apiVersion: "2026-07-29.dahlia" as const,
  secretKey: "sk_test_habla",
  webhookSecret: "whsec_habla",
  keyMode: "test" as const,
  priceIds: {
    aiGrade: "price_ai_grade",
    audioMinute: "price_audio_minute",
  },
  automaticTaxEnabled: false,
};

const emptySummary = {
  teacherEmail: "teacher@example.com",
  billingMonth: "2026-08",
  qualifyingClassHighWater: 0,
  earnedCredits: 0,
  usedCredits: 0,
  remainingCredits: 0,
  successfulResults: 0,
  freeCreditResults: 0,
  billableResults: 0,
  billableBaseUnits: 0,
  billableDurationSeconds: 0,
  billableOutputTokens: 0,
  pendingResults: 0,
  reportedResults: 0,
  failedResults: 0,
};

const account = {
  teacherEmail: "teacher@example.com",
  stripeCustomerId: "cus_teacher",
  stripeSubscriptionId: "sub_teacher",
  subscriptionStatus: "active",
  priceBookId: "habla-teacher-ai-usd-v2",
  stripeEventCreated: 100,
  createdAt: 1_000,
  updatedAt: 1_000,
};

function jsonRequest(path: string, method = "GET", body?: string) {
  return new Request(`https://tryhabla.com${path}`, {
    method,
    headers: {
      origin: "https://tryhabla.com",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEnv.mockReturnValue({
    productionOrigin: "https://tryhabla.com",
    isDev: false,
  });
  mocks.getAiConfig.mockReturnValue({
    enabled: true,
    accessMode: "paid",
  });
  mocks.assertAiProviderConfig.mockImplementation(() => undefined);
  mocks.getGradingConfig.mockReturnValue({});
  mocks.assertGradingProviderConfiguration.mockImplementation(() => undefined);
  mocks.isAiTeacherDenied.mockReturnValue(false);
  mocks.requireTeacherEmail.mockResolvedValue("teacher@example.com");
  mocks.getStripeBillingAvailability.mockReturnValue({
    enabled: true,
    available: true,
    keyMode: "test",
    automaticTaxEnabled: false,
    issues: [],
  });
  mocks.requireStripeBillingConfig.mockReturnValue(config);
  mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(null);
  mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(account);
  mocks.getUserIsPaid.mockResolvedValue(false);
  mocks.getAiBillingMonthlySummary.mockResolvedValue(emptySummary);
  mocks.upsertStripeBillingCustomer.mockResolvedValue(account);
  mocks.upsertStripeBillingSubscription.mockResolvedValue(account);
  mocks.hasProcessedStripeWebhookEvent.mockResolvedValue(false);
  mocks.recordProcessedStripeWebhookEvent.mockResolvedValue(true);
});

describe("billing status route", () => {
  it("matches BillingPanel's contract and computes retail usage and item period end", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account);
    mocks.getAiBillingMonthlySummary.mockResolvedValue({
      ...emptySummary,
      qualifyingClassHighWater: 3,
      earnedCredits: 2,
      usedCredits: 1,
      remainingCredits: 1,
      successfulResults: 5,
      freeCreditResults: 1,
      billableResults: 4,
      billableBaseUnits: 4,
      billableDurationSeconds: 120,
      billableOutputTokens: 1_000,
    });
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_teacher",
      items: {
        data: [
          { current_period_end: 2_000 },
          { current_period_end: 1_900 },
          { current_period_end: 2_000 },
        ],
      },
    });
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      configured: true,
      checkoutAvailable: true,
      checkoutUnavailableReason: null,
      mode: "test",
      priceBook: {
        id: "habla-teacher-ai-usd-v2",
        effectiveAt: "2026-08-21",
      },
      access: "active",
      subscriptionStatus: "active",
      periodEnd: 1_900_000,
      usage: {
        successfulGrades: 5,
        audioSeconds: 120,
        qualifyingClasses: 3,
        monthlyFreeCredits: 2,
        freeCreditsUsed: 1,
        estimatedChargeUsd: 0.22,
      },
    });
  });

  it("fails soft when Stripe is disabled while preserving pilot access", async () => {
    mocks.getStripeBillingAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    mocks.getUserIsPaid.mockResolvedValue(true);
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      checkoutAvailable: false,
      mode: null,
      access: "pilot",
      subscriptionStatus: null,
      periodEnd: null,
    });
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("keeps status available but disables Checkout until AI prerequisites are ready", async () => {
    mocks.getAiConfig.mockReturnValue({ enabled: false, accessMode: "paid" });
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      checkoutAvailable: false,
      checkoutUnavailableReason: "AI grading is not enabled for this deployment.",
    });
  });

  it("disables Checkout when the provider-neutral grading configuration is not ready", async () => {
    mocks.assertGradingProviderConfiguration.mockImplementation(() => {
      throw new Error("missing grading provider credential");
    });
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      checkoutAvailable: false,
      checkoutUnavailableReason: "AI provider and student-data prerequisites are not ready.",
    });
  });
});

describe("billing Checkout and Portal routes", () => {
  it("creates and persists a Customer, then opens server-owned metered Checkout", async () => {
    mocks.customersCreate.mockResolvedValue({ id: "cus_teacher" });
    mocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_teacher",
      url: "https://checkout.stripe.test/session",
    });
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.test/session",
    });
    expect(mocks.upsertStripeBillingCustomer).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
      stripeCustomerId: "cus_teacher",
    });
    const [params, requestOptions] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(params).toMatchObject({
      mode: "subscription",
      customer: "cus_teacher",
      client_reference_id: "teacher@example.com",
      success_url: "https://tryhabla.com/billing?checkout=success",
      cancel_url: "https://tryhabla.com/billing?checkout=cancelled",
      metadata: {
        teacher_email: "teacher@example.com",
        price_book_id: "habla-teacher-ai-usd-v2",
      },
      line_items: [
        { price: "price_ai_grade" },
        { price: "price_audio_minute" },
      ],
    });
    expect(params.line_items.every((item: object) => !("quantity" in item))).toBe(true);
    expect(requestOptions.idempotencyKey).not.toContain("teacher@example.com");
  });

  it("refuses Checkout before creating a Stripe Customer when AI is not ready", async () => {
    mocks.getAiConfig.mockReturnValue({ enabled: false, accessMode: "paid" });
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(503);
    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("blocks duplicate active subscriptions and cross-origin Checkout", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account);
    const { POST } = await import("@/app/api/billing/checkout/route");
    const duplicate = await POST(jsonRequest("/api/billing/checkout", "POST"));
    expect(duplicate.status).toBe(409);
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();

    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue({
      ...account,
      subscriptionStatus: "past_due",
    });
    const pastDue = await POST(jsonRequest("/api/billing/checkout", "POST"));
    expect(pastDue.status).toBe(409);

    const crossOrigin = await POST(
      new Request("https://tryhabla.com/api/billing/checkout", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it("opens the portal only for the authenticated teacher's stored Customer", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account);
    mocks.portalSessionsCreate.mockResolvedValue({
      url: "https://billing.stripe.test/portal",
    });
    const { POST } = await import("@/app/api/billing/portal/route");
    const response = await POST(jsonRequest("/api/billing/portal", "POST"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://billing.stripe.test/portal",
    });
    expect(mocks.portalSessionsCreate).toHaveBeenCalledWith({
      customer: "cus_teacher",
      return_url: "https://tryhabla.com/billing",
    });
  });
});

describe("Stripe webhook route", () => {
  function webhookRequest(rawBody = "raw-stripe-event") {
    return new Request("https://tryhabla.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "signed-header" },
      body: rawBody,
    });
  }

  it("verifies the raw body, maps Checkout, projects the subscription, then records success", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_checkout",
      type: "checkout.session.completed",
      created: 700,
      data: {
        object: {
          id: "cs_teacher",
          object: "checkout.session",
          customer: "cus_teacher",
          subscription: "sub_teacher",
          client_reference_id: "teacher@example.com",
          metadata: {
            teacher_email: "teacher@example.com",
            price_book_id: "habla-teacher-ai-usd-v2",
          },
        },
      },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_teacher",
      customer: "cus_teacher",
      status: "active",
      metadata: { price_book_id: "habla-teacher-ai-usd-v2" },
      items: {
        data: [
          { price: { id: "price_ai_grade" } },
          { price: { id: "price_audio_minute" } },
        ],
      },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.constructWebhookEvent).toHaveBeenCalledWith(
      "raw-stripe-event",
      "signed-header",
      config,
    );
    expect(mocks.upsertStripeBillingCustomer).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
      stripeCustomerId: "cus_teacher",
    });
    expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeCustomerId: "cus_teacher",
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "active",
        priceBookId: "habla-teacher-ai-usd-v2",
        stripeEventCreated: 700,
      }),
    );
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledWith({
      eventId: "evt_checkout",
      eventType: "checkout.session.completed",
      stripeEventCreated: 700,
    });
    expect(mocks.recordProcessedStripeWebhookEvent.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.upsertStripeBillingSubscription.mock.invocationCallOrder[0],
    );
  });

  it("short-circuits processed events and rejects invalid signatures", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_duplicate",
      type: "invoice.paid",
      created: 800,
      data: { object: {} },
    });
    mocks.hasProcessedStripeWebhookEvent.mockResolvedValue(true);
    const { POST } = await import("@/app/api/billing/webhook/route");
    const duplicate = await POST(webhookRequest());
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();

    mocks.constructWebhookEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const invalid = await POST(webhookRequest("untrusted-json"));
    expect(invalid.status).toBe(400);
    expect(mocks.hasProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("fails closed for an unknown subscription Customer so Stripe can retry", async () => {
    const subscription = {
      id: "sub_unknown",
      customer: "cus_unknown",
      status: "active",
      metadata: { price_book_id: "habla-teacher-ai-usd-v2" },
      items: {
        data: [
          { price: { id: "price_ai_grade" } },
          { price: { id: "price_audio_minute" } },
        ],
      },
    };
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_unknown_customer",
      type: "customer.subscription.updated",
      created: 900,
      data: { object: subscription },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription);
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());
    expect(response.status).toBe(500);
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_unknown");
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("projects the current subscription instead of a stale same-second event snapshot", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_stale_active",
      type: "customer.subscription.updated",
      created: 901,
      data: {
        object: {
          id: "sub_teacher",
          customer: "cus_teacher",
          status: "active",
        },
      },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_teacher",
      customer: "cus_teacher",
      status: "canceled",
      metadata: { price_book_id: "habla-teacher-ai-usd-v2" },
      items: {
        data: [
          { price: { id: "price_ai_grade" } },
          { price: { id: "price_audio_minute" } },
        ],
      },
    });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_teacher");
    expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "canceled",
        stripeEventCreated: 901,
      }),
    );
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledWith({
      eventId: "evt_stale_active",
      eventType: "customer.subscription.updated",
      stripeEventCreated: 901,
    });
  });
});

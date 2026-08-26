import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import { getStripeBillingContractId } from "@/lib/billing/contract";

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  getStripeBillingAccountByTeacherEmail: vi.fn(),
  getStripeBillingAccountByCustomerId: vi.fn(),
  getAiReviewAllowanceSummary: vi.fn(),
  isStripeBillingStorageReady: vi.fn(),
  replaceStripeBillingCustomerMappingForRecovery: vi.fn(),
  projectCurrentStripeEntitledSubscription: vi.fn(),
  projectCurrentStripeNonEntitledSubscription: vi.fn(),
  replaceTerminalStripeSubscriptionFromCheckout: vi.fn(),
  upsertStripeBillingCustomer: vi.fn(),
  upsertStripeBillingSubscription: vi.fn(),
  hasProcessedStripeWebhookEvent: vi.fn(),
  recordProcessedStripeWebhookEvent: vi.fn(),
  buildProcessedStripeAdminAlerts: vi.fn(),
  recordStripeWebhookProcessedWithAdminAlerts: vi.fn(),
  enqueueAdminAlert: vi.fn(),
  getStripeClientAvailability: vi.fn(),
  getStripePortalAvailability: vi.fn(),
  getStripeSubscriptionBillingAvailability: vi.fn(),
  getStripeCheckoutAvailability: vi.fn(),
  isStripeSubscriptionRuntimeReady: vi.fn(),
  isStripePortalRuntimeReady: vi.fn(),
  requireStripeClientConfig: vi.fn(),
  requireStripePortalConfig: vi.fn(),
  requireStripeSubscriptionBillingConfig: vi.fn(),
  requireStripeCheckoutConfig: vi.fn(),
  requireStripeWebhookConfig: vi.fn(),
  requireStripeCatalogConfig: vi.fn(),
  assertConfiguredStripeCatalog: vi.fn(),
  assertConfiguredStripePortal: vi.fn(),
  assertConfiguredStripeAccount: vi.fn(),
  constructWebhookEvent: vi.fn(),
  getStripeClient: vi.fn(),
  customersList: vi.fn(),
  customersRetrieve: vi.fn(),
  customersCreate: vi.fn(),
  checkoutSessionsList: vi.fn(),
  checkoutSessionsCreate: vi.fn(),
  portalSessionsCreate: vi.fn(),
  subscriptionsList: vi.fn(),
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
  getAiReviewAllowanceSummary: mocks.getAiReviewAllowanceSummary,
  isStripeBillingStorageReady: mocks.isStripeBillingStorageReady,
  replaceStripeBillingCustomerMappingForRecovery:
    mocks.replaceStripeBillingCustomerMappingForRecovery,
  projectCurrentStripeEntitledSubscription:
    mocks.projectCurrentStripeEntitledSubscription,
  projectCurrentStripeNonEntitledSubscription:
    mocks.projectCurrentStripeNonEntitledSubscription,
  replaceTerminalStripeSubscriptionFromCheckout:
    mocks.replaceTerminalStripeSubscriptionFromCheckout,
  upsertStripeBillingCustomer: mocks.upsertStripeBillingCustomer,
  upsertStripeBillingSubscription: mocks.upsertStripeBillingSubscription,
  hasProcessedStripeWebhookEvent: mocks.hasProcessedStripeWebhookEvent,
  recordProcessedStripeWebhookEvent: mocks.recordProcessedStripeWebhookEvent,
}));

vi.mock("@/lib/admin-alerts", () => ({
  buildProcessedStripeAdminAlerts: mocks.buildProcessedStripeAdminAlerts,
  enqueueAdminAlert: mocks.enqueueAdminAlert,
  recordStripeWebhookProcessedWithAdminAlerts: (input: {
    eventId: string;
    eventType: string;
    stripeEventCreated: number;
    alerts: unknown[];
  }) => {
    mocks.recordStripeWebhookProcessedWithAdminAlerts(input);
    return mocks.recordProcessedStripeWebhookEvent({
      eventId: input.eventId,
      eventType: input.eventType,
      stripeEventCreated: input.stripeEventCreated,
    });
  },
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
    getStripeClientAvailability: mocks.getStripeClientAvailability,
    getStripePortalAvailability: mocks.getStripePortalAvailability,
    getStripeSubscriptionBillingAvailability:
      mocks.getStripeSubscriptionBillingAvailability,
    getStripeCheckoutAvailability: mocks.getStripeCheckoutAvailability,
    isStripeSubscriptionRuntimeReady: mocks.isStripeSubscriptionRuntimeReady,
    isStripePortalRuntimeReady: mocks.isStripePortalRuntimeReady,
    requireStripeClientConfig: mocks.requireStripeClientConfig,
    requireStripePortalConfig: mocks.requireStripePortalConfig,
    requireStripeSubscriptionBillingConfig:
      mocks.requireStripeSubscriptionBillingConfig,
    requireStripeCheckoutConfig: mocks.requireStripeCheckoutConfig,
    requireStripeWebhookConfig: mocks.requireStripeWebhookConfig,
    requireStripeCatalogConfig: mocks.requireStripeCatalogConfig,
    assertConfiguredStripeCatalog: mocks.assertConfiguredStripeCatalog,
    assertConfiguredStripePortal: mocks.assertConfiguredStripePortal,
    assertConfiguredStripeAccount: mocks.assertConfiguredStripeAccount,
    constructWebhookEvent: mocks.constructWebhookEvent,
    getStripeClient: mocks.getStripeClient,
  };
});

const config = {
  enabled: true as const,
  subscriptionBillingEnabled: true as const,
  checkoutEnabled: true as const,
  apiVersion: "2026-07-29.dahlia" as const,
  secretKey: "sk_test_habla",
  webhookSecret: "whsec_habla",
  keyMode: "test" as const,
  accountId: "acct_habla_test",
  portalConfigurationId: "bpc_habla_v1",
  paymentMethodConfigurationId: "pmc_habla_card_only",
  priceIds: {
    teacher: "price_tryhabla_teacher",
  },
  automaticTaxEnabled: false,
};

const BILLING_CONTRACT_ID = getStripeBillingContractId(config);

const freeAllowance = {
  teacherEmail: "teacher@example.com",
  status: "free_lifetime" as const,
  limit: 30,
  reserved: 0,
  consumed: 0,
  used: 0,
  remaining: 30,
  stripeSubscriptionId: null,
  periodStart: null,
  periodEnd: null,
};

const teacherAllowance = {
  teacherEmail: "teacher@example.com",
  status: "teacher_period" as const,
  limit: 300,
  reserved: 2,
  consumed: 123,
  used: 125,
  remaining: 175,
  stripeSubscriptionId: "sub_teacher",
  periodStart: 1_700_000_000_000,
  periodEnd: 1_702_592_000_000,
};

function account(overrides: Record<string, unknown> = {}) {
  return {
    teacherEmail: "teacher@example.com",
    stripeCustomerId: "cus_teacher",
    stripeSubscriptionId: "sub_teacher",
    subscriptionStatus: "active",
    subscriptionPeriodStart: 1_700_000_000_000,
    subscriptionPeriodEnd: 1_702_592_000_000,
    priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
    catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    stripeAccountId: config.accountId,
    billingContractId: BILLING_CONTRACT_ID,
    livemode: false,
    stripeEventCreated: 100,
    projectionRevision: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function validCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: "cus_teacher",
    deleted: false,
    livemode: false,
    email: "teacher@example.com",
    metadata: {
      habla_app: "tryhabla",
      teacher_email: "teacher@example.com",
      price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      payment_method_policy: "card_only_v1",
      stripe_account_id: config.accountId,
      billing_contract_id: BILLING_CONTRACT_ID,
    },
    ...overrides,
  };
}

function validSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_teacher",
    customer: "cus_teacher",
    status: "active",
    collection_method: "charge_automatically",
    currency: "usd",
    livemode: false,
    pause_collection: null,
    automatic_tax: { enabled: false },
    default_tax_rates: [],
    created: 1_000,
    metadata: {
      habla_app: "tryhabla",
      price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      teacher_email: "teacher@example.com",
      payment_method_policy: "card_only_v1",
      stripe_account_id: config.accountId,
      billing_contract_id: BILLING_CONTRACT_ID,
    },
    items: {
      data: [
        {
          price: { id: config.priceIds.teacher },
          quantity: 1,
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
          tax_rates: [],
        },
      ],
      has_more: false,
    },
    ...overrides,
  };
}

function checkoutSession(overrides: Record<string, unknown> = {}) {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  return {
    id: "cs_teacher",
    object: "checkout.session",
    adaptive_pricing: { enabled: false },
    automatic_tax: { enabled: false },
    client_reference_id: "teacher@example.com",
    created: nowSeconds,
    currency: "usd",
    customer: "cus_teacher",
    expires_at: nowSeconds + 3_600,
    line_items: {
      data: [
        { price: { id: config.priceIds.teacher }, quantity: 1 },
      ],
      has_more: false,
    },
    livemode: false,
    payment_method_types: ["card"],
    metadata: {
      habla_app: "tryhabla",
      teacher_email: "teacher@example.com",
      price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      payment_method_policy: "card_only_v1",
      stripe_account_id: config.accountId,
      billing_contract_id: BILLING_CONTRACT_ID,
    },
    mode: "subscription",
    status: "open",
    subscription: null,
    url: "https://checkout.stripe.test/session",
    ...overrides,
  };
}

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
  mocks.getAiConfig.mockReturnValue({ enabled: true, accessMode: "paid" });
  mocks.assertAiProviderConfig.mockImplementation(() => undefined);
  mocks.getGradingConfig.mockReturnValue({});
  mocks.assertGradingProviderConfiguration.mockImplementation(() => undefined);
  mocks.isAiTeacherDenied.mockReturnValue(false);
  mocks.requireTeacherEmail.mockResolvedValue("teacher@example.com");
  mocks.getStripeClientAvailability.mockReturnValue({
    enabled: true,
    available: true,
    keyMode: "test",
    issues: [],
  });
  mocks.getStripePortalAvailability.mockReturnValue({
    enabled: true,
    available: true,
    keyMode: "test",
    portalConfigurationId: "bpc_habla_v1",
    paymentMethodConfigurationId: "pmc_habla_card_only",
    issues: [],
  });
  mocks.getStripeSubscriptionBillingAvailability.mockReturnValue({
    enabled: true,
    available: true,
    keyMode: "test",
    automaticTaxEnabled: false,
    subscriptionBillingEnabled: true,
    issues: [],
  });
  mocks.getStripeCheckoutAvailability.mockReturnValue({
    enabled: true,
    available: true,
    keyMode: "test",
    automaticTaxEnabled: false,
    subscriptionBillingEnabled: true,
    checkoutEnabled: true,
    issues: [],
  });
  mocks.isStripeSubscriptionRuntimeReady.mockResolvedValue(true);
  mocks.isStripePortalRuntimeReady.mockResolvedValue(true);
  mocks.requireStripeClientConfig.mockReturnValue(config);
  mocks.requireStripePortalConfig.mockReturnValue(config);
  mocks.requireStripeSubscriptionBillingConfig.mockReturnValue(config);
  mocks.requireStripeCheckoutConfig.mockReturnValue(config);
  mocks.requireStripeWebhookConfig.mockReturnValue(config);
  mocks.requireStripeCatalogConfig.mockReturnValue(config);
  mocks.assertConfiguredStripeCatalog.mockResolvedValue({
    valid: true,
    cached: false,
    checkedAt: "2026-08-25T00:00:00.000Z",
    keyMode: "test",
    priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
    fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    dimensions: ["teacher"],
  });
  mocks.assertConfiguredStripePortal.mockResolvedValue({
    valid: true,
    cached: false,
    checkedAt: "2026-08-25T00:00:00.000Z",
    keyMode: "test",
    configurationId: "bpc_habla_v1",
    paymentMethodConfigurationId: "pmc_habla_card_only",
    schemaVersion: 3,
  });
  mocks.assertConfiguredStripeAccount.mockResolvedValue({
    valid: true,
    cached: false,
    checkedAt: "2026-08-25T00:00:00.000Z",
    keyMode: "test",
    accountId: config.accountId,
  });
  mocks.getStripeClient.mockImplementation(() => ({
    customers: {
      list: mocks.customersList,
      retrieve: mocks.customersRetrieve,
      create: mocks.customersCreate,
    },
    checkout: {
      sessions: {
        list: mocks.checkoutSessionsList,
        create: mocks.checkoutSessionsCreate,
      },
    },
    billingPortal: { sessions: { create: mocks.portalSessionsCreate } },
    subscriptions: {
      list: mocks.subscriptionsList,
      retrieve: mocks.subscriptionsRetrieve,
    },
  }));
  mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(null);
  mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(account());
  mocks.getAiReviewAllowanceSummary.mockResolvedValue(freeAllowance);
  mocks.isStripeBillingStorageReady.mockResolvedValue(true);
  mocks.replaceStripeBillingCustomerMappingForRecovery.mockResolvedValue(account());
  mocks.projectCurrentStripeEntitledSubscription.mockResolvedValue(account());
  mocks.projectCurrentStripeNonEntitledSubscription.mockResolvedValue(
    account({ subscriptionStatus: "canceled", catalogFingerprint: "" }),
  );
  mocks.replaceTerminalStripeSubscriptionFromCheckout.mockResolvedValue(account());
  mocks.upsertStripeBillingCustomer.mockResolvedValue(
    account({
      stripeSubscriptionId: "",
      subscriptionStatus: "",
      priceBookId: "",
      catalogFingerprint: "",
    }),
  );
  mocks.upsertStripeBillingSubscription.mockResolvedValue(account());
  mocks.checkoutSessionsList.mockResolvedValue({ data: [], has_more: false });
  mocks.customersList.mockResolvedValue({ data: [], has_more: false });
  mocks.customersRetrieve.mockResolvedValue(validCustomer());
  mocks.subscriptionsList.mockResolvedValue({ data: [], has_more: false });
  mocks.hasProcessedStripeWebhookEvent.mockResolvedValue(false);
  mocks.recordProcessedStripeWebhookEvent.mockResolvedValue(true);
  mocks.buildProcessedStripeAdminAlerts.mockResolvedValue([]);
  mocks.enqueueAdminAlert.mockResolvedValue({ inserted: true });
});

describe("billing status route", () => {
  it("returns the exact billing contract and grants verified runtime-backed access", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account());
    mocks.getAiReviewAllowanceSummary.mockResolvedValue(teacherAllowance);
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      clientConfigured: true,
      runtimeAvailable: true,
      portalAvailable: true,
      checkoutAvailable: false,
      checkoutUnavailableReason:
        "This account already has a Stripe subscription. Open Manage billing instead.",
      mode: "test",
      accountIssue: null,
      priceBook: {
        id: STRIPE_CATALOG_MANIFEST.priceBookId,
        effectiveAt: "2026-08-26",
      },
      access: "active",
      subscriptionStatus: "active",
      periodEnd: 1_702_592_000_000,
      usage: {
        allowanceKind: "teacher_period",
        limit: 300,
        reservedReviews: 2,
        consumedReviews: 123,
        usedReviews: 125,
        remainingReviews: 175,
        periodStart: 1_700_000_000_000,
        periodEnd: 1_702_592_000_000,
      },
    });
    expect(mocks.getAiReviewAllowanceSummary).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
    });
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("keeps Portal and manual-grant access available while subscription billing is paused", async () => {
    mocks.getStripeSubscriptionBillingAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    mocks.getStripeCheckoutAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({
        stripeSubscriptionId: "",
        subscriptionStatus: "",
        subscriptionPeriodStart: 0,
        subscriptionPeriodEnd: 0,
        priceBookId: "",
        catalogFingerprint: "",
      }),
    );
    mocks.getAiReviewAllowanceSummary.mockResolvedValue({
      ...freeAllowance,
      status: "manual_lifetime",
      limit: 300,
      remaining: 300,
    });
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      clientConfigured: true,
      runtimeAvailable: false,
      portalAvailable: true,
      checkoutAvailable: false,
      mode: "test",
      accountIssue: null,
      access: "pilot",
      subscriptionStatus: null,
    });
    expect(mocks.isStripeSubscriptionRuntimeReady).not.toHaveBeenCalled();
    expect(mocks.isStripePortalRuntimeReady).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an active Stripe row has no authoritative allowance", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account());
    mocks.getAiReviewAllowanceSummary.mockResolvedValue({
      ...freeAllowance,
      status: "subscription_unavailable",
      limit: 0,
      remaining: 0,
      stripeSubscriptionId: "sub_teacher",
      periodStart: 1_700_000_000_000,
      periodEnd: 1_702_592_000_000,
    });
    const { GET } = await import("@/app/api/billing/status/route");

    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runtimeAvailable: true,
      portalAvailable: true,
      checkoutAvailable: false,
      accountIssue: "billing_paused",
      access: "inactive",
      subscriptionStatus: "active",
    });
    expect(mocks.isStripeBillingStorageReady).not.toHaveBeenCalled();
    expect(mocks.isStripePortalRuntimeReady).toHaveBeenCalledTimes(1);
  });

  it("withholds Portal unless its pinned configuration capability is remotely ready", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account());
    mocks.isStripePortalRuntimeReady.mockResolvedValue(false);
    const { GET } = await import("@/app/api/billing/status/route");

    const response = await GET(jsonRequest("/api/billing/status"));

    await expect(response.json()).resolves.toMatchObject({
      clientConfigured: true,
      portalAvailable: false,
      mode: "test",
    });
    expect(mocks.isStripePortalRuntimeReady).toHaveBeenCalledTimes(1);
  });

  it("withholds Portal locally when the pinned capability is absent or account mode differs", async () => {
    mocks.getStripePortalAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "not_configured",
      issues: ["missing"],
    });
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account());
    const { GET } = await import("@/app/api/billing/status/route");

    let response = await GET(jsonRequest("/api/billing/status"));
    await expect(response.json()).resolves.toMatchObject({ portalAvailable: false });
    expect(mocks.isStripePortalRuntimeReady).not.toHaveBeenCalled();

    mocks.getStripePortalAvailability.mockReturnValue({
      enabled: true,
      available: true,
      keyMode: "test",
      portalConfigurationId: "bpc_habla_v1",
      issues: [],
    });
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ livemode: true }),
    );
    response = await GET(jsonRequest("/api/billing/status"));
    await expect(response.json()).resolves.toMatchObject({ portalAvailable: false });
    expect(mocks.isStripePortalRuntimeReady).not.toHaveBeenCalled();
  });

  it("surfaces a subscription/account mode mismatch and never grants Stripe access", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ livemode: true }),
    );
    const { GET } = await import("@/app/api/billing/status/route");

    const response = await GET(jsonRequest("/api/billing/status"));

    await expect(response.json()).resolves.toMatchObject({
      accountIssue: "mode_mismatch",
      access: "inactive",
      portalAvailable: false,
      subscriptionStatus: "active",
    });
  });

  it("does not advertise Checkout for a terminal account from an older billing scope", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({
        subscriptionStatus: "canceled",
        billingContractId: "billing-contract-from-an-older-release",
      }),
    );
    const { GET } = await import("@/app/api/billing/status/route");

    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accountIssue: "billing_contract_mismatch",
      subscriptionStatus: "canceled",
      access: "inactive",
      checkoutAvailable: false,
      checkoutUnavailableReason:
        "This account's Stripe billing state must be resolved before another Checkout can start.",
    });
  });

  it.each([
    [
      "price-book mismatch",
      { priceBookId: "habla-teacher-ai-usd-v1" },
      "price_book_mismatch",
    ],
    [
      "fingerprint mismatch",
      { catalogFingerprint: "unverified" },
      "catalog_unverified",
    ],
  ])("fails closed for an active subscription with a %s", async (_label, overrides, issue) => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account(overrides));
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accountIssue: issue,
      access: "inactive",
      subscriptionStatus: "active",
      portalAvailable: true,
      checkoutAvailable: false,
    });
  });

  it("surfaces the webhook's fail-closed placeholder as catalog_unverified", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ subscriptionStatus: "invalid_catalog", catalogFingerprint: "" }),
    );
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    await expect(response.json()).resolves.toMatchObject({
      accountIssue: "catalog_unverified",
      access: "inactive",
      subscriptionStatus: "invalid_catalog",
      checkoutAvailable: false,
    });
  });

  it("keeps status available but disables Checkout until AI prerequisites are ready", async () => {
    mocks.getAiConfig.mockReturnValue({ enabled: false, accessMode: "paid" });
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      clientConfigured: true,
      runtimeAvailable: true,
      checkoutAvailable: false,
      checkoutUnavailableReason: "AI grading is not enabled for this deployment.",
      access: "inactive",
    });
  });

  it("reports a fully unavailable client while preserving manual access", async () => {
    mocks.getStripeClientAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "not_configured",
      issues: ["missing"],
    });
    mocks.getStripeSubscriptionBillingAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    mocks.getStripeCheckoutAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    mocks.getAiReviewAllowanceSummary.mockResolvedValue({
      ...freeAllowance,
      status: "manual_lifetime",
      limit: 300,
      remaining: 300,
    });
    const { GET } = await import("@/app/api/billing/status/route");
    const response = await GET(jsonRequest("/api/billing/status"));

    await expect(response.json()).resolves.toMatchObject({
      clientConfigured: false,
      runtimeAvailable: false,
      portalAvailable: false,
      checkoutAvailable: false,
      mode: null,
      accountIssue: null,
      access: "pilot",
      periodEnd: null,
    });
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });
});

describe("billing Checkout and Portal routes", () => {
  it("validates the catalog before creating a Customer and opens neutral-return Checkout", async () => {
    mocks.customersCreate.mockResolvedValue({ id: "cus_teacher", livemode: false });
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
    expect(mocks.assertConfiguredStripeCatalog).toHaveBeenCalledWith(config);
    expect(mocks.assertConfiguredStripeCatalog.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.customersCreate.mock.invocationCallOrder[0],
    );
    expect(mocks.customersList).toHaveBeenCalledWith({
      email: "teacher@example.com",
      limit: 100,
    });
    expect(mocks.customersRetrieve).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingCustomer).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
      stripeCustomerId: "cus_teacher",
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
    });
    expect(mocks.checkoutSessionsList).toHaveBeenCalledWith({
      customer: "cus_teacher",
      created: { gte: expect.any(Number) },
      expand: ["data.line_items"],
      limit: 100,
    });
    expect(mocks.customersCreate).toHaveBeenCalledWith(
      {
        email: "teacher@example.com",
        metadata: {
          habla_app: "tryhabla",
          teacher_email: "teacher@example.com",
          price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
          catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
          payment_method_policy: "card_only_v1",
          stripe_account_id: config.accountId,
          billing_contract_id: BILLING_CONTRACT_ID,
        },
      },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    const [params, requestOptions] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(params).toMatchObject({
      mode: "subscription",
      adaptive_pricing: { enabled: false },
      customer: "cus_teacher",
      client_reference_id: "teacher@example.com",
      success_url: "https://tryhabla.com/billing?checkout=returned",
      cancel_url: "https://tryhabla.com/billing?checkout=cancelled",
      payment_method_types: ["card"],
      metadata: {
        habla_app: "tryhabla",
        teacher_email: "teacher@example.com",
        price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
        catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        payment_method_policy: "card_only_v1",
        stripe_account_id: config.accountId,
        billing_contract_id: BILLING_CONTRACT_ID,
      },
      subscription_data: {
        metadata: {
          habla_app: "tryhabla",
          teacher_email: "teacher@example.com",
          price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
          catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
          payment_method_policy: "card_only_v1",
          stripe_account_id: config.accountId,
          billing_contract_id: BILLING_CONTRACT_ID,
        },
      },
      line_items: [
        { price: config.priceIds.teacher, quantity: 1 },
      ],
    });
    expect(params.line_items).toHaveLength(1);
    expect(params.consent_collection).toBeUndefined();
    expect(requestOptions.idempotencyKey).not.toContain("teacher@example.com");
  });

  it("fails before any billing read or write when remote catalog validation fails", async () => {
    mocks.assertConfiguredStripeCatalog.mockRejectedValue(new Error("wrong Stripe price"));
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error:
        "Stripe pricing and self-service billing are being verified. Checkout is temporarily unavailable.",
    });
    expect(mocks.getStripeBillingAccountByTeacherEmail).not.toHaveBeenCalled();
    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingCustomer).not.toHaveBeenCalled();
  });

  it("fails before Customer or Checkout work when the pinned Portal is not ready", async () => {
    mocks.assertConfiguredStripePortal.mockRejectedValue(new Error("unsafe portal"));
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(503);
    expect(mocks.getStripeBillingAccountByTeacherEmail).not.toHaveBeenCalled();
    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsList).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingCustomer).not.toHaveBeenCalled();
  });

  it("fails before Customer or Checkout work when legacy billing rows are quarantined", async () => {
    mocks.isStripeBillingStorageReady.mockResolvedValue(false);
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(503);
    expect(mocks.assertConfiguredStripeCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.assertConfiguredStripePortal).toHaveBeenCalledTimes(1);
    expect(mocks.getStripeBillingAccountByTeacherEmail).not.toHaveBeenCalled();
    expect(mocks.customersList).not.toHaveBeenCalled();
    expect(mocks.customersRetrieve).not.toHaveBeenCalled();
    expect(mocks.subscriptionsList).not.toHaveBeenCalled();
    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsList).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingCustomer).not.toHaveBeenCalled();
    expect(mocks.replaceStripeBillingCustomerMappingForRecovery).not.toHaveBeenCalled();
    expect(mocks.projectCurrentStripeEntitledSubscription).not.toHaveBeenCalled();
    expect(mocks.projectCurrentStripeNonEntitledSubscription).not.toHaveBeenCalled();
  });

  it("blocks a configured-price subscription even when its metadata was stripped", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "" }),
    );
    mocks.customersList.mockResolvedValue({ data: [validCustomer()], has_more: false });
    mocks.subscriptionsList.mockResolvedValue({
      data: [validSubscription({ metadata: {} })],
      has_more: false,
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(409);
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "invalid_catalog",
        stripeAccountId: config.accountId,
        billingContractId: BILLING_CONTRACT_ID,
      }),
    );
    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("blocks an unresolved configured-price Checkout session with stripped metadata", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "" }),
    );
    mocks.customersList.mockResolvedValue({ data: [validCustomer()], has_more: false });
    mocks.checkoutSessionsList.mockResolvedValue({
      data: [checkoutSession({ metadata: {} })],
      has_more: false,
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(409);
    expect(mocks.checkoutSessionsList).toHaveBeenCalledWith({
      customer: "cus_teacher",
      created: { gte: expect.any(Number) },
      expand: ["data.line_items"],
      limit: 100,
    });
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("restores an exact Customer and active subscription after local DB loss", async () => {
    mocks.customersList.mockResolvedValue({ data: [validCustomer()], has_more: false });
    mocks.subscriptionsList.mockResolvedValue({ data: [validSubscription()], has_more: false });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(409);
    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingCustomer).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
      stripeCustomerId: "cus_teacher",
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
    });
    expect(mocks.projectCurrentStripeEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "active",
        stripeAccountId: config.accountId,
        billingContractId: BILLING_CONTRACT_ID,
      }),
    );
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("allows immediate replacement after a completed Checkout subscription failed terminally", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "sub_failed", subscriptionStatus: "canceled" }),
    );
    mocks.customersList.mockResolvedValue({ data: [validCustomer()], has_more: false });
    mocks.subscriptionsList.mockResolvedValue({
      data: [validSubscription({ id: "sub_failed", status: "canceled" })],
      has_more: false,
    });
    mocks.projectCurrentStripeNonEntitledSubscription.mockResolvedValue(
      account({ stripeSubscriptionId: "sub_failed", subscriptionStatus: "canceled" }),
    );
    mocks.checkoutSessionsList.mockResolvedValue({
      data: [
        checkoutSession({
          id: "cs_failed",
          status: "complete",
          subscription: "sub_failed",
          url: null,
        }),
      ],
      has_more: false,
    });
    mocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_replacement",
      url: "https://checkout.stripe.test/replacement",
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(200);
    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses Checkout before catalog or Customer work when AI is not ready", async () => {
    mocks.getAiConfig.mockReturnValue({ enabled: false, accessMode: "paid" });
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(503);
    expect(mocks.assertConfiguredStripeCatalog).not.toHaveBeenCalled();
    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("blocks duplicate non-terminal subscriptions after catalog validation", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account());
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(409);
    expect(mocks.assertConfiguredStripeCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("reuses the exact open Habla Checkout session instead of creating another", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "", stripeEventCreated: 500 }),
    );
    mocks.checkoutSessionsList.mockResolvedValue({
      data: [checkoutSession()],
      has_more: false,
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.test/session",
    });
    expect(mocks.customersRetrieve).toHaveBeenCalledWith("cus_teacher");
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses reuse when exact and drifted Habla Checkout sessions are both open", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "", stripeEventCreated: 500 }),
    );
    mocks.checkoutSessionsList.mockResolvedValue({
      data: [
        checkoutSession({ id: "cs_exact" }),
        checkoutSession({
          id: "cs_drifted",
          adaptive_pricing: { enabled: true },
        }),
      ],
      has_more: false,
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Multiple Stripe Checkout sessions are still open. Wait for them to expire or contact billing support.",
    });
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("does not create alongside an open Habla session with unsafe pricing state", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "", stripeEventCreated: 500 }),
    );
    mocks.checkoutSessionsList.mockResolvedValue({
      data: [checkoutSession({ adaptive_pricing: { enabled: true } })],
      has_more: false,
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(409);
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", false, true],
    ["enabled", true, false],
  ])(
    "refuses to reuse a Checkout session when automatic tax is configured %s but the session differs",
    async (_label, configuredTax, sessionTax) => {
      const taxConfig = { ...config, automaticTaxEnabled: configuredTax };
      mocks.requireStripeCheckoutConfig.mockReturnValue(taxConfig);
      mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
        account({ stripeSubscriptionId: "", subscriptionStatus: "", stripeEventCreated: 500 }),
      );
      mocks.checkoutSessionsList.mockResolvedValue({
        data: [checkoutSession({ automatic_tax: { enabled: sessionTax } })],
        has_more: false,
      });
      const { POST } = await import("@/app/api/billing/checkout/route");

      const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

      expect(response.status).toBe(409);
      expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    },
  );

  it("blocks a completed exact Checkout session while its subscription webhook is pending", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "", stripeEventCreated: 500 }),
    );
    mocks.checkoutSessionsList.mockResolvedValue({
      data: [checkoutSession({ status: "complete", subscription: "sub_new" })],
      has_more: false,
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest("/api/billing/checkout", "POST"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Stripe Checkout completed and account activation is still processing.",
    });
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("uses one stable idempotency key for concurrent retries with the same remote state", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "", stripeEventCreated: 500 }),
    );
    mocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_teacher",
      url: "https://checkout.stripe.test/session",
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const responses = await Promise.all([
      POST(jsonRequest("/api/billing/checkout", "POST")),
      POST(jsonRequest("/api/billing/checkout", "POST")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const keys = mocks.checkoutSessionsCreate.mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("uses the same idempotency generation across an open-to-expired status race", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "", stripeEventCreated: 500 }),
    );
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const expiringSession = checkoutSession({
      id: "cs_expiration_boundary",
      created: nowSeconds - 100,
      expires_at: nowSeconds - 1,
      url: null,
    });
    mocks.checkoutSessionsList
      .mockResolvedValueOnce({
        data: [{ ...expiringSession, status: "open" }],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [{ ...expiringSession, status: "expired" }],
        has_more: false,
      });
    mocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_new",
      url: "https://checkout.stripe.test/new",
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const responses = await Promise.all([
      POST(jsonRequest("/api/billing/checkout", "POST")),
      POST(jsonRequest("/api/billing/checkout", "POST")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const keys = mocks.checkoutSessionsCreate.mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("changes the Checkout idempotency contract when automatic-tax mode changes", async () => {
    const taxEnabledConfig = { ...config, automaticTaxEnabled: true };
    mocks.requireStripeCheckoutConfig
      .mockReturnValueOnce(config)
      .mockReturnValueOnce(taxEnabledConfig);
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(null);
    mocks.customersCreate.mockResolvedValue({ id: "cus_teacher", livemode: false });
    mocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_tax_contract",
      url: "https://checkout.stripe.test/tax-contract",
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    expect((await POST(jsonRequest("/api/billing/checkout", "POST"))).status).toBe(200);
    expect((await POST(jsonRequest("/api/billing/checkout", "POST"))).status).toBe(200);

    const keys = mocks.checkoutSessionsCreate.mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("recovers after expiration and changes the key only when remote session state changes", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ stripeSubscriptionId: "", subscriptionStatus: "", stripeEventCreated: 500 }),
    );
    const nowSeconds = Math.floor(Date.now() / 1_000);
    mocks.checkoutSessionsList.mockResolvedValue({
      data: [
        checkoutSession({
          id: "cs_expired_1",
          status: "expired",
          created: nowSeconds - 100,
          expires_at: nowSeconds - 1,
          url: null,
        }),
      ],
      has_more: false,
    });
    mocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_recovered",
      url: "https://checkout.stripe.test/recovered",
    });
    const { POST } = await import("@/app/api/billing/checkout/route");

    expect((await POST(jsonRequest("/api/billing/checkout", "POST"))).status).toBe(200);
    expect((await POST(jsonRequest("/api/billing/checkout", "POST"))).status).toBe(200);
    const sameStateKeys = mocks.checkoutSessionsCreate.mock.calls.map(
      (call) => call[1].idempotencyKey,
    );
    expect(sameStateKeys[0]).toBe(sameStateKeys[1]);

    mocks.checkoutSessionsList.mockResolvedValue({
      data: [
        checkoutSession({
          id: "cs_expired_2",
          status: "expired",
          created: nowSeconds,
          expires_at: nowSeconds - 1,
          url: null,
        }),
      ],
      has_more: false,
    });
    expect((await POST(jsonRequest("/api/billing/checkout", "POST"))).status).toBe(200);
    expect(mocks.checkoutSessionsCreate.mock.calls[2][1].idempotencyKey).not.toBe(
      sameStateKeys[1],
    );
  });

  it("uses the pinned remotely verified Portal while acquisition is paused", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account());
    mocks.requireStripeCheckoutConfig.mockImplementation(() => {
      throw new Error("checkout disabled");
    });
    mocks.portalSessionsCreate.mockResolvedValue({
      url: "https://billing.stripe.test/portal",
    });
    const { POST } = await import("@/app/api/billing/portal/route");
    const response = await POST(jsonRequest("/api/billing/portal", "POST"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://billing.stripe.test/portal",
    });
    expect(mocks.requireStripePortalConfig).toHaveBeenCalledTimes(1);
    expect(mocks.requireStripeClientConfig).not.toHaveBeenCalled();
    expect(mocks.requireStripeCheckoutConfig).not.toHaveBeenCalled();
    expect(mocks.assertConfiguredStripePortal).toHaveBeenCalledWith(config);
    expect(mocks.assertConfiguredStripePortal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.portalSessionsCreate.mock.invocationCallOrder[0],
    );
    expect(mocks.portalSessionsCreate).toHaveBeenCalledWith({
      configuration: "bpc_habla_v1",
      customer: "cus_teacher",
      return_url: "https://tryhabla.com/billing",
    });
  });

  it("fails closed before session creation when the pinned Portal drifts", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(account());
    mocks.assertConfiguredStripePortal.mockRejectedValue(new Error("unsafe portal"));
    const { POST } = await import("@/app/api/billing/portal/route");

    const response = await POST(jsonRequest("/api/billing/portal", "POST"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Stripe billing controls are being verified. Try again shortly.",
    });
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects a Portal account from the opposite Stripe mode before remote work", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({ livemode: true }),
    );
    const { POST } = await import("@/app/api/billing/portal/route");

    const response = await POST(jsonRequest("/api/billing/portal", "POST"));

    expect(response.status).toBe(409);
    expect(mocks.assertConfiguredStripePortal).not.toHaveBeenCalled();
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled();
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

  it("rejects a live event in test mode before any database read or side effect", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_live_in_test",
      livemode: true,
      type: "checkout.session.completed",
      created: 699,
      data: { object: {} },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Stripe webhook mode does not match this deployment.",
    });
    expect(mocks.hasProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingCustomer).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingSubscription).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "incident",
        code: "stripe_environment_mismatch",
        summary: "A verified Stripe event does not match this deployment environment.",
      },
      { dedupeKey: "stripe-mode:evt_live_in_test" },
    );
  });

  it("rejects a test event in live mode before any database read or side effect", async () => {
    const liveConfig = {
      ...config,
      keyMode: "live" as const,
      secretKey: "sk_live_habla",
    };
    mocks.requireStripeWebhookConfig.mockReturnValue(liveConfig);
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_test_in_live",
      livemode: false,
      type: "customer.subscription.updated",
      created: 699,
      data: { object: {} },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    expect(mocks.constructWebhookEvent).toHaveBeenCalledWith(
      "raw-stripe-event",
      "signed-header",
      liveConfig,
    );
    expect(mocks.hasProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "incident",
        code: "stripe_environment_mismatch",
      }),
      { dedupeKey: "stripe-mode:evt_test_in_live" },
    );
  });

  it("records a verified billing event even when alert enrichment fails", async () => {
    const event = {
      id: "evt_alert_enrichment_failure",
      livemode: false,
      type: "invoice.paid",
      created: 699,
      data: { object: {} },
    };
    mocks.constructWebhookEvent.mockReturnValue(event);
    mocks.buildProcessedStripeAdminAlerts.mockRejectedValueOnce(
      new Error("alert-only failure"),
    );
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.recordStripeWebhookProcessedWithAdminAlerts).toHaveBeenCalledWith({
      eventId: event.id,
      eventType: event.type,
      stripeEventCreated: event.created,
      alerts: [],
    });
  });

  it("maps Habla Checkout and projects access only after exact catalog verification", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_checkout",
      livemode: false,
      type: "checkout.session.completed",
      created: 700,
      data: {
        object: {
          id: "cs_teacher",
          customer: "cus_teacher",
          subscription: "sub_teacher",
          client_reference_id: "teacher@example.com",
          payment_method_types: ["card"],
          metadata: {
            habla_app: "tryhabla",
            teacher_email: "teacher@example.com",
            price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
            catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
            payment_method_policy: "card_only_v1",
            stripe_account_id: config.accountId,
            billing_contract_id: BILLING_CONTRACT_ID,
          },
        },
      },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.subscriptionsList.mockResolvedValue({
      data: [validSubscription()],
      has_more: false,
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
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
    });
    expect(mocks.assertConfiguredStripeCatalog).toHaveBeenCalledWith(config);
    expect(mocks.projectCurrentStripeEntitledSubscription).toHaveBeenCalledWith({
      stripeCustomerId: "cus_teacher",
      stripeSubscriptionId: "sub_teacher",
      subscriptionStatus: "active",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
      subscriptionPeriodStart: 1_700_000_000_000,
      subscriptionPeriodEnd: 1_702_592_000_000,
      observedEventCreated: 700,
      expectedAccount: {
        stripeSubscriptionId: "",
        subscriptionStatus: "",
        stripeEventCreated: 100,
        projectionRevision: 0,
      },
    });
    expect(mocks.assertConfiguredStripeCatalog.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.projectCurrentStripeEntitledSubscription.mock.invocationCallOrder[0],
    );
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledWith({
      eventId: "evt_checkout",
      eventType: "checkout.session.completed",
      stripeEventCreated: 700,
    });
    expect(mocks.buildProcessedStripeAdminAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt_checkout" }),
      {
        livemode: false,
        stripeAccountId: config.accountId,
        billingContractId: BILLING_CONTRACT_ID,
      },
    );
    expect(mocks.recordStripeWebhookProcessedWithAdminAlerts).toHaveBeenCalledWith({
      eventId: "evt_checkout",
      eventType: "checkout.session.completed",
      stripeEventCreated: 700,
      alerts: [],
    });
  });

  it("accepts concurrent matching Subscription creation and Checkout completion", async () => {
    const unprojectedAccount = account({
      stripeSubscriptionId: "",
      subscriptionStatus: "",
      priceBookId: "",
      catalogFingerprint: "",
      stripeEventCreated: 100,
      projectionRevision: 1,
    });
    const subscription = validSubscription();
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(unprojectedAccount);
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(unprojectedAccount);
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription);
    mocks.subscriptionsList.mockResolvedValue({ data: [subscription], has_more: false });
    mocks.projectCurrentStripeEntitledSubscription.mockResolvedValue(
      account({ stripeEventCreated: 701, projectionRevision: 2 }),
    );
    mocks.constructWebhookEvent.mockImplementation((rawBody: string) =>
      rawBody === "subscription-created"
        ? {
            id: "evt_subscription_created_race",
            livemode: false,
            type: "customer.subscription.created",
            created: 700,
            data: { object: subscription },
          }
        : {
            id: "evt_checkout_completed_race",
            livemode: false,
            type: "checkout.session.completed",
            created: 701,
            data: {
              object: {
                id: "cs_concurrent",
                customer: "cus_teacher",
                subscription: "sub_teacher",
                client_reference_id: "teacher@example.com",
                payment_method_types: ["card"],
                metadata: {
                  habla_app: "tryhabla",
                  teacher_email: "teacher@example.com",
                  price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
                  catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
                  payment_method_policy: "card_only_v1",
                  stripe_account_id: config.accountId,
                  billing_contract_id: BILLING_CONTRACT_ID,
                },
              },
            },
          },
    );
    const { POST } = await import("@/app/api/billing/webhook/route");

    const responses = await Promise.all([
      POST(webhookRequest("subscription-created")),
      POST(webhookRequest("checkout-completed")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.projectCurrentStripeEntitledSubscription).toHaveBeenCalledTimes(2);
    expect(
      mocks.projectCurrentStripeEntitledSubscription.mock.calls.map(
        ([projection]) => projection.expectedAccount,
      ),
    ).toEqual([unprojectedAccount, unprojectedAccount].map((snapshot) => ({
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      subscriptionStatus: snapshot.subscriptionStatus,
      stripeEventCreated: snapshot.stripeEventCreated,
      projectionRevision: snapshot.projectionRevision,
    })));
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(2);
  });

  it("leaves a delayed Checkout event retryable instead of replacing a newer Customer mapping", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_delayed_checkout",
      livemode: false,
      type: "checkout.session.completed",
      created: 650,
      data: {
        object: {
          id: "cs_stale",
          customer: "cus_stale",
          subscription: "sub_stale",
          client_reference_id: "teacher@example.com",
          payment_method_types: ["card"],
          metadata: {
            habla_app: "tryhabla",
            teacher_email: "teacher@example.com",
            price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
            catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
            payment_method_policy: "card_only_v1",
            stripe_account_id: config.accountId,
            billing_contract_id: BILLING_CONTRACT_ID,
          },
        },
      },
    });
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({
        stripeCustomerId: "cus_current",
        stripeSubscriptionId: "sub_current",
        stripeEventCreated: 900,
      }),
    );
    mocks.subscriptionsRetrieve.mockResolvedValue(
      validSubscription({ id: "sub_stale", customer: "cus_stale" }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.upsertStripeBillingCustomer).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_stale");
    expect(mocks.upsertStripeBillingSubscription).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("handles Checkout before the matching Subscription event without replacing twice", async () => {
    const terminalAccount = account({
      stripeSubscriptionId: "sub_old",
      subscriptionStatus: "canceled",
      stripeEventCreated: 900,
      projectionRevision: 4,
    });
    const replacement = validSubscription({ id: "sub_new" });
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(terminalAccount);
    mocks.subscriptionsRetrieve.mockResolvedValue(replacement);
    mocks.subscriptionsList.mockResolvedValue({
      data: [replacement, validSubscription({ id: "sub_old", status: "canceled" })],
      has_more: false,
    });
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_checkout_replacement",
      livemode: false,
      type: "checkout.session.completed",
      created: 700,
      data: {
        object: {
          id: "cs_replacement",
          customer: "cus_teacher",
          subscription: "sub_new",
          client_reference_id: "teacher@example.com",
          payment_method_types: ["card"],
          metadata: {
            habla_app: "tryhabla",
            teacher_email: "teacher@example.com",
            price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
            catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
            payment_method_policy: "card_only_v1",
            stripe_account_id: config.accountId,
            billing_contract_id: BILLING_CONTRACT_ID,
          },
        },
      },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.replaceTerminalStripeSubscriptionFromCheckout).toHaveBeenCalledWith({
      stripeCustomerId: "cus_teacher",
      stripeSubscriptionId: "sub_new",
      subscriptionStatus: "active",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
      subscriptionPeriodStart: 1_700_000_000_000,
      subscriptionPeriodEnd: 1_702_592_000_000,
      observedEventCreated: 700,
      expectedAccount: {
        stripeSubscriptionId: "sub_old",
        subscriptionStatus: "canceled",
        stripeEventCreated: 900,
        projectionRevision: 4,
      },
    });
    expect(mocks.projectCurrentStripeEntitledSubscription).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);

    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(
      account({
        stripeSubscriptionId: "sub_new",
        subscriptionStatus: "active",
        stripeEventCreated: 700,
        projectionRevision: 5,
      }),
    );
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_subscription_after_checkout",
      livemode: false,
      type: "customer.subscription.created",
      created: 701,
      data: { object: replacement },
    });

    const subscriptionResponse = await POST(webhookRequest());

    expect(subscriptionResponse.status).toBe(200);
    expect(mocks.replaceTerminalStripeSubscriptionFromCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.projectCurrentStripeEntitledSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(2);
  });

  it("replaces a terminal mapping when Subscription creation arrives before Checkout completion", async () => {
    const terminalAccount = account({
      stripeSubscriptionId: "sub_old",
      subscriptionStatus: "canceled",
      stripeEventCreated: 900,
      projectionRevision: 4,
    });
    const replacement = validSubscription({ id: "sub_new" });
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(terminalAccount);
    mocks.subscriptionsRetrieve.mockResolvedValue(replacement);
    mocks.subscriptionsList.mockResolvedValue({
      data: [replacement, validSubscription({ id: "sub_old", status: "canceled" })],
      has_more: false,
    });
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_subscription_before_checkout",
      livemode: false,
      type: "customer.subscription.created",
      created: 700,
      data: { object: replacement },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.replaceTerminalStripeSubscriptionFromCheckout).toHaveBeenCalledWith({
      stripeCustomerId: "cus_teacher",
      stripeSubscriptionId: "sub_new",
      subscriptionStatus: "active",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
      subscriptionPeriodStart: 1_700_000_000_000,
      subscriptionPeriodEnd: 1_702_592_000_000,
      observedEventCreated: 700,
      expectedAccount: {
        stripeSubscriptionId: "sub_old",
        subscriptionStatus: "canceled",
        stripeEventCreated: 900,
        projectionRevision: 4,
      },
    });
    expect(mocks.upsertStripeBillingSubscription).not.toHaveBeenCalled();
    expect(mocks.projectCurrentStripeNonEntitledSubscription).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("leaves a terminal Checkout replacement retryable when its CAS loses a race", async () => {
    mocks.getStripeBillingAccountByTeacherEmail.mockResolvedValue(
      account({
        stripeSubscriptionId: "sub_old_race",
        subscriptionStatus: "canceled",
        projectionRevision: 7,
      }),
    );
    const replacement = validSubscription({ id: "sub_new_race" });
    mocks.subscriptionsRetrieve.mockResolvedValue(replacement);
    mocks.subscriptionsList.mockResolvedValue({ data: [replacement], has_more: false });
    mocks.replaceTerminalStripeSubscriptionFromCheckout.mockResolvedValue(null);
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_checkout_replacement_race",
      livemode: false,
      type: "checkout.session.completed",
      created: 701,
      data: {
        object: {
          id: "cs_replacement_race",
          customer: "cus_teacher",
          subscription: "sub_new_race",
          client_reference_id: "teacher@example.com",
          payment_method_types: ["card"],
          metadata: {
            habla_app: "tryhabla",
            teacher_email: "teacher@example.com",
            price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
            catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
            payment_method_policy: "card_only_v1",
            stripe_account_id: config.accountId,
            billing_contract_id: BILLING_CONTRACT_ID,
          },
        },
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("short-circuits processed events and rejects invalid signatures", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_duplicate",
      livemode: false,
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

  it("records and ignores an unrelated subscription for an unknown Customer", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_unrelated",
      livemode: false,
      type: "customer.subscription.updated",
      created: 850,
      data: {
        object: {
          id: "sub_unrelated",
          customer: "cus_unrelated",
          status: "active",
          metadata: {},
        },
      },
    });
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingSubscription).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledWith({
      eventId: "evt_unrelated",
      eventType: "customer.subscription.updated",
      stripeEventCreated: 850,
    });
  });

  it("fails closed on a metadata-stripped nonterminal subscription for a mapped Customer", async () => {
    const stripped = validSubscription({ id: "sub_unrelated", metadata: {} });
    mocks.subscriptionsRetrieve.mockResolvedValue(stripped);
    mocks.subscriptionsList.mockResolvedValue({
      data: [validSubscription(), stripped],
      has_more: false,
    });
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_mapped_unrelated",
      livemode: false,
      type: "customer.subscription.updated",
      created: 875,
      data: {
        object: {
          id: "sub_unrelated",
          customer: "cus_teacher",
          status: "active",
          metadata: {},
        },
      },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_unrelated");
    expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "invalid_catalog",
        stripeAccountId: config.accountId,
        billingContractId: BILLING_CONTRACT_ID,
      }),
    );
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "incident",
        code: "stripe_webhook_processing_failed",
        summary: "A verified Stripe webhook could not complete its local projection and remains eligible for retry.",
      },
      { dedupeKey: "stripe-failure:evt_mapped_unrelated" },
    );
  });

  it("revokes and retries a stale event for a second currently active subscription", async () => {
    const second = validSubscription({ id: "sub_second" });
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(
      account({ stripeEventCreated: 1_000, projectionRevision: 8 }),
    );
    mocks.subscriptionsRetrieve.mockResolvedValue(second);
    mocks.subscriptionsList.mockResolvedValue({
      data: [validSubscription(), second],
      has_more: false,
    });
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_stale_second_active",
      livemode: false,
      type: "customer.subscription.updated",
      created: 900,
      data: { object: second },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "invalid_catalog",
        stripeEventCreated: 1_000,
        stripeAccountId: config.accountId,
        billingContractId: BILLING_CONTRACT_ID,
      }),
    );
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("leaves a Habla event unrecorded when its Customer mapping is missing", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_habla_unmapped",
      livemode: false,
      type: "customer.subscription.updated",
      created: 900,
      data: {
        object: validSubscription({
          id: "sub_unknown",
          customer: "cus_unknown",
        }),
      },
    });
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("revokes from a freshly retrieved current state even when the triggering event is old", async () => {
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(
      account({ stripeEventCreated: 200, projectionRevision: 3 }),
    );
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_old_trigger_current_canceled",
      livemode: false,
      type: "customer.subscription.updated",
      created: 100,
      data: { object: validSubscription() },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(
      validSubscription({ status: "canceled" }),
    );
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith({
      stripeCustomerId: "cus_teacher",
      stripeSubscriptionId: "sub_teacher",
      subscriptionStatus: "canceled",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
      observedEventCreated: 100,
      expectedAccount: {
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "active",
        stripeEventCreated: 200,
        projectionRevision: 3,
      },
    });
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("projects invalid_catalog and retries a mapped active subscription without exact metadata", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_missing_metadata",
      livemode: false,
      type: "customer.subscription.updated",
      created: 901,
      data: { object: validSubscription({ metadata: {} }) },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription({ metadata: {} }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.assertConfiguredStripeCatalog).not.toHaveBeenCalled();
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith({
      stripeCustomerId: "cus_teacher",
      stripeSubscriptionId: "sub_teacher",
      subscriptionStatus: "invalid_catalog",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
      observedEventCreated: 901,
      expectedAccount: {
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "active",
        stripeEventCreated: 100,
        projectionRevision: 0,
      },
    });
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("projects invalid_catalog for the same event, then replaces it after validation recovers", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_catalog_retry",
      livemode: false,
      type: "customer.subscription.updated",
      created: 902,
      data: { object: validSubscription() },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.subscriptionsList.mockResolvedValue({
      data: [validSubscription()],
      has_more: false,
    });
    mocks.getStripeBillingAccountByCustomerId
      .mockResolvedValueOnce(account({ stripeEventCreated: 1_000 }))
      .mockResolvedValueOnce(
        account({
          subscriptionStatus: "invalid_catalog",
          catalogFingerprint: "",
          stripeEventCreated: 1_000,
          projectionRevision: 1,
        }),
      );
    mocks.assertConfiguredStripeCatalog
      .mockRejectedValueOnce(new Error("Stripe read failed"))
      .mockResolvedValue({ valid: true });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const first = await POST(webhookRequest());
    expect(first.status).toBe(500);
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    const second = await POST(webhookRequest());
    expect(second.status).toBe(200);

    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionStatus: "invalid_catalog",
        observedEventCreated: 902,
      }),
    );
    expect(mocks.projectCurrentStripeEntitledSubscription.mock.calls).toEqual([
      [
        expect.objectContaining({
          subscriptionStatus: "active",
          catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
          observedEventCreated: 902,
          expectedAccount: {
            stripeSubscriptionId: "sub_teacher",
            subscriptionStatus: "invalid_catalog",
            stripeEventCreated: 1_000,
            projectionRevision: 1,
          },
        }),
      ],
    ]);
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("leaves a verified current-state projection retryable when its CAS loses a race", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_entitled_cas_race",
      livemode: false,
      type: "customer.subscription.updated",
      created: 902,
      data: { object: validSubscription() },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.subscriptionsList.mockResolvedValue({ data: [validSubscription()], has_more: false });
    mocks.projectCurrentStripeEntitledSubscription.mockResolvedValue(null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("prevents divergent duplicate webhook validation from overwriting the winning projection", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_duplicate_projection_race",
      livemode: false,
      type: "customer.subscription.updated",
      created: 902,
      data: { object: validSubscription() },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.subscriptionsList.mockResolvedValue({ data: [validSubscription()], has_more: false });
    let releaseFailedValidation!: () => void;
    const winningProjection = new Promise<void>((resolve) => {
      releaseFailedValidation = resolve;
    });
    mocks.assertConfiguredStripeCatalog
      .mockResolvedValueOnce({ valid: true })
      .mockImplementationOnce(async () => {
        await winningProjection;
        throw new Error("transient catalog read failure");
      });
    mocks.projectCurrentStripeEntitledSubscription.mockImplementationOnce(async () => {
      releaseFailedValidation();
      return account({ projectionRevision: 1 });
    });
    mocks.projectCurrentStripeNonEntitledSubscription.mockResolvedValue(null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const responses = await Promise.all([POST(webhookRequest()), POST(webhookRequest())]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 500]);
    expect(mocks.projectCurrentStripeEntitledSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("projects invalid_catalog and leaves the event retryable while legacy billing rows are quarantined", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_legacy_storage_quarantine",
      livemode: false,
      type: "customer.subscription.updated",
      created: 902,
      data: { object: validSubscription() },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.isStripeBillingStorageReady.mockResolvedValue(false);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionStatus: "invalid_catalog",
        observedEventCreated: 902,
      }),
    );
    expect(mocks.subscriptionsList).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails closed when the Customer subscription list omits the retrieved subscription", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_subscription_list_omission",
      livemode: false,
      type: "customer.subscription.updated",
      created: 903,
      data: { object: validSubscription() },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.subscriptionsList.mockResolvedValue({ data: [], has_more: false });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionStatus: "invalid_catalog",
      }),
    );
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails closed when more than one nonterminal Habla subscription is listed", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_duplicate_subscription",
      livemode: false,
      type: "customer.subscription.updated",
      created: 903,
      data: { object: validSubscription() },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.subscriptionsList.mockResolvedValue({
      data: [validSubscription(), validSubscription({ id: "sub_duplicate" })],
      has_more: false,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: "invalid_catalog" }),
    );
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails closed when an active subscription is not exactly one Teacher item at quantity one", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_wrong_prices",
      livemode: false,
      type: "customer.subscription.updated",
      created: 903,
      data: { object: validSubscription() },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(
      validSubscription({
        items: {
          data: [
            {
              price: { id: config.priceIds.teacher },
              quantity: 2,
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
              tax_rates: [],
            },
          ],
          has_more: false,
        },
      }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.assertConfiguredStripeCatalog).not.toHaveBeenCalled();
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionStatus: "invalid_catalog",
      }),
    );
    consoleError.mockRestore();
  });

  it.each([
    [
      "default tax rate",
      { default_tax_rates: [{ id: "txr_unapproved" }] },
    ],
    [
      "item tax rate",
      {
        items: {
          data: [
            {
              price: { id: config.priceIds.teacher },
              quantity: 1,
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
              tax_rates: [{ id: "txr_unapproved" }],
            },
          ],
          has_more: false,
        },
      },
    ],
  ])("rejects an active subscription with an unapproved manual %s", async (_label, overrides) => {
    const taxed = validSubscription(overrides);
    mocks.upsertStripeBillingSubscription.mockResolvedValue(
      account({
        subscriptionStatus: "invalid_catalog",
        catalogFingerprint: "",
        stripeEventCreated: 905,
        projectionRevision: 1,
      }),
    );
    mocks.subscriptionsRetrieve.mockResolvedValue(taxed);
    mocks.constructWebhookEvent.mockReturnValue({
      id: `evt_manual_tax_${_label}`,
      livemode: false,
      type: "customer.subscription.updated",
      created: 905,
      data: { object: taxed },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: "invalid_catalog" }),
    );
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: "invalid_catalog" }),
    );
    expect(mocks.projectCurrentStripeEntitledSubscription).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([
    ["disabled", false, true],
    ["enabled", true, false],
  ])(
    "withholds webhook entitlement when automatic tax is configured %s but the Subscription differs",
    async (_label, configuredTax, subscriptionTax) => {
      mocks.requireStripeCatalogConfig.mockReturnValue({
        ...config,
        automaticTaxEnabled: configuredTax,
      });
      const mismatched = validSubscription({
        automatic_tax: { enabled: subscriptionTax },
      });
      mocks.upsertStripeBillingSubscription.mockResolvedValue(
        account({
          subscriptionStatus: "invalid_catalog",
          catalogFingerprint: "",
          stripeEventCreated: 903,
          projectionRevision: 1,
        }),
      );
      mocks.subscriptionsRetrieve.mockResolvedValue(mismatched);
      mocks.constructWebhookEvent.mockReturnValue({
        id: `evt_tax_mismatch_${_label}`,
        livemode: false,
        type: "customer.subscription.updated",
        created: 903,
        data: { object: mismatched },
      });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { POST } = await import("@/app/api/billing/webhook/route");

      const response = await POST(webhookRequest());

      expect(response.status).toBe(500);
      expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionStatus: "invalid_catalog" }),
      );
      expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionStatus: "invalid_catalog" }),
      );
      expect(mocks.projectCurrentStripeEntitledSubscription).not.toHaveBeenCalled();
      expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
      consoleError.mockRestore();
    },
  );

  it("revokes signed non-entitled state before a failed Stripe current-state read", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_canceled",
      livemode: false,
      type: "customer.subscription.deleted",
      created: 904,
      data: { object: validSubscription({ status: "canceled", metadata: {} }) },
    });
    mocks.subscriptionsRetrieve.mockRejectedValue(new Error("Stripe API unavailable"));
    mocks.assertConfiguredStripeAccount.mockRejectedValue(new Error("account API unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.requireStripeWebhookConfig).toHaveBeenCalledTimes(1);
    expect(mocks.requireStripeCatalogConfig).toHaveBeenCalled();
    expect(mocks.assertConfiguredStripeAccount).not.toHaveBeenCalled();
    expect(mocks.assertConfiguredStripeCatalog).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith({
      stripeCustomerId: "cus_teacher",
      stripeSubscriptionId: "sub_teacher",
      subscriptionStatus: "canceled",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: "",
      stripeAccountId: config.accountId,
      billingContractId: BILLING_CONTRACT_ID,
      livemode: false,
      stripeEventCreated: 904,
      expectedAccount: {
        stripeSubscriptionId: "sub_teacher",
        subscriptionStatus: "active",
        stripeEventCreated: 100,
        projectionRevision: 0,
      },
    });
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_teacher");
    expect(mocks.upsertStripeBillingSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.subscriptionsRetrieve.mock.invocationCallOrder[0],
    );
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reconciles a stale signed revocation against the current active subscription", async () => {
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(
      account({ stripeEventCreated: 1_000, projectionRevision: 8 }),
    );
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_stale_revocation",
      livemode: false,
      type: "customer.subscription.updated",
      created: 999,
      data: { object: validSubscription({ status: "past_due" }) },
    });
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.subscriptionsList.mockResolvedValue({ data: [validSubscription()], has_more: false });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.upsertStripeBillingSubscription).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_teacher");
    expect(mocks.projectCurrentStripeEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionStatus: "active",
        stripeAccountId: config.accountId,
        billingContractId: BILLING_CONTRACT_ID,
      }),
    );
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("revokes trialing immediately and never treats it as entitled", async () => {
    const trialing = validSubscription({ status: "trialing" });
    mocks.upsertStripeBillingSubscription.mockResolvedValue(
      account({
        subscriptionStatus: "trialing",
        catalogFingerprint: "",
        stripeEventCreated: 1_010,
        projectionRevision: 1,
      }),
    );
    mocks.subscriptionsRetrieve.mockResolvedValue(trialing);
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_trialing",
      livemode: false,
      type: "customer.subscription.updated",
      created: 1_010,
      data: { object: trialing },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionStatus: "trialing",
        catalogFingerprint: "",
        stripeAccountId: config.accountId,
        billingContractId: BILLING_CONTRACT_ID,
      }),
    );
    expect(mocks.projectCurrentStripeNonEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: "trialing" }),
    );
    expect(mocks.projectCurrentStripeEntitledSubscription).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("reconciles a same-second delayed revocation to Stripe's current active state", async () => {
    const revoked = account({
      subscriptionStatus: "past_due",
      catalogFingerprint: "",
      stripeEventCreated: 1_000,
      projectionRevision: 9,
    });
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(
      account({ stripeEventCreated: 1_000, projectionRevision: 8 }),
    );
    mocks.upsertStripeBillingSubscription.mockResolvedValue(revoked);
    mocks.subscriptionsRetrieve.mockResolvedValue(validSubscription());
    mocks.subscriptionsList.mockResolvedValue({ data: [validSubscription()], has_more: false });
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_same_second_past_due",
      livemode: false,
      type: "customer.subscription.updated",
      created: 1_000,
      data: { object: validSubscription({ status: "past_due" }) },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.upsertStripeBillingSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.subscriptionsRetrieve.mock.invocationCallOrder[0],
    );
    expect(mocks.projectCurrentStripeEntitledSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionStatus: "active",
        observedEventCreated: 1_000,
        expectedAccount: {
          stripeSubscriptionId: "sub_teacher",
          subscriptionStatus: "past_due",
          stripeEventCreated: 1_000,
          projectionRevision: 9,
        },
      }),
    );
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["paused collection", { pause_collection: { behavior: "void" } }],
    ["manual collection", { collection_method: "send_invoice" }],
  ])(
    "projects signed active state as invalid_catalog before Stripe reads when %s is present",
    async (_label, overrides) => {
      mocks.upsertStripeBillingSubscription.mockResolvedValue(
        account({
          subscriptionStatus: "invalid_catalog",
          catalogFingerprint: "",
          stripeEventCreated: 1_001,
          projectionRevision: 1,
        }),
      );
      mocks.subscriptionsRetrieve.mockRejectedValue(new Error("Stripe API unavailable"));
      mocks.constructWebhookEvent.mockReturnValue({
        id: `evt_signed_noncollectible_${_label}`,
        livemode: false,
        type: "customer.subscription.updated",
        created: 1_001,
        data: { object: validSubscription(overrides) },
      });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { POST } = await import("@/app/api/billing/webhook/route");

      const response = await POST(webhookRequest());

      expect(response.status).toBe(500);
      expect(mocks.upsertStripeBillingSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionStatus: "invalid_catalog",
          catalogFingerprint: "",
          stripeEventCreated: 1_001,
        }),
      );
      expect(mocks.upsertStripeBillingSubscription.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.subscriptionsRetrieve.mock.invocationCallOrder[0],
      );
      expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
      consoleError.mockRestore();
    },
  );

  it("records and ignores a delayed terminal event for a replaced Subscription", async () => {
    mocks.getStripeBillingAccountByCustomerId.mockResolvedValue(
      account({
        stripeSubscriptionId: "sub_new",
        stripeEventCreated: 1_100,
        projectionRevision: 12,
      }),
    );
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_old_terminal_after_replacement",
      livemode: false,
      type: "customer.subscription.deleted",
      created: 1_000,
      data: {
        object: validSubscription({ id: "sub_old", status: "canceled" }),
      },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.upsertStripeBillingSubscription).not.toHaveBeenCalled();
    expect(mocks.projectCurrentStripeNonEntitledSubscription).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete Habla Checkout metadata before changing Customer mapping", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_bad_checkout_metadata",
      livemode: false,
      type: "checkout.session.completed",
      created: 904,
      data: {
        object: {
          id: "cs_bad_metadata",
          customer: "cus_teacher",
          subscription: "sub_teacher",
          client_reference_id: "teacher@example.com",
          metadata: {
            habla_app: "tryhabla",
            teacher_email: "teacher@example.com",
            price_book_id: STRIPE_CATALOG_MANIFEST.priceBookId,
          },
        },
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.upsertStripeBillingCustomer).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rejects a completed Checkout from a foreign Stripe account before DB mutation", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_foreign_account_checkout",
      livemode: false,
      type: "checkout.session.completed",
      created: 905,
      data: {
        object: {
          ...checkoutSession({
            status: "complete",
            subscription: "sub_teacher",
            url: null,
          }),
          metadata: {
            ...checkoutSession().metadata,
            stripe_account_id: "acct_foreign",
          },
        },
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.assertConfiguredStripeAccount).toHaveBeenCalledWith(config);
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.getStripeBillingAccountByTeacherEmail).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingCustomer).not.toHaveBeenCalled();
    expect(mocks.upsertStripeBillingSubscription).not.toHaveBeenCalled();
    expect(mocks.projectCurrentStripeEntitledSubscription).not.toHaveBeenCalled();
    expect(mocks.projectCurrentStripeNonEntitledSubscription).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("ignores an unrelated Checkout session without creating a mapping", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_unrelated_checkout",
      livemode: false,
      type: "checkout.session.completed",
      created: 905,
      data: {
        object: {
          id: "cs_unrelated",
          customer: "cus_unrelated",
          subscription: "sub_unrelated",
          metadata: {},
        },
      },
    });
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.upsertStripeBillingCustomer).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.recordProcessedStripeWebhookEvent).toHaveBeenCalledTimes(1);
  });
});

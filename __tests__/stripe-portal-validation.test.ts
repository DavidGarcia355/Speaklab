import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STRIPE_PORTAL_CONFIGURATION_MANIFEST,
  StripePortalValidationError,
  assertConfiguredStripePortal,
  clearStripePortalValidationCacheForTests,
  isStripePortalRuntimeReady,
  normalizeStripePortalConfiguration,
  type StripePortalReadConfiguration,
  type StripePortalReadPaymentMethodConfiguration,
} from "@/lib/billing/portal-validation";
import { clearStripeAccountValidationCacheForTests } from "@/lib/billing/account-validation";
import { requireStripePortalConfig } from "@/lib/billing/config";
import {
  assertStripePortalTestKey,
  buildStripePortalConfigurationCreateParams,
  buildStripePortalConfigurationIdempotencyKey,
  reconcileStripePortalConfiguration,
} from "@/scripts/stripe-portal-setup";
import {
  STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME,
  assertExactCardOnlyPaymentMethodConfiguration,
  assertStripePaymentMethodsTestKey,
  buildStripeCardOnlyConfigurationCreateParams,
  buildStripeCardOnlyConfigurationUpdateParams,
  normalizeStripePaymentMethodConfiguration,
  reconcileStripePaymentMethodConfiguration,
  type StripePaymentMethodConfigurationRecord,
} from "@/scripts/stripe-payment-methods-setup";

const ENV = {
  NODE_ENV: "test",
  STRIPE_SECRET_KEY: "sk_test_habla",
  STRIPE_ACCOUNT_ID: "acct_habla_test",
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_habla_v1",
  STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_habla_card_only",
};

const config = requireStripePortalConfig(ENV);

function portalConfiguration(
  overrides: Partial<StripePortalReadConfiguration> = {},
): StripePortalReadConfiguration {
  return {
    id: "bpc_habla_v1",
    name: STRIPE_PORTAL_CONFIGURATION_MANIFEST.name,
    active: true,
    livemode: false,
    defaultReturnUrl: STRIPE_PORTAL_CONFIGURATION_MANIFEST.defaultReturnUrl,
    businessProfileHeadline:
      STRIPE_PORTAL_CONFIGURATION_MANIFEST.businessProfile.headline,
    businessProfilePrivacyPolicyUrl:
      STRIPE_PORTAL_CONFIGURATION_MANIFEST.businessProfile.privacyPolicyUrl,
    businessProfileTermsOfServiceUrl:
      STRIPE_PORTAL_CONFIGURATION_MANIFEST.businessProfile.termsOfServiceUrl,
    loginPageEnabled: true,
    customerUpdateEnabled: true,
    customerUpdateAllowedUpdates: [
      ...STRIPE_PORTAL_CONFIGURATION_MANIFEST.customerUpdateAllowedUpdates,
    ],
    invoiceHistoryEnabled: true,
    paymentMethodUpdateEnabled: true,
    paymentMethodConfigurationId: "pmc_habla_card_only",
    subscriptionCancelEnabled: true,
    subscriptionCancelMode: "at_period_end",
    subscriptionCancelProrationBehavior: "none",
    subscriptionUpdateEnabled: false,
    metadata: { ...STRIPE_PORTAL_CONFIGURATION_MANIFEST.metadata },
    ...overrides,
  };
}

function paymentMethodConfiguration(
  overrides: Partial<StripePortalReadPaymentMethodConfiguration> = {},
): StripePortalReadPaymentMethodConfiguration {
  return {
    id: "pmc_habla_card_only",
    active: true,
    livemode: false,
    cardAvailable: true,
    methodPreferences: { card: "on", link: "off", usBankAccount: "off" },
    ...overrides,
  };
}

function setupPaymentMethodConfiguration(
  overrides: Partial<StripePaymentMethodConfigurationRecord> = {},
): StripePaymentMethodConfigurationRecord {
  return {
    id: "pmc_habla_card_only",
    name: STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME,
    active: true,
    livemode: false,
    cardAvailable: true,
    methodPreferences: { card: "on", link: "off", us_bank_account: "off" },
    ...overrides,
  };
}

function runtimeClient(input?: {
  configuration?: StripePortalReadConfiguration;
  paymentMethods?: StripePortalReadPaymentMethodConfiguration;
}) {
  return {
    retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
    retrieveConfiguration: vi
      .fn()
      .mockResolvedValue(input?.configuration ?? portalConfiguration()),
    retrievePaymentMethodConfiguration: vi
      .fn()
      .mockResolvedValue(input?.paymentMethods ?? paymentMethodConfiguration()),
  };
}

beforeEach(() => {
  clearStripeAccountValidationCacheForTests();
  clearStripePortalValidationCacheForTests();
});

describe("Stripe Portal runtime validation", () => {
  it("normalizes the exact Portal identity, return, and legal profile fields", () => {
    const normalized = normalizeStripePortalConfiguration({
      id: "bpc_habla_v1",
      object: "billing_portal.configuration",
      name: "Habla teacher billing portal v3",
      active: true,
      application: null,
      created: 1,
      is_default: false,
      livemode: false,
      default_return_url: "https://tryhabla.com/billing",
      business_profile: {
        headline: "Manage your Habla teacher billing.",
        privacy_policy_url: "https://tryhabla.com/privacy",
        terms_of_service_url: "https://tryhabla.com/terms",
      },
      login_page: { enabled: true, url: "https://billing.stripe.com/session" },
      features: {
        customer_update: {
          enabled: true,
          allowed_updates: ["address", "name", "tax_id"],
        },
        invoice_history: { enabled: true },
        payment_method_update: {
          enabled: true,
          payment_method_configuration: "pmc_habla_card_only",
        },
        subscription_cancel: {
          cancellation_reason: { enabled: false, options: [] },
          enabled: true,
          mode: "at_period_end",
          proration_behavior: "none",
        },
        subscription_update: {
          billing_cycle_anchor: null,
          enabled: false,
          default_allowed_updates: [],
          products: null,
          proration_behavior: "none",
          schedule_at_period_end: {
            conditions: [],
          },
          trial_update_behavior: "end_trial",
        },
      },
      metadata: { ...STRIPE_PORTAL_CONFIGURATION_MANIFEST.metadata },
      updated: 1,
    } satisfies Stripe.BillingPortal.Configuration);

    expect(normalized).toMatchObject({
      name: "Habla teacher billing portal v3",
      defaultReturnUrl: "https://tryhabla.com/billing",
      businessProfileHeadline: "Manage your Habla teacher billing.",
      businessProfilePrivacyPolicyUrl: "https://tryhabla.com/privacy",
      businessProfileTermsOfServiceUrl: "https://tryhabla.com/terms",
    });
  });

  it("accepts and briefly caches the exact pinned configuration", async () => {
    const client = runtimeClient();
    const options = {
      client,
      now: () => 1_000,
    };

    await expect(assertConfiguredStripePortal(config, options)).resolves.toMatchObject({
      valid: true,
      cached: false,
      keyMode: "test",
      configurationId: "bpc_habla_v1",
      schemaVersion: 3,
      paymentMethodConfigurationId: "pmc_habla_card_only",
    });
    await expect(assertConfiguredStripePortal(config, options)).resolves.toMatchObject({
      valid: true,
      cached: true,
    });
    expect(client.retrieveAccountId).toHaveBeenCalledTimes(1);
    expect(client.retrieveConfiguration).toHaveBeenCalledTimes(1);
    expect(client.retrievePaymentMethodConfiguration).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["inactive", { active: false }, "portal_configuration_contract_mismatch"],
    ["wrong mode", { livemode: true }, "portal_configuration_mode_mismatch"],
    ["wrong name", { name: "Other portal" }, "portal_configuration_contract_mismatch"],
    [
      "wrong default return URL",
      { defaultReturnUrl: "https://example.com" },
      "portal_configuration_contract_mismatch",
    ],
    [
      "wrong business headline",
      { businessProfileHeadline: "Other billing" },
      "portal_configuration_contract_mismatch",
    ],
    [
      "wrong privacy URL",
      { businessProfilePrivacyPolicyUrl: "https://example.com/privacy" },
      "portal_configuration_contract_mismatch",
    ],
    [
      "wrong terms URL",
      { businessProfileTermsOfServiceUrl: "https://example.com/terms" },
      "portal_configuration_contract_mismatch",
    ],
    ["login disabled", { loginPageEnabled: false }, "portal_configuration_contract_mismatch"],
    [
      "customer updates disabled",
      { customerUpdateEnabled: false },
      "portal_configuration_contract_mismatch",
    ],
    [
      "wrong customer updates",
      { customerUpdateAllowedUpdates: ["name"] },
      "portal_configuration_contract_mismatch",
    ],
    [
      "invoice history disabled",
      { invoiceHistoryEnabled: false },
      "portal_configuration_contract_mismatch",
    ],
    [
      "payment update disabled",
      { paymentMethodUpdateEnabled: false },
      "portal_configuration_contract_mismatch",
    ],
    [
      "cancellation disabled",
      { subscriptionCancelEnabled: false },
      "portal_configuration_contract_mismatch",
    ],
    [
      "immediate cancellation",
      { subscriptionCancelMode: "immediately" },
      "portal_configuration_contract_mismatch",
    ],
    [
      "cancel proration",
      { subscriptionCancelProrationBehavior: "create_prorations" },
      "portal_configuration_contract_mismatch",
    ],
    [
      "plan updates enabled",
      { subscriptionUpdateEnabled: true },
      "portal_configuration_contract_mismatch",
    ],
    [
      "wrong metadata version",
      {
        metadata: {
          ...STRIPE_PORTAL_CONFIGURATION_MANIFEST.metadata,
          habla_portal_schema_version: "2",
        },
      },
      "portal_configuration_metadata_mismatch",
    ],
    [
      "extra metadata",
      {
        metadata: {
          ...STRIPE_PORTAL_CONFIGURATION_MANIFEST.metadata,
          unexpected: "value",
        },
      },
      "portal_configuration_metadata_mismatch",
    ],
  ])("rejects %s", async (_label, overrides, code) => {
    const client = runtimeClient({ configuration: portalConfiguration(overrides) });

    await expect(
      assertConfiguredStripePortal(config, { client, cache: false }),
    ).rejects.toMatchObject({ code });
  });

  it("wraps remote read failure in a safe validation error", async () => {
    await expect(
      assertConfiguredStripePortal(config, {
        client: {
          retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
          retrieveConfiguration: vi.fn().mockRejectedValue(new Error("secret response")),
          retrievePaymentMethodConfiguration: vi.fn(),
        },
        cache: false,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<StripePortalValidationError>>({
        code: "portal_configuration_read_failed",
        message: "Stripe Customer Portal configuration validation failed (remote_read).",
      }),
    );
  });

  it("reports runtime readiness only after local and remote validation", async () => {
    const client = runtimeClient();
    await expect(
      isStripePortalRuntimeReady(ENV, { client, cache: false }),
    ).resolves.toBe(true);
    await expect(
      isStripePortalRuntimeReady(
        { NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_test_habla" },
        { client, cache: false },
      ),
    ).resolves.toBe(false);
  });
});

describe("Stripe card-only Payment Method Configuration sandbox setup", () => {
  it("rejects live and malformed setup keys", () => {
    expect(() => assertStripePaymentMethodsTestKey("sk_live_secret")).toThrow(
      "test-mode only",
    );
    expect(() => assertStripePaymentMethodsTestKey("not_a_key")).toThrow(
      "test or sandbox",
    );
    expect(assertStripePaymentMethodsTestKey("rkcs_test_habla")).toBe(
      "rkcs_test_habla",
    );
  });

  it("builds card-on creation and turns every surfaced non-card method off", () => {
    const drifted = setupPaymentMethodConfiguration({
      active: false,
      methodPreferences: {
        card: "off",
        link: "on",
        paypal: "on",
        us_bank_account: "none",
      },
    });
    expect(buildStripeCardOnlyConfigurationCreateParams()).toEqual({
      name: STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME,
      card: { display_preference: { preference: "on" } },
    });
    expect(buildStripeCardOnlyConfigurationUpdateParams(drifted)).toEqual({
      active: true,
      name: STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME,
      card: { display_preference: { preference: "on" } },
      link: { display_preference: { preference: "off" } },
      paypal: { display_preference: { preference: "off" } },
      us_bank_account: { display_preference: { preference: "off" } },
    });
  });

  it("fails closed when Stripe surfaces a payment method without an effective preference", () => {
    const normalized = normalizeStripePaymentMethodConfiguration({
      id: "pmc_missing_preference",
      name: STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME,
      active: true,
      livemode: false,
      card: {
        available: true,
        display_preference: { value: "on" },
      },
      link: { available: true },
    } as Parameters<typeof normalizeStripePaymentMethodConfiguration>[0]);

    expect(normalized.methodPreferences).toEqual({
      card: "on",
      link: "<missing>",
    });
    expect(() =>
      assertExactCardOnlyPaymentMethodConfiguration(normalized, "test"),
    ).toThrow(/not the exact card-only contract/);
    expect(buildStripeCardOnlyConfigurationUpdateParams(normalized)).toMatchObject({
      link: { display_preference: { preference: "off" } },
    });
  });

  it("is read-only by default and creates then verifies an exact sandbox configuration", async () => {
    const created = setupPaymentMethodConfiguration({
      id: "pmc_created",
      methodPreferences: { card: "on", link: "on" },
    });
    const exact = setupPaymentMethodConfiguration({
      id: "pmc_created",
      methodPreferences: { card: "on", link: "off" },
    });
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      listConfigurations: vi.fn().mockResolvedValue([]),
      createConfiguration: vi.fn().mockResolvedValue(created),
      updateConfiguration: vi.fn().mockResolvedValue(exact),
    };

    await expect(
      reconcileStripePaymentMethodConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        apply: false,
      }),
    ).resolves.toEqual({ action: "create", applied: false, configurationId: null });
    expect(client.createConfiguration).not.toHaveBeenCalled();
    expect(client.updateConfiguration).not.toHaveBeenCalled();

    await expect(
      reconcileStripePaymentMethodConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        apply: true,
      }),
    ).resolves.toEqual({
      action: "create",
      applied: true,
      configurationId: "pmc_created",
    });
    expect(client.createConfiguration).toHaveBeenCalledWith(
      buildStripeCardOnlyConfigurationCreateParams(),
      "habla:payment-method-configuration:card-only:v1",
    );
    expect(client.updateConfiguration).toHaveBeenCalledWith(
      "pmc_created",
      buildStripeCardOnlyConfigurationUpdateParams(created),
    );
  });

  it("reuses an exact configuration without writing", async () => {
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      listConfigurations: vi
        .fn()
        .mockResolvedValue([setupPaymentMethodConfiguration()]),
      createConfiguration: vi.fn(),
      updateConfiguration: vi.fn(),
    };
    await expect(
      reconcileStripePaymentMethodConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        apply: true,
      }),
    ).resolves.toEqual({
      action: "unchanged",
      applied: false,
      configurationId: "pmc_habla_card_only",
    });
    expect(client.createConfiguration).not.toHaveBeenCalled();
    expect(client.updateConfiguration).not.toHaveBeenCalled();
  });

  it("reconciles a named drifted configuration instead of creating a duplicate", async () => {
    const drifted = setupPaymentMethodConfiguration({
      id: "pmc_drifted",
      active: false,
      methodPreferences: { card: "off", link: "on" },
    });
    const exact = setupPaymentMethodConfiguration({
      id: "pmc_drifted",
      methodPreferences: { card: "on", link: "off" },
    });
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      listConfigurations: vi.fn().mockResolvedValue([drifted]),
      createConfiguration: vi.fn(),
      updateConfiguration: vi.fn().mockResolvedValue(exact),
    };
    await expect(
      reconcileStripePaymentMethodConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        apply: true,
      }),
    ).resolves.toEqual({
      action: "update",
      applied: true,
      configurationId: "pmc_drifted",
    });
    expect(client.createConfiguration).not.toHaveBeenCalled();
    expect(client.updateConfiguration).toHaveBeenCalledWith(
      "pmc_drifted",
      buildStripeCardOnlyConfigurationUpdateParams(drifted),
    );
  });

  it("allows exact live Payment Method setup only through the separately authorized path", async () => {
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      listConfigurations: vi
        .fn()
        .mockResolvedValue([
          setupPaymentMethodConfiguration({ id: "pmc_live", livemode: true }),
        ]),
      createConfiguration: vi.fn(),
      updateConfiguration: vi.fn(),
    };

    await expect(
      reconcileStripePaymentMethodConfiguration({
        client,
        keyMode: "live",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        apply: true,
        allowLiveProvisioning: true,
      }),
    ).resolves.toEqual({
      action: "unchanged",
      applied: false,
      configurationId: "pmc_live",
    });
    expect(client.createConfiguration).not.toHaveBeenCalled();
  });

  it("uses a live-specific idempotency key when creating an authorized live configuration", async () => {
    const created = setupPaymentMethodConfiguration({
      id: "pmc_live_created",
      livemode: true,
    });
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      listConfigurations: vi.fn().mockResolvedValue([]),
      createConfiguration: vi.fn().mockResolvedValue(created),
      updateConfiguration: vi.fn(),
    };

    await expect(
      reconcileStripePaymentMethodConfiguration({
        client,
        keyMode: "live",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        apply: true,
        allowLiveProvisioning: true,
      }),
    ).resolves.toMatchObject({
      action: "create",
      applied: true,
      configurationId: "pmc_live_created",
    });
    expect(client.createConfiguration).toHaveBeenCalledWith(
      buildStripeCardOnlyConfigurationCreateParams(),
      "habla:live:payment-method-configuration:card-only:v1",
    );
  });

  it("fails before listing or writing for live mode or an account mismatch", async () => {
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue("acct_wrong_sandbox"),
      listConfigurations: vi.fn(),
      createConfiguration: vi.fn(),
      updateConfiguration: vi.fn(),
    };
    await expect(
      reconcileStripePaymentMethodConfiguration({
        client,
        keyMode: "live",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        apply: true,
      }),
    ).rejects.toThrow("Refusing to provision a live");
    expect(client.retrieveAccountId).not.toHaveBeenCalled();

    await expect(
      reconcileStripePaymentMethodConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        apply: true,
      }),
    ).rejects.toThrow("account mismatch");
    expect(client.listConfigurations).not.toHaveBeenCalled();
    expect(client.createConfiguration).not.toHaveBeenCalled();
    expect(client.updateConfiguration).not.toHaveBeenCalled();
  });
});

describe("Stripe Portal sandbox setup", () => {
  it("rejects live and malformed setup keys", () => {
    expect(() => assertStripePortalTestKey("sk_live_secret")).toThrow("test-mode only");
    expect(() => assertStripePortalTestKey("not_a_key")).toThrow("test or sandbox");
    expect(assertStripePortalTestKey("rkcs_test_habla")).toBe("rkcs_test_habla");
  });

  it("builds the exact safe configuration payload", () => {
    expect(buildStripePortalConfigurationCreateParams("pmc_habla_card_only")).toEqual({
      name: "Habla teacher billing portal v3",
      default_return_url: "https://tryhabla.com/billing",
      business_profile: {
        headline: "Manage your Habla teacher billing.",
        privacy_policy_url: "https://tryhabla.com/privacy",
        terms_of_service_url: "https://tryhabla.com/terms",
      },
      login_page: { enabled: true },
      metadata: { ...STRIPE_PORTAL_CONFIGURATION_MANIFEST.metadata },
      features: {
        customer_update: {
          enabled: true,
          allowed_updates: ["address", "name", "tax_id"],
        },
        invoice_history: { enabled: true },
        payment_method_update: {
          enabled: true,
          payment_method_configuration: "pmc_habla_card_only",
        },
        subscription_cancel: {
          enabled: true,
          mode: "at_period_end",
          proration_behavior: "none",
        },
        subscription_update: { enabled: false },
      },
    });
    expect(
      buildStripePortalConfigurationIdempotencyKey(
        "test",
        "pmc_habla_card_only",
      ),
    ).not.toBe(
      buildStripePortalConfigurationIdempotencyKey(
        "live",
        "pmc_habla_card_only",
      ),
    );
    expect(
      buildStripePortalConfigurationIdempotencyKey(
        "test",
        "pmc_habla_card_only",
      ),
    ).not.toBe(
      buildStripePortalConfigurationIdempotencyKey("test", "pmc_other"),
    );
  });

  it("reuses an exact active test configuration without writing", async () => {
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      retrievePaymentMethodConfiguration: vi
        .fn()
        .mockResolvedValue(setupPaymentMethodConfiguration()),
      retrieveConfiguration: vi.fn(),
      listActiveConfigurations: vi.fn().mockResolvedValue([portalConfiguration()]),
      createConfiguration: vi.fn(),
    };

    await expect(
      reconcileStripePortalConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        paymentMethodConfigurationId: "pmc_habla_card_only",
        apply: true,
      }),
    ).resolves.toEqual({
      action: "unchanged",
      applied: false,
      configurationId: "bpc_habla_v1",
    });
    expect(client.createConfiguration).not.toHaveBeenCalled();
  });

  it("plans safely, then creates with a stable idempotency key", async () => {
    const created = portalConfiguration({ id: "bpc_created" });
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      retrievePaymentMethodConfiguration: vi
        .fn()
        .mockResolvedValue(setupPaymentMethodConfiguration()),
      retrieveConfiguration: vi.fn().mockResolvedValue(created),
      listActiveConfigurations: vi.fn().mockResolvedValue([
        portalConfiguration({ loginPageEnabled: false }),
      ]),
      createConfiguration: vi.fn().mockResolvedValue(created),
    };

    await expect(
      reconcileStripePortalConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        paymentMethodConfigurationId: "pmc_habla_card_only",
        apply: false,
      }),
    ).resolves.toEqual({ action: "create", applied: false, configurationId: null });
    expect(client.createConfiguration).not.toHaveBeenCalled();

    await expect(
      reconcileStripePortalConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        paymentMethodConfigurationId: "pmc_habla_card_only",
        apply: true,
      }),
    ).resolves.toEqual({
      action: "create",
      applied: true,
      configurationId: "bpc_created",
    });
    expect(client.createConfiguration).toHaveBeenCalledWith(
      buildStripePortalConfigurationCreateParams("pmc_habla_card_only"),
      buildStripePortalConfigurationIdempotencyKey(
        "test",
        "pmc_habla_card_only",
      ),
    );
    expect(client.retrieveConfiguration).toHaveBeenCalledWith("bpc_created");
  });

  it("re-reads an idempotent create result and rejects remote Portal drift", async () => {
    const created = portalConfiguration({ id: "bpc_cached" });
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      retrievePaymentMethodConfiguration: vi
        .fn()
        .mockResolvedValue(setupPaymentMethodConfiguration()),
      retrieveConfiguration: vi
        .fn()
        .mockResolvedValue(
          portalConfiguration({ id: "bpc_cached", defaultReturnUrl: null }),
        ),
      listActiveConfigurations: vi.fn().mockResolvedValue([]),
      createConfiguration: vi.fn().mockResolvedValue(created),
    };

    await expect(
      reconcileStripePortalConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        paymentMethodConfigurationId: "pmc_habla_card_only",
        apply: true,
      }),
    ).rejects.toMatchObject({
      code: "portal_configuration_contract_mismatch",
    });
    expect(client.retrieveConfiguration).toHaveBeenCalledWith("bpc_cached");
  });

  it("allows exact live Portal provisioning only through the separately authorized path", async () => {
    const livePortal = portalConfiguration({
      id: "bpc_live",
      livemode: true,
      paymentMethodConfigurationId: "pmc_live",
    });
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      retrievePaymentMethodConfiguration: vi
        .fn()
        .mockResolvedValue(
          setupPaymentMethodConfiguration({ id: "pmc_live", livemode: true }),
        ),
      retrieveConfiguration: vi.fn().mockResolvedValue(livePortal),
      listActiveConfigurations: vi.fn().mockResolvedValue([]),
      createConfiguration: vi.fn().mockResolvedValue(livePortal),
    };

    await expect(
      reconcileStripePortalConfiguration({
        client,
        keyMode: "live",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        paymentMethodConfigurationId: "pmc_live",
        apply: true,
        allowLiveProvisioning: true,
      }),
    ).resolves.toEqual({
      action: "create",
      applied: true,
      configurationId: "bpc_live",
    });
  });

  it("refuses live mode before reading or writing", async () => {
    const client = {
      retrieveAccountId: vi.fn(),
      retrievePaymentMethodConfiguration: vi.fn(),
      retrieveConfiguration: vi.fn(),
      listActiveConfigurations: vi.fn(),
      createConfiguration: vi.fn(),
    };
    await expect(
      reconcileStripePortalConfiguration({
        client,
        keyMode: "live",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        paymentMethodConfigurationId: "pmc_habla_card_only",
        apply: true,
      }),
    ).rejects.toThrow(/Refusing to provision a live Stripe Portal configuration/);
    expect(client.retrieveAccountId).not.toHaveBeenCalled();
    expect(client.retrievePaymentMethodConfiguration).not.toHaveBeenCalled();
    expect(client.listActiveConfigurations).not.toHaveBeenCalled();
    expect(client.createConfiguration).not.toHaveBeenCalled();
  });

  it("verifies the exact account before reading Portal dependencies or configurations", async () => {
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue("acct_wrong"),
      retrievePaymentMethodConfiguration: vi.fn(),
      retrieveConfiguration: vi.fn(),
      listActiveConfigurations: vi.fn(),
      createConfiguration: vi.fn(),
    };
    await expect(
      reconcileStripePortalConfiguration({
        client,
        keyMode: "live",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        paymentMethodConfigurationId: "pmc_live",
        apply: true,
        allowLiveProvisioning: true,
      }),
    ).rejects.toThrow(/account mismatch/);
    expect(client.retrievePaymentMethodConfiguration).not.toHaveBeenCalled();
    expect(client.retrieveConfiguration).not.toHaveBeenCalled();
    expect(client.listActiveConfigurations).not.toHaveBeenCalled();
    expect(client.createConfiguration).not.toHaveBeenCalled();
  });

  it("refuses to pin a drifted payment-method configuration before Portal writes", async () => {
    const client = {
      retrieveAccountId: vi.fn().mockResolvedValue(ENV.STRIPE_ACCOUNT_ID),
      retrievePaymentMethodConfiguration: vi.fn().mockResolvedValue(
        setupPaymentMethodConfiguration({
          methodPreferences: { card: "on", link: "on" },
        }),
      ),
      retrieveConfiguration: vi.fn(),
      listActiveConfigurations: vi.fn(),
      createConfiguration: vi.fn(),
    };
    await expect(
      reconcileStripePortalConfiguration({
        client,
        keyMode: "test",
        accountId: ENV.STRIPE_ACCOUNT_ID,
        paymentMethodConfigurationId: "pmc_habla_card_only",
        apply: true,
      }),
    ).rejects.toThrow("exact card-only contract");
    expect(client.listActiveConfigurations).not.toHaveBeenCalled();
    expect(client.createConfiguration).not.toHaveBeenCalled();
  });
});

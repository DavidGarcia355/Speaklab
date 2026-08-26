import { describe, expect, it } from "vitest";
import {
  STRIPE_API_VERSION,
  STRIPE_BILLING_CONTRACT_SCHEMA,
  STRIPE_CATALOG_MANIFEST,
  StripeBillingConfigurationError,
  buildBillingPortalSessionParams,
  buildCheckoutSessionParams,
  constructWebhookEvent,
  getStripeBillingContractId,
  getStripeCatalogAvailability,
  getStripeCheckoutAvailability,
  getStripeClient,
  getStripeClientAvailability,
  getStripePortalAvailability,
  getStripeSubscriptionBillingAvailability,
  getStripeUsageBillingAvailability,
  getStripeWebhookAvailability,
  requireStripeCheckoutConfig,
  requireStripePortalConfig,
  requireStripeSubscriptionBillingConfig,
  requireStripeUsageBillingConfig,
} from "@/lib/billing";

const CLIENT_ENV = Object.freeze({
  NODE_ENV: "test",
  STRIPE_SECRET_KEY: "sk_test_habla",
  STRIPE_ACCOUNT_ID: "acct_habla_test",
});

const CATALOG_ENV = Object.freeze({
  ...CLIENT_ENV,
  STRIPE_TRYHABLA_TEACHER_PRICE_ID: "price_teacher_monthly",
  STRIPE_AUTOMATIC_TAX_ENABLED: "false",
});

const SUBSCRIPTION_ENV = Object.freeze({
  ...CATALOG_ENV,
  STRIPE_SUBSCRIPTION_BILLING_ENABLED: "true",
  STRIPE_WEBHOOK_SECRET: "whsec_habla",
});

const CHECKOUT_ENV = Object.freeze({
  ...SUBSCRIPTION_ENV,
  STRIPE_CHECKOUT_ENABLED: "true",
});

const PORTAL_ENV = Object.freeze({
  ...CLIENT_ENV,
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_habla_v1",
  STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_habla_v1",
});

describe("Stripe fixed-subscription runtime", () => {
  it("keeps independent capabilities disabled or unavailable until configured", () => {
    expect(getStripeSubscriptionBillingAvailability({})).toMatchObject({
      available: false,
      reason: "disabled",
    });
    expect(getStripeCheckoutAvailability({})).toMatchObject({
      available: false,
      reason: "disabled",
    });
    expect(getStripeClientAvailability({})).toMatchObject({
      available: false,
      reason: "not_configured",
    });
    expect(getStripeUsageBillingAvailability(SUBSCRIPTION_ENV)).toMatchObject({
      available: false,
      reason: "disabled",
    });
  });

  it("enables licensed billing without CRON_SECRET or meter configuration", () => {
    expect(getStripeSubscriptionBillingAvailability(SUBSCRIPTION_ENV)).toMatchObject({
      available: true,
      keyMode: "test",
      automaticTaxEnabled: false,
      subscriptionBillingEnabled: true,
    });

    const config = requireStripeSubscriptionBillingConfig(SUBSCRIPTION_ENV);
    expect(config).toMatchObject({
      enabled: true,
      subscriptionBillingEnabled: true,
      accountId: "acct_habla_test",
      priceIds: { teacher: "price_teacher_monthly" },
    });
    expect("cronSecret" in config).toBe(false);
  });

  it("rejects every obsolete billing switch and metered Price variable", () => {
    expect(
      getStripeSubscriptionBillingAvailability({
        ...SUBSCRIPTION_ENV,
        STRIPE_USAGE_BILLING_ENABLED: "true",
      }),
    ).toMatchObject({
      available: false,
      reason: "invalid_configuration",
      issues: [expect.stringContaining("STRIPE_USAGE_BILLING_ENABLED is obsolete")],
    });
    expect(
      getStripeSubscriptionBillingAvailability({
        ...SUBSCRIPTION_ENV,
        STRIPE_USAGE_BILLING_ENABLED: "false",
      }),
    ).toMatchObject({ available: false, reason: "invalid_configuration" });
    expect(
      getStripeSubscriptionBillingAvailability({
        ...SUBSCRIPTION_ENV,
        STRIPE_AI_GRADE_PRICE_ID: "price_retired_grade",
        STRIPE_AI_AUDIO_SECONDS_PRICE_ID: "price_retired_audio",
      }),
    ).toMatchObject({
      available: false,
      reason: "invalid_configuration",
      issues: [
        expect.stringContaining("STRIPE_AI_GRADE_PRICE_ID is obsolete"),
        expect.stringContaining("STRIPE_AI_AUDIO_SECONDS_PRICE_ID is obsolete"),
      ],
    });
    expect(() =>
      requireStripeUsageBillingConfig({
        ...SUBSCRIPTION_ENV,
        STRIPE_USAGE_BILLING_ENABLED: "true",
      }),
    ).toThrow(StripeBillingConfigurationError);
  });

  it("fails migration-safe on the old master switch", () => {
    expect(
      getStripeSubscriptionBillingAvailability({
        ...SUBSCRIPTION_ENV,
        STRIPE_BILLING_ENABLED: "true",
      }),
    ).toMatchObject({
      available: false,
      reason: "invalid_configuration",
      issues: [expect.stringContaining("STRIPE_BILLING_ENABLED is obsolete")],
    });
    expect(
      getStripeSubscriptionBillingAvailability({
        ...SUBSCRIPTION_ENV,
        STRIPE_BILLING_ENABLED: "false",
      }),
    ).toMatchObject({ available: true });
  });

  it("requires the subscription switch before Checkout can be enabled", () => {
    expect(
      getStripeCheckoutAvailability({
        ...CHECKOUT_ENV,
        STRIPE_SUBSCRIPTION_BILLING_ENABLED: "false",
      }),
    ).toMatchObject({
      available: false,
      reason: "invalid_configuration",
      issues: [expect.stringContaining("requires STRIPE_SUBSCRIPTION_BILLING_ENABLED=true")],
    });
    expect(getStripeCheckoutAvailability(CHECKOUT_ENV)).toMatchObject({
      available: true,
      checkoutEnabled: true,
      subscriptionBillingEnabled: true,
    });
  });

  it("accepts supported restricted test keys and double-gates live keys", () => {
    for (const secretKey of ["sk_test_habla", "rk_test_habla", "rkcs_test_habla"]) {
      expect(getStripeClientAvailability({ ...CLIENT_ENV, STRIPE_SECRET_KEY: secretKey }))
        .toMatchObject({ available: true, keyMode: "test" });
    }

    const live = { ...CLIENT_ENV, STRIPE_SECRET_KEY: "rk_live_habla" };
    expect(getStripeClientAvailability({ ...live, STRIPE_ALLOW_LIVE: "true" })).toMatchObject({
      available: false,
    });
    expect(getStripeClientAvailability({ ...live, NODE_ENV: "production" })).toMatchObject({
      available: false,
    });
    expect(
      getStripeClientAvailability({
        ...live,
        NODE_ENV: "production",
        STRIPE_ALLOW_LIVE: "true",
      }),
    ).toMatchObject({ available: true, keyMode: "live" });
    expect(
      getStripeClientAvailability({
        ...live,
        NODE_ENV: "production",
        STRIPE_ALLOW_LIVE: "true",
        VERCEL: "1",
        VERCEL_ENV: "preview",
      }),
    ).toMatchObject({
      available: false,
      issues: [expect.stringContaining("Vercel production")],
    });
  });

  it("validates catalog, webhook, and Portal capabilities independently", () => {
    expect(getStripeCatalogAvailability(CATALOG_ENV)).toMatchObject({ available: true });
    expect(getStripeWebhookAvailability(SUBSCRIPTION_ENV)).toMatchObject({ available: true });
    expect(getStripePortalAvailability(PORTAL_ENV)).toMatchObject({ available: true });
    expect(
      getStripeWebhookAvailability({ ...SUBSCRIPTION_ENV, STRIPE_WEBHOOK_SECRET: "bad" }),
    ).toMatchObject({ available: false, reason: "invalid_configuration" });
    expect(
      getStripeCatalogAvailability({
        ...CATALOG_ENV,
        STRIPE_AUTOMATIC_TAX_ENABLED: "true",
      }),
    ).toMatchObject({
      available: false,
      issues: [expect.stringContaining("must remain false")],
    });
  });

  it("builds exactly one licensed quantity-one Checkout line with pinned metadata", () => {
    const config = requireStripeCheckoutConfig(CHECKOUT_ENV);
    const params = buildCheckoutSessionParams({
      config,
      teacherEmail: " Teacher@Example.COM ",
      priceBookId: "tryhabla-teacher-usd-v3",
      successUrl: "https://tryhabla.com/teacher?checkout=success",
      cancelUrl: "https://tryhabla.com/pricing?checkout=cancelled",
    });

    expect(STRIPE_API_VERSION).toBe("2026-07-29.dahlia");
    expect(STRIPE_BILLING_CONTRACT_SCHEMA).toBe("tryhabla_billing_contract_v2");
    expect(params.mode).toBe("subscription");
    expect(params.currency).toBe("usd");
    expect(params.adaptive_pricing).toEqual({ enabled: false });
    expect(params.line_items).toEqual([
      { price: "price_teacher_monthly", quantity: 1 },
    ]);
    expect(params.customer_email).toBe("teacher@example.com");
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.consent_collection).toBeUndefined();
    expect(params.metadata).toEqual({
      habla_app: "tryhabla",
      catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      price_book_id: "tryhabla-teacher-usd-v3",
      teacher_email: "teacher@example.com",
      payment_method_policy: "card_only_v1",
      stripe_account_id: "acct_habla_test",
      billing_contract_id: getStripeBillingContractId(config),
    });
    expect(params.subscription_data?.metadata).toEqual(params.metadata);
    expect(params.automatic_tax).toBeUndefined();
  });

  it("changes the entitlement contract when catalog scope changes", () => {
    const config = requireStripeCheckoutConfig(CHECKOUT_ENV);
    const contract = getStripeBillingContractId(config);

    expect(
      getStripeBillingContractId({
        ...config,
        accountId: "acct_other",
      }),
    ).not.toBe(contract);
    expect(
      getStripeBillingContractId({
        ...config,
        priceIds: { teacher: "price_other" },
      }),
    ).not.toBe(contract);
    expect(
      getStripeBillingContractId({
        ...config,
        keyMode: "live",
      }),
    ).not.toBe(contract);
  });

  it("uses an existing Customer and pinned Portal configuration", () => {
    const config = requireStripeCheckoutConfig(CHECKOUT_ENV);
    const checkout = buildCheckoutSessionParams({
      config,
      teacherEmail: "teacher@example.com",
      priceBookId: "tryhabla-teacher-usd-v3",
      successUrl: "https://tryhabla.com/teacher?checkout=success",
      cancelUrl: "https://tryhabla.com/pricing",
      customerId: "cus_existing",
    });
    expect(checkout.customer).toBe("cus_existing");
    expect(checkout.customer_email).toBeUndefined();

    const portalConfig = requireStripePortalConfig(PORTAL_ENV);
    expect(
      buildBillingPortalSessionParams({
        config: portalConfig,
        customerId: "cus_existing",
        returnUrl: "https://tryhabla.com/teacher",
      }),
    ).toEqual({
      configuration: "bpc_habla_v1",
      customer: "cus_existing",
      return_url: "https://tryhabla.com/teacher",
    });
  });

  it("constructs and verifies webhook events locally without a network request", () => {
    const config = requireStripeSubscriptionBillingConfig(SUBSCRIPTION_ENV);
    const payload = JSON.stringify({
      id: "evt_checkout_completed",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_habla", object: "checkout.session" } },
    });
    const stripe = getStripeClient(config);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: config.webhookSecret,
    });

    const event = constructWebhookEvent(payload, signature, config);
    expect(event.id).toBe("evt_checkout_completed");
    expect(event.type).toBe("checkout.session.completed");
    expect(() => constructWebhookEvent(payload, "invalid", config)).toThrow();
  });
});

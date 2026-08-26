import { describe, expect, it } from "vitest";
import {
  STRIPE_API_VERSION,
  STRIPE_CATALOG_MANIFEST,
  StripeBillingConfigurationError,
  buildBillingPortalSessionParams,
  buildCheckoutSessionParams,
  constructWebhookEvent,
  getStripeCatalogAvailability,
  getStripeCheckoutAvailability,
  getStripeClient,
  getStripeClientAvailability,
  getStripeBillingContractId,
  getStripePortalAvailability,
  getStripeUsageBillingAvailability,
  getStripeWebhookAvailability,
  requireStripeCheckoutConfig,
  requireStripePortalConfig,
  requireStripeUsageBillingConfig,
  type StripeBillingEnv,
} from "@/lib/billing";

const CAPABILITY_ENV: StripeBillingEnv = {
  NODE_ENV: "test",
  STRIPE_SECRET_KEY: "sk_test_habla",
  STRIPE_ACCOUNT_ID: "acct_habla_test",
  STRIPE_WEBHOOK_SECRET: "whsec_habla",
  STRIPE_AI_GRADE_PRICE_ID: "price_ai_grade",
  STRIPE_AI_AUDIO_SECONDS_PRICE_ID: "price_audio_minute",
};

const USAGE_ENV: StripeBillingEnv = {
  ...CAPABILITY_ENV,
  STRIPE_USAGE_BILLING_ENABLED: "true",
  CRON_SECRET: "test-cron-secret",
};

const PORTAL_ENV: StripeBillingEnv = {
  ...CAPABILITY_ENV,
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_habla_v1",
  STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_habla_card_only",
};

const CHECKOUT_ENV: StripeBillingEnv = {
  ...USAGE_ENV,
  STRIPE_CHECKOUT_ENABLED: "true",
};

describe("Stripe billing runtime", () => {
  it("keeps credentials, webhook signing, and catalog configuration independent of flags", () => {
    expect(getStripeClientAvailability(CAPABILITY_ENV)).toMatchObject({
      available: true,
      keyMode: "test",
    });
    expect(getStripeWebhookAvailability(CAPABILITY_ENV)).toMatchObject({ available: true });
    expect(getStripeCatalogAvailability(CAPABILITY_ENV)).toMatchObject({ available: true });
    expect(getStripePortalAvailability(CAPABILITY_ENV)).toMatchObject({
      available: false,
      issues: expect.arrayContaining([
        expect.stringContaining("STRIPE_PORTAL_CONFIGURATION_ID"),
        expect.stringContaining("STRIPE_PAYMENT_METHOD_CONFIGURATION_ID"),
      ]),
    });
    expect(getStripeUsageBillingAvailability(CAPABILITY_ENV)).toEqual({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    expect(getStripeCheckoutAvailability(CAPABILITY_ENV)).toEqual({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    expect(getStripeClientAvailability({})).toMatchObject({
      available: false,
      reason: "not_configured",
    });
  });

  it("keeps the pinned Portal capability independent of webhook and usage configuration", () => {
    expect(getStripePortalAvailability(PORTAL_ENV)).toMatchObject({
      available: true,
      keyMode: "test",
      portalConfigurationId: "bpc_habla_v1",
      paymentMethodConfigurationId: "pmc_habla_card_only",
    });
    const invalidPortalEnv = {
      ...PORTAL_ENV,
      STRIPE_PORTAL_CONFIGURATION_ID: "portal_wrong",
    };
    expect(getStripePortalAvailability(invalidPortalEnv)).toMatchObject({
      available: false,
      reason: "invalid_configuration",
      issues: [expect.stringContaining("bpc_")],
    });
    expect(getStripeClientAvailability(invalidPortalEnv)).toMatchObject({ available: true });
    expect(getStripeWebhookAvailability(invalidPortalEnv)).toMatchObject({ available: true });
  });

  it("gates usage billing and requires it before enabling Checkout acquisition", () => {
    expect(getStripeUsageBillingAvailability(USAGE_ENV)).toMatchObject({
      available: true,
      usageBillingEnabled: true,
    });
    expect(getStripeCheckoutAvailability(CHECKOUT_ENV)).toMatchObject({
      available: true,
      usageBillingEnabled: true,
      checkoutEnabled: true,
    });
    expect(
      getStripeCheckoutAvailability({
        ...CAPABILITY_ENV,
        STRIPE_CHECKOUT_ENABLED: "true",
      }),
    ).toMatchObject({
      available: false,
      reason: "invalid_configuration",
      issues: [expect.stringContaining("STRIPE_USAGE_BILLING_ENABLED")],
    });

    const missingRecoverySecret = { ...USAGE_ENV };
    delete missingRecoverySecret.CRON_SECRET;
    expect(getStripeUsageBillingAvailability(missingRecoverySecret)).toMatchObject({
      enabled: true,
      available: false,
      reason: "invalid_configuration",
      issues: [expect.stringContaining("CRON_SECRET")],
    });
    expect(
      getStripeCheckoutAvailability({
        ...missingRecoverySecret,
        STRIPE_CHECKOUT_ENABLED: "true",
      }),
    ).toMatchObject({
      available: false,
      reason: "invalid_configuration",
      issues: [expect.stringContaining("CRON_SECRET")],
    });
  });

  it("fails migration-safe on the old master switch while ignoring explicit false", () => {
    const legacy = getStripeUsageBillingAvailability({
      ...USAGE_ENV,
      STRIPE_BILLING_ENABLED: "true",
    });
    expect(legacy).toMatchObject({ available: false, reason: "invalid_configuration" });
    expect(legacy.issues).toEqual([
      expect.stringContaining("STRIPE_BILLING_ENABLED is obsolete"),
    ]);
    expect(
      getStripeUsageBillingAvailability({
        ...USAGE_ENV,
        STRIPE_BILLING_ENABLED: "false",
      }),
    ).toMatchObject({ available: true });
  });

  it("accepts supported restricted test keys and double-gates live keys", () => {
    for (const secretKey of ["sk_test_habla", "rk_test_habla", "rkcs_test_habla"]) {
      expect(getStripeClientAvailability({ ...CAPABILITY_ENV, STRIPE_SECRET_KEY: secretKey }))
        .toMatchObject({ available: true, keyMode: "test" });
    }
    expect(
      getStripeClientAvailability({
        ...CAPABILITY_ENV,
        STRIPE_SECRET_KEY: "rkcs_live_unrecognized",
      }),
    ).toMatchObject({ available: false, reason: "invalid_configuration" });

    const live = { ...CAPABILITY_ENV, STRIPE_SECRET_KEY: "rk_live_habla" };
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
    expect(
      getStripeClientAvailability({
        ...live,
        NODE_ENV: "production",
        STRIPE_ALLOW_LIVE: "true",
        VERCEL: "1",
        VERCEL_ENV: "production",
      }),
    ).toMatchObject({ available: true, keyMode: "live" });
    expect(
      getStripeClientAvailability({
        ...CAPABILITY_ENV,
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
      }),
    ).toMatchObject({
      available: false,
      issues: [expect.stringContaining("test keys")],
    });
  });

  it("validates each capability strictly without exposing configured values", () => {
    expect(
      getStripeWebhookAvailability({ ...CAPABILITY_ENV, STRIPE_WEBHOOK_SECRET: "bad" }),
    ).toMatchObject({ available: false, reason: "invalid_configuration" });
    expect(
      getStripeCatalogAvailability({
        ...CAPABILITY_ENV,
        STRIPE_AUTOMATIC_TAX_ENABLED: "yes",
      }),
    ).toMatchObject({ available: false, reason: "invalid_configuration" });
    expect(
      getStripeCatalogAvailability({
        ...CAPABILITY_ENV,
        STRIPE_AI_AUDIO_SECONDS_PRICE_ID: "price_ai_grade",
      }),
    ).toMatchObject({ available: false, reason: "invalid_configuration" });
    expect(() => requireStripeUsageBillingConfig({})).toThrow(
      StripeBillingConfigurationError,
    );
  });

  it("builds two quantity-free metered Checkout items with server metadata", () => {
    const config = requireStripeCheckoutConfig(CHECKOUT_ENV);
    const params = buildCheckoutSessionParams({
      config,
      teacherEmail: " Teacher@Example.COM ",
      priceBookId: "habla-teacher-ai-usd-v2",
      successUrl: "https://tryhabla.com/teacher?checkout=success",
      cancelUrl: "https://tryhabla.com/pricing?checkout=cancelled",
    });

    expect(STRIPE_API_VERSION).toBe("2026-07-29.dahlia");
    expect(params.mode).toBe("subscription");
    expect(params.currency).toBe("usd");
    expect(params.adaptive_pricing).toEqual({ enabled: false });
    expect(params.line_items).toEqual([
      { price: "price_ai_grade" },
      { price: "price_audio_minute" },
    ]);
    expect(params.line_items?.every((item) => !("quantity" in item))).toBe(true);
    expect(params.customer_email).toBe("teacher@example.com");
    expect(params.customer).toBeUndefined();
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.consent_collection).toEqual({ terms_of_service: "required" });
    expect(params.metadata).toEqual({
      habla_app: "tryhabla",
      catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      price_book_id: "habla-teacher-ai-usd-v2",
      teacher_email: "teacher@example.com",
      payment_method_policy: "card_only_v1",
      stripe_account_id: "acct_habla_test",
      billing_contract_id: getStripeBillingContractId(config),
    });
    expect(params.subscription_data?.metadata).toEqual(params.metadata);
    expect(params.automatic_tax).toBeUndefined();
  });

  it("uses an existing customer and pure pinned Portal parameters", () => {
    const config = requireStripeCheckoutConfig(CHECKOUT_ENV);
    const checkout = buildCheckoutSessionParams({
      config,
      teacherEmail: "teacher@example.com",
      priceBookId: "habla-teacher-ai-usd-v2",
      successUrl: "https://tryhabla.com/teacher?checkout=success",
      cancelUrl: "https://tryhabla.com/pricing",
      customerId: "cus_existing",
    });
    expect(checkout.customer).toBe("cus_existing");
    expect(checkout.customer_email).toBeUndefined();
    expect(checkout.automatic_tax).toBeUndefined();
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

  it("rejects automatic tax until the catalog has explicit reviewed tax behavior", () => {
    expect(
      getStripeCheckoutAvailability({
        ...CHECKOUT_ENV,
        STRIPE_AUTOMATIC_TAX_ENABLED: "true",
      }),
    ).toMatchObject({
      available: false,
      issues: [expect.stringContaining("must remain false")],
    });
  });

  it("constructs and verifies webhook events locally without a network request", () => {
    const config = requireStripeUsageBillingConfig(USAGE_ENV);
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

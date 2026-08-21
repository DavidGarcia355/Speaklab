import { describe, expect, it } from "vitest";
import {
  STRIPE_API_VERSION,
  StripeBillingConfigurationError,
  buildBillingPortalSessionParams,
  buildCheckoutSessionParams,
  constructWebhookEvent,
  getStripeBillingAvailability,
  getStripeClient,
  parseStripeBillingConfig,
  requireStripeBillingConfig,
  type StripeBillingEnv,
} from "@/lib/billing";

const TEST_ENV: StripeBillingEnv = {
  NODE_ENV: "test",
  STRIPE_BILLING_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_habla",
  STRIPE_WEBHOOK_SECRET: "whsec_habla",
  STRIPE_AI_GRADE_PRICE_ID: "price_ai_grade",
  STRIPE_AI_AUDIO_SECONDS_PRICE_ID: "price_audio_minute",
};

describe("Stripe billing runtime", () => {
  it("reports disabled or invalid configuration without throwing", () => {
    expect(getStripeBillingAvailability({})).toEqual({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });

    const invalid = parseStripeBillingConfig({ STRIPE_BILLING_ENABLED: "true" });
    expect(invalid.ok).toBe(false);
    expect(invalid.availability).toMatchObject({
      enabled: true,
      available: false,
      reason: "invalid_configuration",
    });
    expect(invalid.availability.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("STRIPE_SECRET_KEY"),
        expect.stringContaining("STRIPE_WEBHOOK_SECRET"),
        expect.stringContaining("STRIPE_AI_GRADE_PRICE_ID"),
        expect.stringContaining("STRIPE_AI_AUDIO_SECONDS_PRICE_ID"),
      ]),
    );
    expect(() => requireStripeBillingConfig({})).toThrow(StripeBillingConfigurationError);
  });

  it("parses strict booleans and rejects live keys unless explicitly allowed in production", () => {
    expect(
      getStripeBillingAvailability({ ...TEST_ENV, STRIPE_BILLING_ENABLED: "1" }),
    ).toMatchObject({ available: false, reason: "invalid_configuration" });
    expect(
      getStripeBillingAvailability({ ...TEST_ENV, STRIPE_AUTOMATIC_TAX_ENABLED: "yes" }),
    ).toMatchObject({ available: false, reason: "invalid_configuration" });

    const live = { ...TEST_ENV, STRIPE_SECRET_KEY: "sk_live_habla" };
    expect(
      getStripeBillingAvailability({ ...live, STRIPE_ALLOW_LIVE: "true" }),
    ).toMatchObject({ available: false });
    expect(
      getStripeBillingAvailability({ ...live, NODE_ENV: "production" }),
    ).toMatchObject({ available: false });
    expect(
      getStripeBillingAvailability({
        ...live,
        NODE_ENV: "production",
        STRIPE_ALLOW_LIVE: "true",
      }),
    ).toMatchObject({ available: true, keyMode: "live" });
  });

  it("builds two quantity-free metered Checkout items with server metadata", () => {
    const config = requireStripeBillingConfig(TEST_ENV);
    const params = buildCheckoutSessionParams({
      config,
      teacherEmail: " Teacher@Example.COM ",
      priceBookId: "habla-teacher-ai-usd-v2",
      successUrl: "https://tryhabla.com/teacher?checkout=success",
      cancelUrl: "https://tryhabla.com/pricing?checkout=cancelled",
    });

    expect(STRIPE_API_VERSION).toBe("2026-07-29.dahlia");
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([
      { price: "price_ai_grade" },
      { price: "price_audio_minute" },
    ]);
    expect(params.line_items?.every((item) => !("quantity" in item))).toBe(true);
    expect(params.customer_email).toBe("teacher@example.com");
    expect(params.customer).toBeUndefined();
    expect(params.metadata).toEqual({
      price_book_id: "habla-teacher-ai-usd-v2",
      teacher_email: "teacher@example.com",
    });
    expect(params.subscription_data?.metadata).toEqual(params.metadata);
    expect(params.automatic_tax).toBeUndefined();
  });

  it("uses an existing customer, optional automatic tax, and pure portal parameters", () => {
    const config = requireStripeBillingConfig({
      ...TEST_ENV,
      STRIPE_AUTOMATIC_TAX_ENABLED: "true",
    });
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
    expect(checkout.automatic_tax).toEqual({ enabled: true });

    expect(
      buildBillingPortalSessionParams({
        customerId: "cus_existing",
        returnUrl: "https://tryhabla.com/teacher",
      }),
    ).toEqual({
      customer: "cus_existing",
      return_url: "https://tryhabla.com/teacher",
    });
  });

  it("constructs and verifies webhook events locally without a network request", () => {
    const config = requireStripeBillingConfig(TEST_ENV);
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

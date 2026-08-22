import { describe, expect, it } from "vitest";
import { canStartStripeCheckout } from "@/app/billing/BillingPanel";

describe("BillingPanel Checkout eligibility", () => {
  it("allows a manual pilot account with no Stripe subscription to start Checkout", () => {
    expect(canStartStripeCheckout(null)).toBe(true);
  });

  it("allows Checkout again after a canceled or expired incomplete subscription", () => {
    expect(canStartStripeCheckout("canceled")).toBe(true);
    expect(canStartStripeCheckout("incomplete_expired")).toBe(true);
  });

  it("does not offer a second Checkout for an existing Stripe subscription", () => {
    expect(canStartStripeCheckout("active")).toBe(false);
    expect(canStartStripeCheckout("trialing")).toBe(false);
    expect(canStartStripeCheckout("past_due")).toBe(false);
  });
});

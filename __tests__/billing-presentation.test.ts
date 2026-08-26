import { describe, expect, it } from "vitest";
import {
  billingStatusConfirmsAccess,
  deriveBillingPresentation,
  type BillingStatus,
} from "@/lib/billing/presentation";

const baseStatus: BillingStatus = {
  clientConfigured: true,
  runtimeAvailable: true,
  portalAvailable: false,
  checkoutAvailable: true,
  checkoutUnavailableReason: null,
  mode: "live",
  accountIssue: null,
  priceBook: {
    id: "tryhabla-teacher-usd-v3",
    effectiveAt: "2026-08-26",
  },
  access: "inactive",
  subscriptionStatus: null,
  periodEnd: null,
  usage: {
    allowanceKind: "free_lifetime",
    limit: 30,
    reservedReviews: 0,
    consumedReviews: 0,
    usedReviews: 0,
    remainingReviews: 30,
    periodStart: null,
    periodEnd: null,
  },
};

function status(overrides: Partial<BillingStatus> = {}): BillingStatus {
  return {
    ...baseStatus,
    ...overrides,
    priceBook: overrides.priceBook ?? baseStatus.priceBook,
    usage: overrides.usage ?? baseStatus.usage,
  };
}

describe("billing presentation", () => {
  it("offers Checkout only for a clean inactive account", () => {
    const presentation = deriveBillingPresentation(status());

    expect(presentation).toMatchObject({
      heading: "Start with 30 free AI reviews",
      showCheckout: true,
      showPortal: false,
      showPayPal: false,
      showRefresh: false,
    });
  });

  it("never treats a return query as proof of completion", () => {
    const returned = deriveBillingPresentation(status(), "returned");
    expect(returned.notice).toMatchObject({
      tone: "neutral",
      text: expect.stringContaining("waiting for signed confirmation"),
    });
    expect(returned.notice?.text).not.toMatch(/checkout completed/i);
    expect(returned.showCheckout).toBe(false);
    expect(returned.showPayPal).toBe(false);

    const timedOut = deriveBillingPresentation(status(), "timed_out");
    expect(timedOut.notice).toMatchObject({
      tone: "warning",
      text: expect.stringContaining("has not reached Habla"),
    });
    expect(timedOut).toMatchObject({
      showCheckout: false,
      showRefresh: true,
      showSupport: true,
    });
  });

  it("shows confirmation only when status grants Stripe access", () => {
    const active = status({
      access: "active",
      subscriptionStatus: "active",
      portalAvailable: true,
      checkoutAvailable: false,
      checkoutUnavailableReason: "This account already has a Stripe subscription.",
    });
    const presentation = deriveBillingPresentation(active, "returned");

    expect(presentation.notice).toMatchObject({
      tone: "success",
      text: expect.stringContaining("confirmation was received"),
    });
    expect(presentation).toMatchObject({
      subscribed: true,
      heading: "Teacher is active",
      showCheckout: false,
      showPortal: true,
      portalIsPrimary: true,
      availabilityNote: null,
    });
    expect(billingStatusConfirmsAccess(active)).toBe(true);
    expect(billingStatusConfirmsAccess(status({ access: "pilot" }))).toBe(false);
  });

  it("keeps cancellation copy neutral and permits a fresh eligible Checkout", () => {
    const presentation = deriveBillingPresentation(status(), "cancelled");

    expect(presentation.notice?.text).toContain("not completed during this visit");
    expect(presentation.notice?.text).not.toMatch(/subscription was not activated/i);
    expect(presentation.showCheckout).toBe(true);
  });

  it.each([
    ["past_due", "Payment needs attention"],
    ["unpaid", "This subscription is unpaid"],
    ["incomplete", "Finish setting up payment"],
    ["paused", "This Stripe plan is paused"],
  ])("routes %s accounts to Portal recovery", (subscriptionStatus, heading) => {
    const presentation = deriveBillingPresentation(
      status({ subscriptionStatus, portalAvailable: true }),
    );

    expect(presentation).toMatchObject({
      heading,
      showCheckout: false,
      showPortal: true,
      portalIsPrimary: true,
      showPayPal: false,
      showSupport: true,
    });
  });

  it.each([
    ["canceled", "The previous Stripe plan ended"],
    ["incomplete_expired", "The previous Checkout expired"],
  ])("allows a new plan after terminal state %s", (subscriptionStatus, heading) => {
    const presentation = deriveBillingPresentation(
      status({ subscriptionStatus, portalAvailable: true }),
    );

    expect(presentation).toMatchObject({
      heading,
      showCheckout: true,
      showPortal: true,
      portalIsPrimary: false,
    });
  });

  it("keeps Portal independent when new billing is paused", () => {
    const presentation = deriveBillingPresentation(
      status({
        clientConfigured: true,
        runtimeAvailable: false,
        portalAvailable: true,
        checkoutAvailable: false,
        accountIssue: "billing_paused",
        subscriptionStatus: "active",
      }),
    );

    expect(presentation).toMatchObject({
      showCheckout: false,
      showPortal: true,
      portalIsPrimary: true,
      showSupport: true,
    });
    expect(presentation.availabilityNote).toContain("Existing customers can still open Manage billing");
  });

  it("fails closed and explains price-book or catalog verification issues", () => {
    const mismatch = deriveBillingPresentation(
      status({
        portalAvailable: true,
        checkoutAvailable: false,
        accountIssue: "price_book_mismatch",
        subscriptionStatus: "active",
      }),
    );
    expect(mismatch).toMatchObject({
      heading: "This Stripe plan needs review",
      showCheckout: false,
      showPortal: true,
      showSupport: true,
    });
    expect(mismatch.availabilityNote).toContain("does not match");

    const unverified = deriveBillingPresentation(
      status({ checkoutAvailable: false, accountIssue: "catalog_unverified" }),
    );
    expect(unverified).toMatchObject({
      heading: "Stripe pricing is being verified",
      showCheckout: false,
      showSupport: true,
    });
    expect(unverified.availabilityNote).toContain("verifying the Stripe catalog");
  });

  it.each(["mode_mismatch", "account_mismatch", "billing_contract_mismatch"] as const)(
    "fails closed with explicit support copy for %s",
    (accountIssue) => {
      const presentation = deriveBillingPresentation(
        status({
          checkoutAvailable: false,
          portalAvailable: false,
          accountIssue,
          subscriptionStatus: "active",
        }),
      );

      expect(presentation).toMatchObject({
        heading: "This Stripe account needs review",
        showCheckout: false,
        showPortal: false,
        showSupport: true,
      });
      expect(presentation.availabilityNote).toContain("verified Stripe billing scope");
    },
  );

  it("shows voluntary support only when no Stripe account action is available", () => {
    const presentation = deriveBillingPresentation(
      status({
        clientConfigured: false,
        runtimeAvailable: false,
        checkoutAvailable: false,
        checkoutUnavailableReason: "AI grading is temporarily unavailable.",
      }),
    );

    expect(presentation).toMatchObject({
      showCheckout: false,
      showPortal: false,
      showPayPal: true,
      availabilityNote: "AI grading is temporarily unavailable.",
    });
  });

  it("does not replace an unknown subscription state with a new Checkout", () => {
    const presentation = deriveBillingPresentation(
      status({ subscriptionStatus: "future_stripe_state", portalAvailable: true }),
    );

    expect(presentation).toMatchObject({
      heading: "Billing needs review",
      showCheckout: false,
      showPortal: true,
      portalIsPrimary: true,
      showSupport: false,
    });
  });
});

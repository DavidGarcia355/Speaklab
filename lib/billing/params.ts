import type Stripe from "stripe";
import type { StripeBillingConfig } from "@/lib/billing/config";

export type CheckoutSessionParamsInput = {
  config: StripeBillingConfig;
  teacherEmail: string;
  priceBookId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
};

export type BillingPortalSessionParamsInput = {
  customerId: string;
  returnUrl: string;
};

function requiredText(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  return normalized;
}

function teacherEmail(value: string) {
  const normalized = requiredText(value, "teacherEmail").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new TypeError("teacherEmail must be a valid email address.");
  }
  return normalized;
}

function absoluteHttpUrl(value: string, name: string) {
  const normalized = requiredText(value, name);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL.`);
  }
  return normalized;
}

function customerId(value: string) {
  const normalized = requiredText(value, "customerId");
  if (!normalized.startsWith("cus_")) {
    throw new TypeError("customerId must be a Stripe Customer ID.");
  }
  return normalized;
}

/** Builds hosted Checkout parameters without performing a Stripe API request. */
export function buildCheckoutSessionParams(
  input: CheckoutSessionParamsInput,
): Stripe.Checkout.SessionCreateParams {
  const email = teacherEmail(input.teacherEmail);
  const priceBookId = requiredText(input.priceBookId, "priceBookId");
  const metadata = {
    price_book_id: priceBookId,
    teacher_email: email,
  };
  const existingCustomer =
    input.customerId === null || typeof input.customerId === "undefined"
      ? null
      : customerId(input.customerId);

  return {
    mode: "subscription",
    success_url: absoluteHttpUrl(input.successUrl, "successUrl"),
    cancel_url: absoluteHttpUrl(input.cancelUrl, "cancelUrl"),
    line_items: [
      { price: input.config.priceIds.aiGrade },
      { price: input.config.priceIds.audioMinute },
    ],
    metadata,
    subscription_data: { metadata },
    ...(input.config.automaticTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
    ...(existingCustomer ? { customer: existingCustomer } : { customer_email: email }),
  };
}

/** Builds Customer Portal parameters without performing a Stripe API request. */
export function buildBillingPortalSessionParams(
  input: BillingPortalSessionParamsInput,
): Stripe.BillingPortal.SessionCreateParams {
  return {
    customer: customerId(input.customerId),
    return_url: absoluteHttpUrl(input.returnUrl, "returnUrl"),
  };
}

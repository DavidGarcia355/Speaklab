import type Stripe from "stripe";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import { getStripeBillingContractId } from "@/lib/billing/contract";
import { STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY } from "@/lib/billing/policy";
import type {
  StripeCheckoutConfig,
  StripePortalConfig,
} from "@/lib/billing/config";

export type CheckoutSessionParamsInput = {
  config: StripeCheckoutConfig;
  teacherEmail: string;
  priceBookId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
};

export type BillingPortalSessionParamsInput = {
  config: StripePortalConfig;
  customerId: string;
  returnUrl: string;
};

export { STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY } from "@/lib/billing/policy";

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

function portalConfigurationId(value: string) {
  const normalized = requiredText(value, "portalConfigurationId");
  if (!normalized.startsWith("bpc_")) {
    throw new TypeError("portalConfigurationId must be a Stripe Portal Configuration ID.");
  }
  return normalized;
}

/** Builds hosted Checkout parameters without performing a Stripe API request. */
export function buildCheckoutSessionParams(
  input: CheckoutSessionParamsInput,
): Stripe.Checkout.SessionCreateParams {
  const email = teacherEmail(input.teacherEmail);
  const priceBookId = requiredText(input.priceBookId, "priceBookId");
  if (priceBookId !== STRIPE_CATALOG_MANIFEST.priceBookId) {
    throw new TypeError("priceBookId must match Habla's active Stripe catalog.");
  }
  const metadata = {
    habla_app: "tryhabla",
    price_book_id: priceBookId,
    catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    teacher_email: email,
    payment_method_policy: STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY,
    stripe_account_id: input.config.accountId,
    billing_contract_id: getStripeBillingContractId(input.config),
  };
  const existingCustomer =
    input.customerId === null || typeof input.customerId === "undefined"
      ? null
      : customerId(input.customerId);

  return {
    mode: "subscription",
    currency: STRIPE_CATALOG_MANIFEST.currency,
    payment_method_types: ["card"],
    adaptive_pricing: { enabled: false },
    success_url: absoluteHttpUrl(input.successUrl, "successUrl"),
    cancel_url: absoluteHttpUrl(input.cancelUrl, "cancelUrl"),
    line_items: [
      { price: input.config.priceIds.aiGrade },
      { price: input.config.priceIds.audioMinute },
    ],
    consent_collection: { terms_of_service: "required" },
    metadata,
    subscription_data: { metadata },
    ...(input.config.automaticTaxEnabled
      ? {
          automatic_tax: { enabled: true },
          billing_address_collection: "required" as const,
          ...(existingCustomer
            ? { customer_update: { address: "auto" as const, name: "auto" as const } }
            : {}),
        }
      : {}),
    ...(existingCustomer ? { customer: existingCustomer } : { customer_email: email }),
  };
}

/** Builds Customer Portal parameters without performing a Stripe API request. */
export function buildBillingPortalSessionParams(
  input: BillingPortalSessionParamsInput,
): Stripe.BillingPortal.SessionCreateParams {
  return {
    configuration: portalConfigurationId(input.config.portalConfigurationId),
    customer: customerId(input.customerId),
    return_url: absoluteHttpUrl(input.returnUrl, "returnUrl"),
  };
}

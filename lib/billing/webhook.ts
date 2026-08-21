import type Stripe from "stripe";
import { getStripeClient } from "@/lib/billing/client";
import {
  requireStripeBillingConfig,
  type StripeBillingConfig,
} from "@/lib/billing/config";

export type StripeWebhookPayload = string | Uint8Array;

/** Verifies the signature against the unmodified request body before parsing the event. */
export function constructWebhookEvent(
  rawBody: StripeWebhookPayload,
  signature: string | string[] | Uint8Array,
  config: StripeBillingConfig = requireStripeBillingConfig(),
): Stripe.Event {
  if (typeof rawBody === "string" && rawBody.length === 0) {
    throw new TypeError("Stripe webhook raw body is required.");
  }
  if (rawBody instanceof Uint8Array && rawBody.byteLength === 0) {
    throw new TypeError("Stripe webhook raw body is required.");
  }
  if (typeof signature === "string" && !signature.trim()) {
    throw new TypeError("Stripe-Signature header is required.");
  }

  return getStripeClient(config).webhooks.constructEvent(
    rawBody,
    signature,
    config.webhookSecret,
  );
}

import "server-only";

import { createHash } from "node:crypto";
import type Stripe from "stripe";
import {
  assertAiProviderConfig,
  getAiConfig,
  isAiTeacherDenied,
} from "@/lib/ai/config";
import {
  StripeBillingConfigurationError,
  requireStripeBillingConfig,
  type StripeBillingConfig,
} from "@/lib/billing";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

export function requireBillingConfigForApi(): StripeBillingConfig {
  try {
    return requireStripeBillingConfig();
  } catch (error) {
    if (error instanceof StripeBillingConfigurationError) {
      throw new HttpError(503, "Self-serve billing is not available for this deployment.");
    }
    throw error;
  }
}

export function getAiCheckoutAvailability(teacherEmail?: string) {
  const config = getAiConfig();
  if (!config.enabled) {
    return { available: false as const, reason: "AI grading is not enabled for this deployment." };
  }
  if (config.accessMode !== "paid") {
    return {
      available: false as const,
      reason: "Self-serve Checkout requires AI_ACCESS_MODE=paid.",
    };
  }
  if (teacherEmail && isAiTeacherDenied(teacherEmail, config)) {
    return { available: false as const, reason: "AI access is not available for this account." };
  }
  try {
    assertAiProviderConfig(config);
    return { available: true as const, reason: null };
  } catch {
    return {
      available: false as const,
      reason: "AI provider and student-data prerequisites are not ready.",
    };
  }
}

export function requireAiCheckoutForApi(teacherEmail: string) {
  const availability = getAiCheckoutAvailability(teacherEmail);
  if (!availability.available) {
    throw new HttpError(503, availability.reason);
  }
}

export function canonicalBillingUrl(pathname: string) {
  return new URL(pathname, `${getEnv().productionOrigin}/`).toString();
}

export function billingIdempotencyKey(kind: "customer" | "checkout", teacherEmail: string, version: string) {
  const identityHash = createHash("sha256")
    .update(teacherEmail.trim().toLowerCase())
    .digest("hex");
  return `habla:${kind}:${identityHash}:${version}`;
}

export function stripeObjectId(
  value: string | { id: string } | null,
  expectedPrefix: "cus_" | "sub_",
) {
  const id = typeof value === "string" ? value : value?.id;
  if (!id?.startsWith(expectedPrefix)) return null;
  return id;
}

/** Stripe's current API exposes billing periods on subscription items. */
export function subscriptionPeriodEndMs(subscription: Stripe.Subscription) {
  const itemEnds = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => Number.isSafeInteger(value) && value > 0);
  return itemEnds.length > 0 ? Math.min(...itemEnds) * 1_000 : null;
}

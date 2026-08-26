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
  requireStripeCheckoutConfig,
  requireStripeClientConfig,
  requireStripePortalConfig,
  requireStripeWebhookConfig,
  type StripeCheckoutConfig,
  type StripeClientConfig,
  type StripePortalConfig,
  type StripeWebhookConfig,
} from "@/lib/billing";
import { getEnv } from "@/lib/env";
import {
  assertGradingProviderConfiguration,
  getGradingConfig,
} from "@/lib/grading/config";
import { HttpError } from "@/lib/http";

function requireStripeCapabilityForApi<Config>(
  load: () => Config,
  unavailableMessage: string,
): Config {
  try {
    return load();
  } catch (error) {
    if (error instanceof StripeBillingConfigurationError) {
      throw new HttpError(503, unavailableMessage);
    }
    throw error;
  }
}

export function requireStripeCheckoutConfigForApi(): StripeCheckoutConfig {
  return requireStripeCapabilityForApi(
    () => requireStripeCheckoutConfig(),
    "Self-serve billing is not available for this deployment.",
  );
}

export function requireStripeClientConfigForApi(): StripeClientConfig {
  return requireStripeCapabilityForApi(
    () => requireStripeClientConfig(),
    "Stripe billing controls are not available for this deployment.",
  );
}

export function requireStripePortalConfigForApi(): StripePortalConfig {
  return requireStripeCapabilityForApi(
    () => requireStripePortalConfig(),
    "Stripe billing controls are not available for this deployment.",
  );
}

export function requireStripeWebhookConfigForApi(): StripeWebhookConfig {
  return requireStripeCapabilityForApi(
    () => requireStripeWebhookConfig(),
    "Stripe webhook processing is not available for this deployment.",
  );
}

export function getAiCheckoutAvailability(teacherEmail?: string) {
  const config = getAiConfig();
  if (!config.enabled) {
    return {
      available: false as const,
      reason: "AI transcription and grading are not enabled for this deployment.",
    };
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
    assertGradingProviderConfiguration(getGradingConfig());
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

/**
 * Entitlement projections require every configured subscription item to agree
 * on one current period. A missing, paginated, malformed, or mixed period is
 * not safe to turn into renewable AI capacity.
 */
export function requireSubscriptionPeriodBoundsMs(subscription: Stripe.Subscription) {
  if (subscription.items.has_more || subscription.items.data.length === 0) {
    throw new Error("Stripe subscription period could not be verified completely.");
  }
  const periods = subscription.items.data.map((item) => {
    const start = item.current_period_start;
    const end = item.current_period_end;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start <= 0 ||
      end <= start
    ) {
      throw new Error("Stripe subscription item has an invalid current period.");
    }
    return { start: start * 1_000, end: end * 1_000 };
  });
  const [{ start, end }] = periods;
  if (periods.some((period) => period.start !== start || period.end !== end)) {
    throw new Error("Stripe subscription items do not share one current period.");
  }
  return { periodStart: start, periodEnd: end };
}

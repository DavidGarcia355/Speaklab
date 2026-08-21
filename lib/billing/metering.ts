import "server-only";
import type Stripe from "stripe";
import {
  claimAiBillingUsageDimensionForDelivery,
  createAiBillingUsage,
  getStripeBillingAccountByTeacherEmail,
  listPendingAiBillingUsage,
  listUnqueuedAiBillingAttempts,
  markAiBillingUsageDimensionFailed,
  markAiBillingUsageDimensionReported,
  type AiBillingUsageDimension,
  type AiBillingUsageRow,
} from "@/lib/db";
import { getStripeClient } from "@/lib/billing/client";
import {
  getStripeBillingAvailability,
  requireStripeBillingConfig,
  type StripeBillingConfig,
} from "@/lib/billing/config";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

export const STRIPE_AI_METER_EVENTS = Object.freeze({
  base: "habla_ai_successful_grade",
  audio: "habla_ai_audio_seconds",
  output: "habla_ai_feedback_tokens",
} as const);

type MeteringDependencies = {
  getAccount: typeof getStripeBillingAccountByTeacherEmail;
  createUsage: typeof createAiBillingUsage;
  listPending: typeof listPendingAiBillingUsage;
  listUnqueued: typeof listUnqueuedAiBillingAttempts;
  claimDelivery: typeof claimAiBillingUsageDimensionForDelivery;
  markReported: typeof markAiBillingUsageDimensionReported;
  markFailed: typeof markAiBillingUsageDimensionFailed;
  createMeterEvent: (
    params: Stripe.Billing.MeterEventCreateParams,
    options: { idempotencyKey: string },
  ) => Promise<{ livemode: boolean }>;
};

function defaultDependencies(config: StripeBillingConfig): MeteringDependencies {
  const stripe = getStripeClient(config);
  return {
    getAccount: getStripeBillingAccountByTeacherEmail,
    createUsage: createAiBillingUsage,
    listPending: listPendingAiBillingUsage,
    listUnqueued: listUnqueuedAiBillingAttempts,
    claimDelivery: claimAiBillingUsageDimensionForDelivery,
    markReported: markAiBillingUsageDimensionReported,
    markFailed: markAiBillingUsageDimensionFailed,
    createMeterEvent: (params, options) => stripe.billing.meterEvents.create(params, options),
  };
}

export function calculateAiRetailMicrousd(input: {
  baseUnits: number;
  durationSeconds: number;
  outputTokens: number;
}) {
  const amountUsd =
    input.baseUnits * TEACHER_AI_PRICE_BOOK.baseSuccessfulGradeUsd +
    (input.durationSeconds / 60) * TEACHER_AI_PRICE_BOOK.audioMinuteUsd +
    (input.outputTokens / 1_000) * TEACHER_AI_PRICE_BOOK.outputThousandTokensUsd;
  return Math.round(amountUsd * 1_000_000);
}

function pendingDimensions(usage: AiBillingUsageRow) {
  const items: Array<{ dimension: AiBillingUsageDimension; quantity: number }> = [];
  if (
    usage.baseUnits > 0 &&
    usage.baseReportedAt === null &&
    usage.baseAttemptedAt === null
  ) {
    items.push({ dimension: "base", quantity: usage.baseUnits });
  }
  if (
    usage.durationSeconds > 0 &&
    usage.audioReportedAt === null &&
    usage.audioAttemptedAt === null
  ) {
    items.push({ dimension: "audio", quantity: usage.durationSeconds });
  }
  if (
    usage.outputTokens > 0 &&
    usage.outputReportedAt === null &&
    usage.outputAttemptedAt === null
  ) {
    items.push({ dimension: "output", quantity: usage.outputTokens });
  }
  return items;
}

export function buildStripeMeterEvent(input: {
  usage: AiBillingUsageRow;
  customerId: string;
  dimension: AiBillingUsageDimension;
  quantity: number;
}): Stripe.Billing.MeterEventCreateParams {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError("Stripe meter-event quantity must be a positive whole number.");
  }
  return {
    event_name: STRIPE_AI_METER_EVENTS[input.dimension],
    identifier: `${input.usage.id}:${input.dimension}:${input.usage.priceBookId}`,
    timestamp: Math.floor(input.usage.createdAt / 1_000),
    payload: {
      stripe_customer_id: input.customerId,
      value: String(input.quantity),
    },
  };
}

export async function reportAiBillingUsage(
  usage: AiBillingUsageRow,
  options?: {
    config?: StripeBillingConfig;
    dependencies?: MeteringDependencies;
  },
) {
  if (usage.freeCreditApplied || usage.status === "credited") return usage;
  const config = options?.config ?? requireStripeBillingConfig();
  const dependencies = options?.dependencies ?? defaultDependencies(config);
  const account = await dependencies.getAccount(usage.teacherEmail);
  if (
    !account ||
    !["active", "trialing"].includes(account.subscriptionStatus) ||
    account.priceBookId !== usage.priceBookId
  ) {
    return usage;
  }

  let current = usage;
  for (const item of pendingDimensions(current)) {
    const claim = await dependencies.claimDelivery({
      usageId: current.id,
      dimension: item.dimension,
    });
    if (claim.usage) current = claim.usage;
    if (!claim.claimed) continue;

    try {
      const meterEvent = buildStripeMeterEvent({
          usage: current,
          customerId: account.stripeCustomerId,
          dimension: item.dimension,
          quantity: item.quantity,
        });
      const event = await dependencies.createMeterEvent(
        meterEvent,
        { idempotencyKey: meterEvent.identifier! },
      );
      const expectedLiveMode = config.keyMode === "live";
      if (event.livemode !== expectedLiveMode) {
        throw new Error("Stripe meter event mode did not match the configured secret key.");
      }
      current =
        (await dependencies.markReported({
          usageId: current.id,
          dimension: item.dimension,
        })) ?? current;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe meter event failed.";
      current =
        (await dependencies.markFailed({
          usageId: current.id,
          dimension: item.dimension,
          error: message,
        })) ?? current;
    }
  }
  return current;
}

export type RecordDeliveredAiUsageInput = {
  teacherEmail: string;
  cacheKey: string;
  attemptId: string;
  submissionId: string;
  durationSeconds: number;
  outputTokens: number;
};

export type RecordDeliveredAiUsageResult =
  | { status: "disabled" | "not_subscribed"; usage: null }
  | { status: "credited" | "pending" | "reported" | "failed"; usage: AiBillingUsageRow };

export async function recordDeliveredAiUsage(
  input: RecordDeliveredAiUsageInput,
  options?: {
    config?: StripeBillingConfig;
    dependencies?: MeteringDependencies;
  },
): Promise<RecordDeliveredAiUsageResult> {
  const availability = options?.config
    ? { available: true as const }
    : getStripeBillingAvailability();
  if (!availability.available) return { status: "disabled", usage: null };

  const config = options?.config ?? requireStripeBillingConfig();
  const dependencies = options?.dependencies ?? defaultDependencies(config);
  const account = await dependencies.getAccount(input.teacherEmail);
  if (
    !account ||
    !["active", "trialing"].includes(account.subscriptionStatus) ||
    account.priceBookId !== TEACHER_AI_PRICE_BOOK.id
  ) {
    return { status: "not_subscribed", usage: null };
  }

  const usage = await dependencies.createUsage({
    teacherEmail: input.teacherEmail,
    cacheKey: input.cacheKey,
    priceBookId: TEACHER_AI_PRICE_BOOK.id,
    attemptId: input.attemptId,
    submissionId: input.submissionId,
    baseUnits: 1,
    durationSeconds: Math.max(0, Math.ceil(input.durationSeconds)),
    outputTokens: Math.max(0, Math.trunc(input.outputTokens)),
  });
  if (!usage) return { status: "not_subscribed", usage: null };
  if (usage.freeCreditApplied || usage.status === "credited") {
    return { status: "credited", usage };
  }
  const reported = await reportAiBillingUsage(usage, { config, dependencies });
  return { status: reported.status, usage: reported };
}

/** Billing failures never discard a teacher's successfully produced grade. */
export async function recordDeliveredAiUsageSafely(input: RecordDeliveredAiUsageInput) {
  try {
    return await recordDeliveredAiUsage(input);
  } catch (error) {
    console.error("AI grade was delivered but billing usage could not be queued", error);
    return { status: "failed" as const, usage: null };
  }
}

export async function flushPendingAiBillingUsage(limit = 100) {
  const availability = getStripeBillingAvailability();
  if (!availability.available) return { attempted: 0, queued: 0, reported: 0, failed: 0 };
  const config = requireStripeBillingConfig();
  const dependencies = defaultDependencies(config);
  const unqueued = await dependencies.listUnqueued(TEACHER_AI_PRICE_BOOK.id, limit);
  let queued = 0;
  let reported = 0;
  let failed = 0;
  for (const attempt of unqueued) {
    const result = await recordDeliveredAiUsage(
      {
        teacherEmail: attempt.teacherEmail,
        cacheKey: attempt.cacheKey,
        attemptId: attempt.attemptId,
        submissionId: attempt.submissionId,
        durationSeconds: attempt.durationSeconds,
        outputTokens: attempt.outputTokens,
      },
      { config, dependencies },
    );
    if (result.usage) queued += 1;
    if (result.status === "reported") reported += 1;
    else if (result.status === "failed") failed += 1;
  }
  const pending = await dependencies.listPending(limit);
  for (const usage of pending) {
    const result = await reportAiBillingUsage(usage, { config, dependencies });
    if (result.status === "reported") reported += 1;
    else if (result.status === "failed") failed += 1;
  }
  return { attempted: unqueued.length + pending.length, queued, reported, failed };
}

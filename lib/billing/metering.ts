import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import {
  claimAiBillingUsageDimensionForDelivery,
  createAiBillingUsage,
  getAiBillingReconciliationHealth,
  getStripeBillingStorageHealth,
  isStripeBillingStorageReady,
  listPendingAiBillingUsage,
  listUnqueuedAiBillingAttempts,
  markAiBillingUsageDimensionFailed,
  markAiBillingUsageDimensionReported,
  type AiBillingUsageDimension,
  type AiBillingUsageRow,
} from "@/lib/db";
import { getStripeClient } from "@/lib/billing/client";
import {
  assertConfiguredStripeCatalog,
  isStripeUsageRuntimeReady,
} from "@/lib/billing/catalog-validation";
import {
  getStripeUsageBillingAvailability,
  requireStripeUsageBillingConfig,
  type StripeUsageBillingConfig,
} from "@/lib/billing/config";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import { getStripeBillingContractId } from "@/lib/billing/contract";
import { isStripeAutomaticUsageRecoverySupported } from "@/lib/billing/recovery-policy";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

export const STRIPE_AI_METER_EVENTS = Object.freeze({
  base: "habla_ai_successful_grade",
  audio: "habla_ai_audio_seconds",
} as const);

type StripeBillableDimension = AiBillingUsageDimension;

type MeteringDependencies = {
  createUsage: typeof createAiBillingUsage;
  listPending: typeof listPendingAiBillingUsage;
  listUnqueued: typeof listUnqueuedAiBillingAttempts;
  getReconciliationHealth: typeof getAiBillingReconciliationHealth;
  claimDelivery: typeof claimAiBillingUsageDimensionForDelivery;
  markReported: typeof markAiBillingUsageDimensionReported;
  markFailed: typeof markAiBillingUsageDimensionFailed;
  createMeterEvent: (
    params: Stripe.Billing.MeterEventCreateParams,
    options: { idempotencyKey: string },
  ) => Promise<{ livemode: boolean }>;
};

function defaultDependencies(config: StripeUsageBillingConfig): MeteringDependencies {
  const stripe = getStripeClient(config);
  return {
    createUsage: createAiBillingUsage,
    listPending: listPendingAiBillingUsage,
    listUnqueued: listUnqueuedAiBillingAttempts,
    getReconciliationHealth: getAiBillingReconciliationHealth,
    claimDelivery: claimAiBillingUsageDimensionForDelivery,
    markReported: markAiBillingUsageDimensionReported,
    markFailed: markAiBillingUsageDimensionFailed,
    createMeterEvent: (params, options) => stripe.billing.meterEvents.create(params, options),
  };
}

function needsBillingReconciliation(health: {
  pendingUnattempted: number;
  expiredPendingUnattempted: number;
  invalidPendingUnattempted: number;
  attemptedUnreported: number;
  recoverableUnqueued: number;
  invalidUnqueued: number;
  expiredUnqueued: number;
}) {
  return (
    health.pendingUnattempted > 0 ||
    health.expiredPendingUnattempted > 0 ||
    health.invalidPendingUnattempted > 0 ||
    health.attemptedUnreported > 0 ||
    health.recoverableUnqueued > 0 ||
    health.invalidUnqueued > 0 ||
    health.expiredUnqueued > 0
  );
}

function blocksBillingSourceCleanup(health: {
  recoverableUnqueued: number;
  invalidUnqueued: number;
  expiredUnqueued: number;
}) {
  return (
    health.recoverableUnqueued > 0 ||
    health.invalidUnqueued > 0 ||
    health.expiredUnqueued > 0
  );
}

async function resolveUsageConfig(config?: StripeUsageBillingConfig) {
  if (config) {
    await assertConfiguredStripeCatalog(config);
    if (!(await isStripeBillingStorageReady())) {
      throw new Error("Legacy unscoped Stripe billing rows require manual reconciliation.");
    }
    return config;
  }
  if (!getStripeUsageBillingAvailability().available) return null;
  if (!(await isStripeUsageRuntimeReady())) return null;
  if (!(await isStripeBillingStorageReady())) return null;
  return requireStripeUsageBillingConfig();
}

export function calculateAiRetailMicrousd(input: {
  baseUnits: number;
  durationSeconds: number;
}) {
  const amountUsd =
    input.baseUnits * TEACHER_AI_PRICE_BOOK.baseSuccessfulGradeUsd +
    (input.durationSeconds / 60) * TEACHER_AI_PRICE_BOOK.audioMinuteUsd;
  return Math.round(amountUsd * 1_000_000);
}

function pendingDimensions(usage: AiBillingUsageRow) {
  const items: Array<{ dimension: StripeBillableDimension; quantity: number }> = [];
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
  return items;
}

export function buildStripeMeterEvent(input: {
  usage: AiBillingUsageRow;
  customerId: string;
  dimension: StripeBillableDimension;
  quantity: number;
}): Stripe.Billing.MeterEventCreateParams {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError("Stripe meter-event quantity must be a positive whole number.");
  }
  const semanticIdentifier = createHash("sha256")
    .update(input.usage.teacherEmail.trim().toLowerCase())
    .update("\0")
    .update(input.usage.cacheKey)
    .update("\0")
    .update(input.usage.priceBookId)
    .update("\0")
    .update(input.usage.catalogFingerprint)
    .update("\0")
    .update(input.usage.livemode ? "live" : "test")
    .update("\0")
    .update(input.dimension)
    .digest("hex");
  return {
    event_name: STRIPE_AI_METER_EVENTS[input.dimension],
    identifier: `habla_${semanticIdentifier}`,
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
    config?: StripeUsageBillingConfig;
    dependencies?: MeteringDependencies;
    now?: number;
  },
) {
  if (usage.freeCreditApplied || usage.status === "credited") return usage;
  const config = await resolveUsageConfig(options?.config);
  if (!config) return usage;
  const dependencies = options?.dependencies ?? defaultDependencies(config);
  if (
    usage.priceBookId !== TEACHER_AI_PRICE_BOOK.id ||
    usage.catalogFingerprint !== STRIPE_CATALOG_MANIFEST.fingerprint ||
    !usage.stripeCustomerId ||
    !usage.stripeSubscriptionId
  ) {
    throw new Error("Stripe usage row does not contain a verified immutable entitlement snapshot.");
  }
  if (usage.livemode !== (config.keyMode === "live")) {
    throw new Error("Stripe usage row mode does not match the configured secret key.");
  }
  if (usage.billingContractId !== getStripeBillingContractId(config)) {
    throw new Error(
      "Stripe usage row belongs to a different immutable billing contract and requires reconciliation.",
    );
  }
  if (!isStripeAutomaticUsageRecoverySupported(usage.createdAt, options?.now ?? Date.now())) {
    throw new Error(
      "Stripe usage is outside the safe automatic meter-event replay window and requires manual reconciliation.",
    );
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
          customerId: current.stripeCustomerId,
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
  occurredAt?: number;
};

export type RecordDeliveredAiUsageResult =
  | { status: "disabled" | "not_subscribed"; usage: null }
  | { status: "credited" | "pending" | "reported" | "failed"; usage: AiBillingUsageRow };

export async function recordDeliveredAiUsage(
  input: RecordDeliveredAiUsageInput,
  options?: {
    config?: StripeUsageBillingConfig;
    dependencies?: MeteringDependencies;
    now?: number;
  },
): Promise<RecordDeliveredAiUsageResult> {
  const config = await resolveUsageConfig(options?.config);
  if (!config) return { status: "disabled", usage: null };
  const dependencies = options?.dependencies ?? defaultDependencies(config);

  const usage = await dependencies.createUsage({
    teacherEmail: input.teacherEmail,
    cacheKey: input.cacheKey,
    priceBookId: TEACHER_AI_PRICE_BOOK.id,
    attemptId: input.attemptId,
    submissionId: input.submissionId,
    baseUnits: 1,
    durationSeconds: Math.max(0, Math.ceil(input.durationSeconds)),
    outputTokens: 0,
    livemode: config.keyMode === "live",
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
  });
  if (!usage) return { status: "not_subscribed", usage: null };
  if (usage.freeCreditApplied || usage.status === "credited") {
    return { status: "credited", usage };
  }
  const reported = await reportAiBillingUsage(usage, {
    config,
    dependencies,
    ...(options?.now === undefined ? {} : { now: options.now }),
  });
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
  const now = Date.now();
  const storageHealth = await getStripeBillingStorageHealth();
  const legacyStorageBlocked = !storageHealth.ready;
  const config = await resolveUsageConfig();
  const currentScope = config
    ? {
        livemode: config.keyMode === "live",
        billingContractId: getStripeBillingContractId(config),
      }
    : undefined;
  const initialHealth = await getAiBillingReconciliationHealth(
    TEACHER_AI_PRICE_BOOK.id,
    now,
    currentScope,
  );
  if (!config) {
    return {
      attempted: 0,
      queued: 0,
      reported: 0,
      failed: 0,
      ...initialHealth,
      legacyCreditPeriods: storageHealth.legacyCreditPeriods,
      legacyUsageRows: storageHealth.legacyUsageRows,
      legacyV2CreditPeriods: storageHealth.legacyV2CreditPeriods,
      legacyV2UsageRows: storageHealth.legacyV2UsageRows,
      unscopedAccounts: storageHealth.unscopedAccounts,
      unscopedBillingMarkers: storageHealth.unscopedBillingMarkers,
      unscopedV3UsageRows: storageHealth.unscopedV3UsageRows,
      needsReconciliation:
        legacyStorageBlocked || needsBillingReconciliation(initialHealth),
      blocksSourceCleanup:
        legacyStorageBlocked || blocksBillingSourceCleanup(initialHealth),
    };
  }
  const dependencies = defaultDependencies(config);
  const livemode = config.keyMode === "live";
  const billingContractId = getStripeBillingContractId(config);
  const unqueued = await dependencies.listUnqueued(
    TEACHER_AI_PRICE_BOOK.id,
    limit,
    now,
    livemode,
    billingContractId,
  );
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
        occurredAt: attempt.occurredAt,
      },
      { config, dependencies, now },
    );
    if (result.usage) queued += 1;
    if (result.status === "reported") reported += 1;
    else if (result.status === "failed") failed += 1;
  }
  const pending = await dependencies.listPending(
    limit,
    livemode,
    now,
    billingContractId,
  );
  for (const usage of pending) {
    const result = await reportAiBillingUsage(usage, { config, dependencies, now });
    if (result.status === "reported") reported += 1;
    else if (result.status === "failed") failed += 1;
  }
  const health = await dependencies.getReconciliationHealth(
    TEACHER_AI_PRICE_BOOK.id,
    now,
    { livemode, billingContractId },
  );
  return {
    attempted: unqueued.length + pending.length,
    queued,
    reported,
    failed,
    ...health,
    legacyCreditPeriods: storageHealth.legacyCreditPeriods,
    legacyUsageRows: storageHealth.legacyUsageRows,
    legacyV2CreditPeriods: storageHealth.legacyV2CreditPeriods,
    legacyV2UsageRows: storageHealth.legacyV2UsageRows,
    unscopedAccounts: storageHealth.unscopedAccounts,
    unscopedBillingMarkers: storageHealth.unscopedBillingMarkers,
    unscopedV3UsageRows: storageHealth.unscopedV3UsageRows,
    needsReconciliation: legacyStorageBlocked || needsBillingReconciliation(health),
    blocksSourceCleanup: legacyStorageBlocked || blocksBillingSourceCleanup(health),
  };
}

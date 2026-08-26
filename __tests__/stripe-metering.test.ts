import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiBillingUsageDimension,
  AiBillingUsageRow,
} from "@/lib/db";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import type { StripeUsageBillingConfig } from "@/lib/billing/config";
import { getStripeBillingContractId } from "@/lib/billing/contract";

const moduleMocks = vi.hoisted(() => ({
  createUsage: vi.fn(),
  listPending: vi.fn(),
  listUnqueued: vi.fn(),
  getReconciliationHealth: vi.fn(),
  getStorageHealth: vi.fn(),
  isStorageReady: vi.fn(),
  claimDelivery: vi.fn(),
  markReported: vi.fn(),
  markFailed: vi.fn(),
  getStripeClient: vi.fn(),
  getUsageAvailability: vi.fn(),
  requireUsageConfig: vi.fn(),
  isRuntimeReady: vi.fn(),
  assertCatalog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  createAiBillingUsage: moduleMocks.createUsage,
  listPendingAiBillingUsage: moduleMocks.listPending,
  listUnqueuedAiBillingAttempts: moduleMocks.listUnqueued,
  getAiBillingReconciliationHealth: moduleMocks.getReconciliationHealth,
  getStripeBillingStorageHealth: moduleMocks.getStorageHealth,
  isStripeBillingStorageReady: moduleMocks.isStorageReady,
  claimAiBillingUsageDimensionForDelivery: moduleMocks.claimDelivery,
  markAiBillingUsageDimensionReported: moduleMocks.markReported,
  markAiBillingUsageDimensionFailed: moduleMocks.markFailed,
}));
vi.mock("@/lib/billing/client", () => ({ getStripeClient: moduleMocks.getStripeClient }));
vi.mock("@/lib/billing/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/config")>()),
  getStripeUsageBillingAvailability: moduleMocks.getUsageAvailability,
  requireStripeUsageBillingConfig: moduleMocks.requireUsageConfig,
}));
vi.mock("@/lib/billing/catalog-validation", () => ({
  isStripeUsageRuntimeReady: moduleMocks.isRuntimeReady,
  assertConfiguredStripeCatalog: moduleMocks.assertCatalog,
}));

import {
  STRIPE_AI_METER_EVENTS,
  buildStripeMeterEvent,
  calculateAiRetailMicrousd,
  flushPendingAiBillingUsage,
  recordDeliveredAiUsage,
  reportAiBillingUsage,
} from "@/lib/billing/metering";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

type RecordOptions = NonNullable<Parameters<typeof recordDeliveredAiUsage>[1]>;
type MeteringDependencies = NonNullable<RecordOptions["dependencies"]>;

const TEST_NOW = Date.now();

const config: StripeUsageBillingConfig = {
  enabled: true,
  usageBillingEnabled: true,
  apiVersion: "2026-07-29.dahlia",
  secretKey: "sk_test_metering",
  webhookSecret: "whsec_metering",
  keyMode: "test",
  accountId: "acct_habla_test",
  priceIds: {
    aiGrade: "price_ai_grade",
    audioMinute: "price_audio_seconds",
  },
  automaticTaxEnabled: false,
};

const billingContractId = getStripeBillingContractId(config);

const deliveredInput = {
  teacherEmail: "teacher@example.com",
  cacheKey: "grading-cache-key",
  attemptId: "attempt-1",
  submissionId: "submission-1",
  durationSeconds: 12.01,
};

function usage(overrides: Partial<AiBillingUsageRow> = {}): AiBillingUsageRow {
  return {
    id: "aiu-stable-id",
    teacherEmail: "teacher@example.com",
    billingMonth: "2026-08",
    cacheKey: "grading-cache-key",
    priceBookId: TEACHER_AI_PRICE_BOOK.id,
    attemptId: "attempt-1",
    submissionId: "submission-1",
    stripeCustomerId: "cus_teacher",
    stripeSubscriptionId: "sub_teacher",
    catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    billingContractId,
    livemode: false,
    freeCreditApplied: false,
    baseUnits: 1,
    durationSeconds: 13,
    outputTokens: 0,
    baseAttemptedAt: null,
    audioAttemptedAt: null,
    outputAttemptedAt: null,
    baseReportedAt: null,
    audioReportedAt: null,
    outputReportedAt: null,
    status: "pending",
    lastErrorDimension: null,
    lastError: "",
    lastFailedAt: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    ...overrides,
  };
}

function allDimensionsReported(row: AiBillingUsageRow) {
  return (
    (row.baseUnits === 0 || row.baseReportedAt !== null) &&
    (row.durationSeconds === 0 || row.audioReportedAt !== null)
  );
}

function statefulDependencies(input?: {
  usage?: AiBillingUsageRow | null;
  failOnce?: AiBillingUsageDimension[];
}) {
  let current = input?.usage === undefined ? usage() : input.usage;
  const failures = new Set(input?.failOnce ?? []);

  const createUsage = vi.fn<MeteringDependencies["createUsage"]>(async () => current);
  const listPending = vi.fn<MeteringDependencies["listPending"]>(async () => []);
  const listUnqueued = vi.fn<MeteringDependencies["listUnqueued"]>(async () => []);
  const getReconciliationHealth = vi.fn<MeteringDependencies["getReconciliationHealth"]>(
    async () => ({
      pendingUnattempted: 0,
      expiredPendingUnattempted: 0,
      invalidPendingUnattempted: 0,
      attemptedUnreported: 0,
      recoverableUnqueued: 0,
      invalidUnqueued: 0,
      expiredUnqueued: 0,
    }),
  );
  const claimDelivery = vi.fn<MeteringDependencies["claimDelivery"]>(
    async ({ dimension }) => {
      if (!current) return { usage: null, claimed: false };
      const attemptedKey =
        dimension === "base"
          ? "baseAttemptedAt"
          : "audioAttemptedAt";
      if (current[attemptedKey] !== null) return { usage: current, claimed: false };
      current = { ...current, [attemptedKey]: TEST_NOW + 1 };
      return { usage: current, claimed: true };
    },
  );
  const markReported = vi.fn<MeteringDependencies["markReported"]>(async ({ dimension }) => {
    if (!current) return null;
    if (dimension === "base") current = { ...current, baseReportedAt: TEST_NOW + 1 };
    if (dimension === "audio") current = { ...current, audioReportedAt: TEST_NOW + 1 };
    if (current.lastErrorDimension === dimension) {
      current = {
        ...current,
        lastErrorDimension: null,
        lastError: "",
        lastFailedAt: null,
      };
    }
    current = {
      ...current,
      status: allDimensionsReported(current)
        ? "reported"
        : current.lastError
          ? "failed"
          : "pending",
      updatedAt: TEST_NOW + 1,
    };
    return current;
  });
  const markFailed = vi.fn<MeteringDependencies["markFailed"]>(
    async ({ dimension, error }) => {
      if (!current) return null;
      current = {
        ...current,
        status: "failed",
        lastErrorDimension: dimension,
        lastError: error,
        lastFailedAt: TEST_NOW + 1,
        updatedAt: TEST_NOW + 1,
      };
      return current;
    },
  );
  const createMeterEvent = vi.fn<MeteringDependencies["createMeterEvent"]>(async (event) => {
    const dimension = (Object.entries(STRIPE_AI_METER_EVENTS).find(
      ([, eventName]) => eventName === event.event_name,
    )?.[0] ?? null) as AiBillingUsageDimension | null;
    if (dimension && failures.delete(dimension)) {
      throw new Error(`${dimension} meter unavailable`);
    }
    return { livemode: false };
  });

  return {
    dependencies: {
      createUsage,
      listPending,
      listUnqueued,
      getReconciliationHealth,
      claimDelivery,
      markReported,
      markFailed,
      createMeterEvent,
    } satisfies MeteringDependencies,
    get current() {
      return current;
    },
    spies: {
      createUsage,
      listPending,
      listUnqueued,
      getReconciliationHealth,
      claimDelivery,
      markReported,
      markFailed,
      createMeterEvent,
    },
  };
}

describe("Stripe AI usage metering", () => {
  beforeEach(() => {
    moduleMocks.getUsageAvailability.mockReset();
    moduleMocks.getUsageAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    moduleMocks.requireUsageConfig.mockReset();
    moduleMocks.requireUsageConfig.mockReturnValue(config);
    moduleMocks.isRuntimeReady.mockReset();
    moduleMocks.isRuntimeReady.mockResolvedValue(true);
    moduleMocks.assertCatalog.mockReset();
    moduleMocks.assertCatalog.mockResolvedValue({ valid: true });
    moduleMocks.getStripeClient.mockReset();
    moduleMocks.createUsage.mockReset();
    moduleMocks.listPending.mockReset();
    moduleMocks.listUnqueued.mockReset();
    moduleMocks.getReconciliationHealth.mockReset();
    moduleMocks.getStorageHealth.mockReset();
    moduleMocks.getStorageHealth.mockResolvedValue({
      ready: true,
      legacyCreditPeriods: 0,
      legacyUsageRows: 0,
    });
    moduleMocks.isStorageReady.mockReset();
    moduleMocks.isStorageReady.mockResolvedValue(true);
    moduleMocks.getReconciliationHealth.mockResolvedValue({
      pendingUnattempted: 0,
      expiredPendingUnattempted: 0,
      invalidPendingUnattempted: 0,
      attemptedUnreported: 0,
      recoverableUnqueued: 0,
      invalidUnqueued: 0,
      expiredUnqueued: 0,
    });
    moduleMocks.claimDelivery.mockReset();
    moduleMocks.markReported.mockReset();
    moduleMocks.markFailed.mockReset();
  });

  it("calculates the exact published grade and audio prices in micro-USD", () => {
    expect(
      calculateAiRetailMicrousd({ baseUnits: 1, durationSeconds: 0 }),
    ).toBe(50_000);
    expect(
      calculateAiRetailMicrousd({ baseUnits: 0, durationSeconds: 60 }),
    ).toBe(10_000);
    expect(
      calculateAiRetailMicrousd({ baseUnits: 2, durationSeconds: 90 }),
    ).toBe(115_000);
  });

  it("builds named whole-quantity events with stable per-dimension identifiers", () => {
    expect(STRIPE_AI_METER_EVENTS).toEqual({
      base: "habla_ai_successful_grade",
      audio: "habla_ai_audio_seconds",
    });

    for (const [dimension, quantity] of [
      ["base", 1],
      ["audio", 13],
    ] as const) {
      expect(
        buildStripeMeterEvent({
          usage: usage(),
          customerId: "cus_teacher",
          dimension,
          quantity,
        }),
      ).toEqual({
        event_name: STRIPE_AI_METER_EVENTS[dimension],
        identifier: expect.stringMatching(/^habla_[a-f0-9]{64}$/),
        timestamp: Math.floor(TEST_NOW / 1_000),
        payload: {
          stripe_customer_id: "cus_teacher",
          value: String(quantity),
        },
      });
    }

    const semanticBase = buildStripeMeterEvent({
      usage: usage(),
      customerId: "cus_teacher",
      dimension: "base",
      quantity: 1,
    });
    const restoredBase = buildStripeMeterEvent({
      usage: usage({ id: "aiu-created-after-restore" }),
      customerId: "cus_teacher",
      dimension: "base",
      quantity: 1,
    });
    const semanticAudio = buildStripeMeterEvent({
      usage: usage(),
      customerId: "cus_teacher",
      dimension: "audio",
      quantity: 13,
    });
    const differentCatalog = buildStripeMeterEvent({
      usage: usage({ catalogFingerprint: "f".repeat(64) }),
      customerId: "cus_teacher",
      dimension: "base",
      quantity: 1,
    });
    const liveMode = buildStripeMeterEvent({
      usage: usage({ livemode: true }),
      customerId: "cus_teacher",
      dimension: "base",
      quantity: 1,
    });
    expect(restoredBase.identifier).toBe(semanticBase.identifier);
    expect(semanticAudio.identifier).not.toBe(semanticBase.identifier);
    expect(differentCatalog.identifier).not.toBe(semanticBase.identifier);
    expect(liveMode.identifier).not.toBe(semanticBase.identifier);

    expect(() =>
      buildStripeMeterEvent({
        usage: usage(),
        customerId: "cus_teacher",
        dimension: "audio",
        quantity: 1.5,
      }),
    ).toThrow("positive whole number");
    expect(() =>
      buildStripeMeterEvent({
        usage: usage(),
        customerId: "cus_teacher",
        dimension: "base",
        quantity: 0,
      }),
    ).toThrow("positive whole number");
  });

  it("does not create a ledger row or Stripe event when billing is disabled", async () => {
    const result = await recordDeliveredAiUsage(deliveredInput);

    expect(result).toEqual({ status: "disabled", usage: null });
    expect(moduleMocks.createUsage).not.toHaveBeenCalled();
    expect(moduleMocks.getStripeClient).not.toHaveBeenCalled();
  });

  it("does not create usage when local configuration exists but runtime validation is off", async () => {
    moduleMocks.getUsageAvailability.mockReturnValue({
      enabled: true,
      available: true,
      keyMode: "test",
      automaticTaxEnabled: false,
      usageBillingEnabled: true,
      issues: [],
    });
    moduleMocks.isRuntimeReady.mockResolvedValue(false);

    await expect(recordDeliveredAiUsage(deliveredInput)).resolves.toEqual({
      status: "disabled",
      usage: null,
    });
    expect(moduleMocks.requireUsageConfig).not.toHaveBeenCalled();
    expect(moduleMocks.createUsage).not.toHaveBeenCalled();
  });

  it("validates an injected catalog before creating usage", async () => {
    moduleMocks.assertCatalog.mockRejectedValue(new Error("catalog mismatch"));
    const context = statefulDependencies();

    await expect(
      recordDeliveredAiUsage(deliveredInput, {
        config,
        dependencies: context.dependencies,
      }),
    ).rejects.toThrow("catalog mismatch");
    expect(context.spies.createUsage).not.toHaveBeenCalled();
  });

  it("does not emit a Stripe event when no durable billing marker can create usage", async () => {
    const context = statefulDependencies({ usage: null });

    const result = await recordDeliveredAiUsage(deliveredInput, {
      config,
      dependencies: context.dependencies,
    });

    expect(result).toEqual({ status: "not_subscribed", usage: null });
    expect(context.spies.createUsage).toHaveBeenCalledOnce();
    expect(context.spies.createMeterEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong price book", usage({ priceBookId: "habla-teacher-ai-usd-v1" })],
    ["wrong catalog fingerprint", usage({ catalogFingerprint: "wrong-fingerprint" })],
    ["missing customer snapshot", usage({ stripeCustomerId: "" })],
  ])("rejects a usage row with %s", async (_label, invalidUsage) => {
    const context = statefulDependencies({ usage: invalidUsage });

    await expect(
      reportAiBillingUsage(invalidUsage, {
        config,
        dependencies: context.dependencies,
      }),
    ).rejects.toThrow("immutable entitlement snapshot");
    expect(context.spies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("rejects a usage row captured in the other Stripe mode before claiming delivery", async () => {
    const liveUsage = usage({ livemode: true });
    const context = statefulDependencies({ usage: liveUsage });

    await expect(
      reportAiBillingUsage(liveUsage, { config, dependencies: context.dependencies }),
    ).rejects.toThrow("mode does not match");
    expect(context.spies.claimDelivery).not.toHaveBeenCalled();
  });

  it("rejects usage outside the safe automatic replay window before claiming delivery", async () => {
    const oldUsage = usage({ createdAt: TEST_NOW - 35 * 24 * 60 * 60 * 1000 });
    const context = statefulDependencies({ usage: oldUsage });

    await expect(
      reportAiBillingUsage(oldUsage, {
        config,
        dependencies: context.dependencies,
        now: TEST_NOW,
      }),
    ).rejects.toThrow("outside the safe automatic meter-event replay window");
    expect(context.spies.claimDelivery).not.toHaveBeenCalled();
    expect(context.spies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("accepts an unattempted delivery after a delayed daily cron", async () => {
    const delayedUsage = usage({ createdAt: TEST_NOW - 26 * 60 * 60 * 1000 });
    const context = statefulDependencies({ usage: delayedUsage });

    await expect(
      reportAiBillingUsage(delayedUsage, {
        config,
        dependencies: context.dependencies,
        now: TEST_NOW,
      }),
    ).resolves.toMatchObject({ status: "reported" });
    expect(context.spies.createMeterEvent).toHaveBeenCalledTimes(2);
  });

  it("returns reconciliation counts even while usage billing is disabled", async () => {
    moduleMocks.getReconciliationHealth.mockResolvedValue({
      pendingUnattempted: 4,
      expiredPendingUnattempted: 6,
      invalidPendingUnattempted: 7,
      attemptedUnreported: 2,
      recoverableUnqueued: 5,
      invalidUnqueued: 1,
      expiredUnqueued: 3,
    });

    await expect(flushPendingAiBillingUsage()).resolves.toEqual({
      attempted: 0,
      queued: 0,
      reported: 0,
      failed: 0,
      pendingUnattempted: 4,
      expiredPendingUnattempted: 6,
      invalidPendingUnattempted: 7,
      attemptedUnreported: 2,
      recoverableUnqueued: 5,
      invalidUnqueued: 1,
      expiredUnqueued: 3,
      legacyCreditPeriods: 0,
      legacyUsageRows: 0,
      needsReconciliation: true,
      blocksSourceCleanup: true,
    });
    expect(moduleMocks.getStripeClient).not.toHaveBeenCalled();
  });

  it("blocks cleanup when ambiguous legacy billing storage exists", async () => {
    moduleMocks.getStorageHealth.mockResolvedValue({
      ready: false,
      legacyCreditPeriods: 1,
      legacyUsageRows: 2,
    });

    await expect(flushPendingAiBillingUsage()).resolves.toMatchObject({
      legacyCreditPeriods: 1,
      legacyUsageRows: 2,
      needsReconciliation: true,
      blocksSourceCleanup: true,
    });
  });

  it("creates one usage row and reports both customer billing dimensions", async () => {
    const context = statefulDependencies();

    const result = await recordDeliveredAiUsage(deliveredInput, {
      config,
      dependencies: context.dependencies,
    });

    expect(context.spies.createUsage).toHaveBeenCalledOnce();
    expect(context.spies.createUsage).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
      cacheKey: "grading-cache-key",
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      attemptId: "attempt-1",
      submissionId: "submission-1",
      baseUnits: 1,
      durationSeconds: 13,
      outputTokens: 0,
      livemode: false,
    });
    expect(context.spies.createMeterEvent).toHaveBeenCalledTimes(2);
    expect(context.spies.claimDelivery).toHaveBeenCalledTimes(2);
    expect(context.spies.createMeterEvent.mock.calls.map(([event]) => event)).toEqual([
      buildStripeMeterEvent({
        usage: usage(),
        customerId: "cus_teacher",
        dimension: "base",
        quantity: 1,
      }),
      buildStripeMeterEvent({
        usage: usage(),
        customerId: "cus_teacher",
        dimension: "audio",
        quantity: 13,
      }),
    ]);
    expect(
      context.spies.createMeterEvent.mock.calls.map(([, options]) => options.idempotencyKey),
    ).toEqual(
      context.spies.createMeterEvent.mock.calls.map(([event]) => event.identifier),
    );
    expect(context.spies.markReported.mock.calls.map(([call]) => call.dimension)).toEqual([
      "base",
      "audio",
    ]);
    expect(result).toMatchObject({ status: "reported", usage: { status: "reported" } });
  });

  it("creates a credited ledger row but emits no Stripe events", async () => {
    const credited = usage({ freeCreditApplied: true, status: "credited" });
    const context = statefulDependencies({ usage: credited });

    const result = await recordDeliveredAiUsage(deliveredInput, {
      config,
      dependencies: context.dependencies,
    });

    expect(context.spies.createUsage).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "credited", usage: credited });
    expect(context.spies.createMeterEvent).not.toHaveBeenCalled();
    expect(context.spies.markReported).not.toHaveBeenCalled();
    expect(context.spies.markFailed).not.toHaveBeenCalled();
  });

  it("marks one failed dimension without blocking the remaining dimensions", async () => {
    const context = statefulDependencies({ failOnce: ["audio"] });

    const result = await reportAiBillingUsage(usage(), {
      config,
      dependencies: context.dependencies,
    });

    expect(context.spies.createMeterEvent).toHaveBeenCalledTimes(2);
    expect(context.spies.markReported.mock.calls.map(([call]) => call.dimension)).toEqual(["base"]);
    expect(context.spies.markFailed).toHaveBeenCalledWith({
      usageId: "aiu-stable-id",
      dimension: "audio",
      error: "audio meter unavailable",
    });
    expect(result).toMatchObject({
      status: "failed",
      baseReportedAt: TEST_NOW + 1,
      audioReportedAt: null,
      lastErrorDimension: "audio",
    });
  });

  it("does not blindly retry an attempted dimension after ambiguous delivery", async () => {
    const failedUsage = usage({
      baseReportedAt: TEST_NOW - 20,
      audioAttemptedAt: TEST_NOW - 6,
      audioReportedAt: null,
      status: "failed",
      lastErrorDimension: "audio",
      lastError: "previous audio failure",
      lastFailedAt: TEST_NOW - 5,
    });
    const context = statefulDependencies({ usage: failedUsage });

    const result = await reportAiBillingUsage(failedUsage, {
      config,
      dependencies: context.dependencies,
    });

    expect(context.spies.claimDelivery).not.toHaveBeenCalled();
    expect(context.spies.createMeterEvent).not.toHaveBeenCalled();
    expect(context.spies.markReported).not.toHaveBeenCalled();
    expect(context.spies.markFailed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "failed",
      baseReportedAt: TEST_NOW - 20,
      audioAttemptedAt: TEST_NOW - 6,
      audioReportedAt: null,
      lastErrorDimension: "audio",
      lastError: "previous audio failure",
    });
  });
});

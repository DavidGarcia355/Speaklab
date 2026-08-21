import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiBillingUsageDimension,
  AiBillingUsageRow,
  StripeBillingAccountRow,
} from "@/lib/db";
import type { StripeBillingConfig } from "@/lib/billing/config";

const moduleMocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  createUsage: vi.fn(),
  listPending: vi.fn(),
  listUnqueued: vi.fn(),
  claimDelivery: vi.fn(),
  markReported: vi.fn(),
  markFailed: vi.fn(),
  getStripeClient: vi.fn(),
  getAvailability: vi.fn(),
  requireConfig: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getStripeBillingAccountByTeacherEmail: moduleMocks.getAccount,
  createAiBillingUsage: moduleMocks.createUsage,
  listPendingAiBillingUsage: moduleMocks.listPending,
  listUnqueuedAiBillingAttempts: moduleMocks.listUnqueued,
  claimAiBillingUsageDimensionForDelivery: moduleMocks.claimDelivery,
  markAiBillingUsageDimensionReported: moduleMocks.markReported,
  markAiBillingUsageDimensionFailed: moduleMocks.markFailed,
}));
vi.mock("@/lib/billing/client", () => ({ getStripeClient: moduleMocks.getStripeClient }));
vi.mock("@/lib/billing/config", () => ({
  getStripeBillingAvailability: moduleMocks.getAvailability,
  requireStripeBillingConfig: moduleMocks.requireConfig,
}));

import {
  STRIPE_AI_METER_EVENTS,
  buildStripeMeterEvent,
  calculateAiRetailMicrousd,
  recordDeliveredAiUsage,
  reportAiBillingUsage,
} from "@/lib/billing/metering";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

type RecordOptions = NonNullable<Parameters<typeof recordDeliveredAiUsage>[1]>;
type MeteringDependencies = NonNullable<RecordOptions["dependencies"]>;

const TEST_NOW = 1_700_000_000_123;

const config: StripeBillingConfig = {
  enabled: true,
  apiVersion: "2026-07-29.dahlia",
  secretKey: "sk_test_metering",
  webhookSecret: "whsec_metering",
  keyMode: "test",
  priceIds: {
    aiGrade: "price_ai_grade",
    audioMinute: "price_audio_seconds",
  },
  automaticTaxEnabled: false,
};

const deliveredInput = {
  teacherEmail: "teacher@example.com",
  cacheKey: "grading-cache-key",
  attemptId: "attempt-1",
  submissionId: "submission-1",
  durationSeconds: 12.01,
};

function account(
  overrides: Partial<StripeBillingAccountRow> = {},
): StripeBillingAccountRow {
  return {
    teacherEmail: "teacher@example.com",
    stripeCustomerId: "cus_teacher",
    stripeSubscriptionId: "sub_teacher",
    subscriptionStatus: "active",
    priceBookId: TEACHER_AI_PRICE_BOOK.id,
    stripeEventCreated: 1_700_000_000,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    ...overrides,
  };
}

function usage(overrides: Partial<AiBillingUsageRow> = {}): AiBillingUsageRow {
  return {
    id: "aiu-stable-id",
    teacherEmail: "teacher@example.com",
    billingMonth: "2026-08",
    cacheKey: "grading-cache-key",
    priceBookId: TEACHER_AI_PRICE_BOOK.id,
    attemptId: "attempt-1",
    submissionId: "submission-1",
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
    (row.durationSeconds === 0 || row.audioReportedAt !== null) &&
    (row.outputTokens === 0 || row.outputReportedAt !== null)
  );
}

function statefulDependencies(input?: {
  account?: StripeBillingAccountRow | null;
  usage?: AiBillingUsageRow | null;
  failOnce?: AiBillingUsageDimension[];
}) {
  let current = input?.usage === undefined ? usage() : input.usage;
  const failures = new Set(input?.failOnce ?? []);

  const getAccount = vi.fn<MeteringDependencies["getAccount"]>(async () =>
    input?.account === undefined ? account() : input.account,
  );
  const createUsage = vi.fn<MeteringDependencies["createUsage"]>(async () => current);
  const listPending = vi.fn<MeteringDependencies["listPending"]>(async () => []);
  const listUnqueued = vi.fn<MeteringDependencies["listUnqueued"]>(async () => []);
  const claimDelivery = vi.fn<MeteringDependencies["claimDelivery"]>(
    async ({ dimension }) => {
      if (!current) return { usage: null, claimed: false };
      const attemptedKey =
        dimension === "base"
          ? "baseAttemptedAt"
          : dimension === "audio"
            ? "audioAttemptedAt"
            : "outputAttemptedAt";
      if (current[attemptedKey] !== null) return { usage: current, claimed: false };
      current = { ...current, [attemptedKey]: TEST_NOW + 1 };
      return { usage: current, claimed: true };
    },
  );
  const markReported = vi.fn<MeteringDependencies["markReported"]>(async ({ dimension }) => {
    if (!current) return null;
    if (dimension === "base") current = { ...current, baseReportedAt: TEST_NOW + 1 };
    if (dimension === "audio") current = { ...current, audioReportedAt: TEST_NOW + 1 };
    if (dimension === "output") current = { ...current, outputReportedAt: TEST_NOW + 1 };
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
      getAccount,
      createUsage,
      listPending,
      listUnqueued,
      claimDelivery,
      markReported,
      markFailed,
      createMeterEvent,
    } satisfies MeteringDependencies,
    get current() {
      return current;
    },
    spies: {
      getAccount,
      createUsage,
      listPending,
      listUnqueued,
      claimDelivery,
      markReported,
      markFailed,
      createMeterEvent,
    },
  };
}

describe("Stripe AI usage metering", () => {
  beforeEach(() => {
    moduleMocks.getAvailability.mockReset();
    moduleMocks.getAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    moduleMocks.requireConfig.mockReset();
    moduleMocks.requireConfig.mockReturnValue(config);
    moduleMocks.getStripeClient.mockReset();
    moduleMocks.getAccount.mockReset();
    moduleMocks.createUsage.mockReset();
    moduleMocks.listPending.mockReset();
    moduleMocks.listUnqueued.mockReset();
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
        identifier: `aiu-stable-id:${dimension}:${TEACHER_AI_PRICE_BOOK.id}`,
        timestamp: 1_700_000_000,
        payload: {
          stripe_customer_id: "cus_teacher",
          value: String(quantity),
        },
      });
    }

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
    expect(moduleMocks.getAccount).not.toHaveBeenCalled();
    expect(moduleMocks.createUsage).not.toHaveBeenCalled();
    expect(moduleMocks.getStripeClient).not.toHaveBeenCalled();
  });

  it("does not create a ledger row or Stripe event without an active subscription", async () => {
    const context = statefulDependencies({ account: null });

    const result = await recordDeliveredAiUsage(deliveredInput, {
      config,
      dependencies: context.dependencies,
    });

    expect(result).toEqual({ status: "not_subscribed", usage: null });
    expect(context.spies.getAccount).toHaveBeenCalledOnce();
    expect(context.spies.createUsage).not.toHaveBeenCalled();
    expect(context.spies.createMeterEvent).not.toHaveBeenCalled();
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
    ).toEqual([
      `aiu-stable-id:base:${TEACHER_AI_PRICE_BOOK.id}`,
      `aiu-stable-id:audio:${TEACHER_AI_PRICE_BOOK.id}`,
    ]);
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

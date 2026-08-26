import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiBillingUsageRow } from "@/lib/db";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import type { StripeUsageBillingConfig } from "@/lib/billing/config";
import { getStripeBillingContractId } from "@/lib/billing/contract";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

const mocks = vi.hoisted(() => ({
  createUsage: vi.fn(),
  listPending: vi.fn(),
  listUnqueued: vi.fn(),
  getReconciliationHealth: vi.fn(),
  getStorageHealth: vi.fn(),
  claimDelivery: vi.fn(),
  markReported: vi.fn(),
  markFailed: vi.fn(),
  getStripeClient: vi.fn(),
  getUsageAvailability: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  createAiBillingUsage: mocks.createUsage,
  listPendingAiBillingUsage: mocks.listPending,
  listUnqueuedAiBillingAttempts: mocks.listUnqueued,
  getAiBillingReconciliationHealth: mocks.getReconciliationHealth,
  getStripeBillingStorageHealth: mocks.getStorageHealth,
  claimAiBillingUsageDimensionForDelivery: mocks.claimDelivery,
  markAiBillingUsageDimensionReported: mocks.markReported,
  markAiBillingUsageDimensionFailed: mocks.markFailed,
}));

vi.mock("@/lib/billing/client", () => ({ getStripeClient: mocks.getStripeClient }));
vi.mock("@/lib/billing/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/config")>()),
  getStripeUsageBillingAvailability: mocks.getUsageAvailability,
}));

import {
  STRIPE_AI_METER_EVENTS,
  buildStripeMeterEvent,
  calculateAiRetailMicrousd,
  flushPendingAiBillingUsage,
  recordDeliveredAiUsage,
  reportAiBillingUsage,
} from "@/lib/billing/metering";

const NOW = Date.now();
const config: StripeUsageBillingConfig = {
  enabled: true,
  subscriptionBillingEnabled: true,
  apiVersion: "2026-07-29.dahlia",
  secretKey: "sk_test_retired_metering",
  webhookSecret: "whsec_retired_metering",
  keyMode: "test",
  accountId: "acct_habla_test",
  priceIds: { teacher: "price_tryhabla_teacher" },
  automaticTaxEnabled: false,
};

function usage(overrides: Partial<AiBillingUsageRow> = {}): AiBillingUsageRow {
  return {
    id: "aiu-retired",
    teacherEmail: "teacher@example.com",
    billingMonth: "2026-08",
    cacheKey: "semantic-review",
    priceBookId: TEACHER_AI_PRICE_BOOK.id,
    attemptId: "attempt-1",
    submissionId: "submission-1",
    stripeCustomerId: "cus_teacher",
    stripeSubscriptionId: "sub_teacher",
    catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    billingContractId: getStripeBillingContractId(config),
    livemode: false,
    freeCreditApplied: false,
    baseUnits: 1,
    durationSeconds: 60,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const emptyReconciliation = {
  pendingUnattempted: 0,
  expiredPendingUnattempted: 0,
  invalidPendingUnattempted: 0,
  attemptedUnreported: 0,
  recoverableUnqueued: 0,
  invalidUnqueued: 0,
  expiredUnqueued: 0,
};

const healthyStorage = {
  ready: true,
  legacyCreditPeriods: 0,
  legacyUsageRows: 0,
  legacyV2CreditPeriods: 0,
  legacyV2UsageRows: 0,
  unscopedAccounts: 0,
  unscopedBillingMarkers: 0,
  unscopedV3UsageRows: 0,
};

describe("retired Stripe usage metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUsageAvailability.mockReturnValue({
      enabled: false,
      available: false,
      reason: "disabled",
      issues: [],
    });
    mocks.getStorageHealth.mockResolvedValue(healthyStorage);
    mocks.getReconciliationHealth.mockResolvedValue(emptyReconciliation);
    mocks.listPending.mockResolvedValue([]);
    mocks.listUnqueued.mockResolvedValue([]);
  });

  it("never creates a usage row for the licensed Teacher plan", async () => {
    await expect(
      recordDeliveredAiUsage({
        teacherEmail: "teacher@example.com",
        cacheKey: "semantic-review",
        attemptId: "attempt-1",
        submissionId: "submission-1",
        durationSeconds: 60,
      }),
    ).resolves.toEqual({ status: "disabled", usage: null });
    expect(mocks.createUsage).not.toHaveBeenCalled();
    expect(mocks.getStripeClient).not.toHaveBeenCalled();
  });

  it("rejects any explicit attempt to revive v2 meter delivery", async () => {
    await expect(
      recordDeliveredAiUsage(
        {
          teacherEmail: "teacher@example.com",
          cacheKey: "semantic-review",
          attemptId: "attempt-1",
          submissionId: "submission-1",
          durationSeconds: 60,
        },
        { config },
      ),
    ).rejects.toThrow("metered billing is retired");
    await expect(reportAiBillingUsage(usage(), { config })).rejects.toThrow(
      "metered billing is retired",
    );
    expect(mocks.createUsage).not.toHaveBeenCalled();
    expect(mocks.claimDelivery).not.toHaveBeenCalled();
  });

  it("fails closed if a legacy availability alias ever becomes enabled", async () => {
    mocks.getUsageAvailability.mockReturnValue({
      enabled: true,
      available: true,
      keyMode: "test",
      automaticTaxEnabled: false,
      subscriptionBillingEnabled: true,
      issues: [],
    });

    await expect(
      recordDeliveredAiUsage({
        teacherEmail: "teacher@example.com",
        cacheKey: "semantic-review",
        attemptId: "attempt-1",
        submissionId: "submission-1",
        durationSeconds: 60,
      }),
    ).rejects.toThrow("unexpectedly became available");
  });

  it("preserves an already credited archival row without sending anything", async () => {
    const credited = usage({ freeCreditApplied: true, status: "credited" });
    await expect(reportAiBillingUsage(credited)).resolves.toBe(credited);
    expect(mocks.claimDelivery).not.toHaveBeenCalled();
    expect(mocks.getStripeClient).not.toHaveBeenCalled();
  });

  it("keeps cleanup blocked when an archived ledger still needs reconciliation", async () => {
    mocks.getStorageHealth.mockResolvedValue({
      ...healthyStorage,
      ready: false,
      legacyV2UsageRows: 1,
    });

    await expect(flushPendingAiBillingUsage()).resolves.toMatchObject({
      attempted: 0,
      needsReconciliation: true,
      blocksSourceCleanup: true,
      legacyV2UsageRows: 1,
    });
    expect(mocks.getStripeClient).not.toHaveBeenCalled();
  });

  it("retains deterministic v2 parsing helpers without exposing a live sender", () => {
    expect(calculateAiRetailMicrousd({ baseUnits: 1, durationSeconds: 60 })).toBe(60_000);
    expect(
      buildStripeMeterEvent({
        usage: usage(),
        customerId: "cus_teacher",
        dimension: "base",
        quantity: 1,
      }),
    ).toMatchObject({
      event_name: STRIPE_AI_METER_EVENTS.base,
      payload: { stripe_customer_id: "cus_teacher", value: "1" },
    });
  });
});

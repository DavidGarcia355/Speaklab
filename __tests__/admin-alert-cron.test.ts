import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAlertPeriodAggregate } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  getAdminAlertPeriodAggregate: vi.fn(),
  getAdminAlertMilestoneAggregate: vi.fn(),
  getAdminAlertOperationalAggregate: vi.fn(),
  getAdminAlertOutboxHealthForEnvironment: vi.fn(),
  enqueueAdminAlerts: vi.fn(),
  deliverPendingAdminAlerts: vi.fn(),
  isAdminAlertDeliveryEnabled: vi.fn(),
  resolveAdminAlertOperationalConfig: vi.fn(),
  resolveAdminAlertsEnvironment: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));

vi.mock("@/lib/db", () => ({
  getAdminAlertPeriodAggregate: mocks.getAdminAlertPeriodAggregate,
  getAdminAlertMilestoneAggregate: mocks.getAdminAlertMilestoneAggregate,
  getAdminAlertOperationalAggregate: mocks.getAdminAlertOperationalAggregate,
  getAdminAlertOutboxHealthForEnvironment:
    mocks.getAdminAlertOutboxHealthForEnvironment,
}));

vi.mock("@/lib/admin-alerts", () => ({
  MAX_ADMIN_ALERT_DELIVERY_BATCH: 8,
  enqueueAdminAlerts: mocks.enqueueAdminAlerts,
  deliverPendingAdminAlerts: mocks.deliverPendingAdminAlerts,
  isAdminAlertDeliveryEnabled: mocks.isAdminAlertDeliveryEnabled,
  resolveAdminAlertOperationalConfig: mocks.resolveAdminAlertOperationalConfig,
  resolveAdminAlertsEnvironment: mocks.resolveAdminAlertsEnvironment,
}));

vi.mock("@/lib/http", async () => {
  class MockHttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    HttpError: MockHttpError,
    withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        if (error instanceof MockHttpError) {
          return Response.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
    },
  };
});

const emptyAggregate: AdminAlertPeriodAggregate = {
  newTeachers: 0,
  activatedTeachers: 0,
  newPaidTeachers: 0,
  eligibleFreeTeachers: 0,
  convertedEligibleFreeTeachers: 0,
  assignmentsPublished: 0,
  recordingsReceived: 0,
  successfulAiReviews: 0,
  aiAttempts: 0,
  aiFailures: 0,
  retryCount: 0,
  durationSampleCount: 0,
  medianDurationSeconds: 0,
  p90DurationSeconds: 0,
  activePaidTeachers: 0,
  mrrCents: 0,
  newMrrCents: 0,
  recognizedRevenueCents: 0,
  cancellations: 0,
  refundsCents: 0,
  failedPayments: 0,
  estimatedProviderSpendCents: 0,
  estimatedStripeFeesCents: 0,
  estimatedContributionCents: 0,
  freeTrialsExhausted: 0,
  nearPaidLimitTeachers: 0,
  paidLimitExhaustedTeachers: 0,
  schoolLeads: 0,
};

const emptyHealth = {
  pending: 0,
  due: 0,
  stale: 0,
  delivered: 0,
  dead: 0,
  oldestPendingAt: null,
};

const zeroMilestones = {
  totalTeachers: 0,
  activatedTeachers: 0,
  paidTeachers: 0,
  successfulAiReviews: 0,
  studentRecordings: 0,
  mrrCents: 0,
  schoolLeads: 0,
  estimatedProviderCostCents: 0,
};

const zeroOperational = {
  budgetPeriod: "2026-08",
  providerSpendMicrousd: 0,
  rollingWindowStartAt: 0,
  rollingWindowEndAt: 1,
  completedAttempts: 0,
  usableAttempts: 0,
  latencySampleCount: 0,
  p95LatencyMs: 0,
};

describe("admin alert cron route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getEnv.mockReset().mockReturnValue({ cronSecret: "cron-secret" });
    mocks.getAdminAlertPeriodAggregate.mockReset().mockResolvedValue(emptyAggregate);
    mocks.getAdminAlertMilestoneAggregate.mockReset().mockResolvedValue(zeroMilestones);
    mocks.getAdminAlertOperationalAggregate.mockReset().mockResolvedValue(zeroOperational);
    mocks.getAdminAlertOutboxHealthForEnvironment
      .mockReset()
      .mockResolvedValue(emptyHealth);
    mocks.enqueueAdminAlerts.mockReset().mockImplementation(async (inputs) =>
      inputs.map((input: { event: { type: string } }, index: number) => ({
        eventType: input.event.type,
        rows: [{ id: `alert-${index}`, destination: "pulse", inserted: true }],
      })),
    );
    mocks.deliverPendingAdminAlerts.mockReset().mockResolvedValue({
      enabled: false,
      environment: null,
      claimed: 0,
      delivered: 0,
      rescheduled: 0,
      dead: 0,
      leaseLost: 0,
      errors: {},
    });
    mocks.isAdminAlertDeliveryEnabled.mockReset().mockReturnValue(false);
    mocks.resolveAdminAlertOperationalConfig.mockReset().mockReturnValue({
      monthlyBudgetUsd: 200,
      p95LatencyTargetMs: 60_000,
    });
    mocks.resolveAdminAlertsEnvironment.mockReset().mockReturnValue("production");
  });

  it("rejects requests without the cron secret before reading alert state", async () => {
    const { GET } = await import("@/app/api/cron/admin-alerts/route");

    const response = await GET(new Request("http://localhost/api/cron/admin-alerts"));

    expect(response.status).toBe(403);
    expect(mocks.getAdminAlertMilestoneAggregate).not.toHaveBeenCalled();
    expect(mocks.enqueueAdminAlerts).not.toHaveBeenCalled();
    expect(mocks.deliverPendingAdminAlerts).not.toHaveBeenCalled();
  });

  it.each(["preview", "development", "test"] as const)(
    "delivers only explicitly queued %s events without querying source-data aggregates",
    async (environment) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-26T17:00:00.000Z"));
      mocks.resolveAdminAlertsEnvironment.mockReturnValue(environment);
      mocks.isAdminAlertDeliveryEnabled.mockReturnValue(true);
      mocks.deliverPendingAdminAlerts.mockResolvedValue({
        enabled: true,
        environment,
        claimed: 1,
        delivered: 1,
        rescheduled: 0,
        dead: 0,
        leaseLost: 0,
        errors: {},
      });
      const { GET } = await import("@/app/api/cron/admin-alerts/route");

      const response = await GET(new Request("http://localhost/api/cron/admin-alerts", {
        headers: { authorization: "Bearer cron-secret" },
      }));
      const body = await response.json() as {
        scheduled: {
          dailyDue: boolean;
          weeklyDue: boolean;
          requested: number;
          inserted: number;
        };
        incidents: { requested: number; inserted: number };
      };

      expect(response.status).toBe(200);
      expect(body.scheduled).toEqual({
        dailyDue: false,
        weeklyDue: false,
        requested: 0,
        inserted: 0,
      });
      expect(body.incidents).toEqual({ requested: 0, inserted: 0 });
      expect(mocks.getAdminAlertPeriodAggregate).not.toHaveBeenCalled();
      expect(mocks.getAdminAlertMilestoneAggregate).not.toHaveBeenCalled();
      expect(mocks.getAdminAlertOperationalAggregate).not.toHaveBeenCalled();
      expect(mocks.resolveAdminAlertOperationalConfig).not.toHaveBeenCalled();
      expect(mocks.isAdminAlertDeliveryEnabled).not.toHaveBeenCalled();
      expect(mocks.enqueueAdminAlerts).not.toHaveBeenCalled();
      expect(mocks.deliverPendingAdminAlerts).toHaveBeenCalledWith({
        limit: 8,
        now: Date.parse("2026-08-26T17:00:00.000Z"),
      });
      expect(mocks.getAdminAlertOutboxHealthForEnvironment).toHaveBeenCalledOnce();
      expect(mocks.getAdminAlertOutboxHealthForEnvironment).toHaveBeenCalledWith(
        environment,
        Date.parse("2026-08-26T17:00:00.000Z"),
      );
    },
  );

  it("enqueues the DST-safe daily pulse but does not create incidents while delivery is disabled", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-27T01:00:00.000Z"));
    mocks.getAdminAlertPeriodAggregate.mockResolvedValue({
      ...emptyAggregate,
      newTeachers: 2,
      recordingsReceived: 7,
      successfulAiReviews: 4,
    });
    mocks.getAdminAlertOutboxHealthForEnvironment.mockResolvedValue({
      ...emptyHealth,
      pending: 3,
      due: 3,
      stale: 3,
      dead: 1,
      oldestPendingAt: 100,
    });
    const { GET } = await import("@/app/api/cron/admin-alerts/route");

    const response = await GET(new Request("http://localhost/api/cron/admin-alerts", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    const body = await response.json() as {
      scheduled: { dailyDue: boolean; weeklyDue: boolean; requested: number };
      incidents: { requested: number };
    };

    expect(response.status).toBe(200);
    expect(body.scheduled).toMatchObject({
      dailyDue: true,
      weeklyDue: false,
      requested: 1,
    });
    expect(body.incidents.requested).toBe(0);
    expect(mocks.enqueueAdminAlerts).toHaveBeenCalledOnce();
    expect(mocks.enqueueAdminAlerts.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        dedupeKey: "pulse:daily:2026-08-26",
        event: expect.objectContaining({
          type: "pulse.daily",
          date: "2026-08-26",
          newTeachers: 2,
          recordingsReceived: 7,
          successfulAiReviews: 4,
        }),
      }),
    ]);
    expect(mocks.deliverPendingAdminAlerts).toHaveBeenCalledWith({
      limit: 8,
      now: Date.parse("2026-08-27T01:00:00.000Z"),
    });
  });

  it("enqueues bounded aggregate incidents before delivery when the kill switch is enabled", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-26T17:00:00.000Z"));
    mocks.isAdminAlertDeliveryEnabled.mockReturnValue(true);
    mocks.getAdminAlertOutboxHealthForEnvironment
      .mockResolvedValueOnce({
        ...emptyHealth,
        pending: 4,
        due: 4,
        stale: 3,
        dead: 2,
        oldestPendingAt: 1_700_000_000_000,
      })
      .mockResolvedValueOnce(emptyHealth);
    mocks.deliverPendingAdminAlerts.mockResolvedValue({
      enabled: true,
      environment: "test",
      claimed: 2,
      delivered: 2,
      rescheduled: 0,
      dead: 0,
      leaseLost: 0,
      errors: {},
    });
    const { GET } = await import("@/app/api/cron/admin-alerts/route");

    const response = await GET(new Request("http://localhost/api/cron/admin-alerts", {
      headers: { "x-cron-secret": "cron-secret" },
    }));
    const body = await response.json() as { incidents: { requested: number; inserted: number } };

    expect(response.status).toBe(200);
    expect(body.incidents).toEqual({ requested: 2, inserted: 2 });
    const incidents = mocks.enqueueAdminAlerts.mock.calls[0]?.[0] as Array<{
      dedupeKey: string;
      event: { type: string; code: string; summary: string };
    }>;
    expect(incidents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dedupeKey: "incident:admin-alert-outbox-stale:1700000000000",
        event: expect.objectContaining({
          type: "incident",
          code: "admin_alert_outbox_stale",
        }),
      }),
      expect.objectContaining({
        dedupeKey: "incident:admin-alert-outbox-dead:2",
        event: expect.objectContaining({
          type: "incident",
          code: "admin_alert_outbox_dead",
        }),
      }),
    ]));
    expect(JSON.stringify(incidents)).not.toMatch(/@|https?:\/\//i);
    expect(mocks.enqueueAdminAlerts.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.deliverPendingAdminAlerts.mock.invocationCallOrder[0]!);
  });

  it("chunks a weekly pulse and every crossed milestone into atomic batches of at most 20", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-31T14:00:00.000Z"));
    mocks.getAdminAlertMilestoneAggregate.mockResolvedValue({
      totalTeachers: 1_000,
      activatedTeachers: 500,
      paidTeachers: 500,
      successfulAiReviews: 100_000,
      studentRecordings: 100_000,
      mrrCents: 1_000_000,
      schoolLeads: 50,
      estimatedProviderCostCents: 5_000,
    });
    const { GET } = await import("@/app/api/cron/admin-alerts/route");

    const response = await GET(new Request("http://localhost/api/cron/admin-alerts", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    const body = await response.json() as {
      scheduled: { dailyDue: boolean; weeklyDue: boolean; requested: number; inserted: number };
    };

    expect(response.status).toBe(200);
    expect(body.scheduled).toMatchObject({
      dailyDue: false,
      weeklyDue: true,
      requested: 56,
      inserted: 56,
    });
    expect(mocks.getAdminAlertPeriodAggregate).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueAdminAlerts).toHaveBeenCalledTimes(3);
    expect(mocks.enqueueAdminAlerts.mock.calls.map((call) => call[0].length))
      .toEqual([20, 20, 16]);
    const allInputs = mocks.enqueueAdminAlerts.mock.calls.flatMap((call) => call[0]);
    expect(allInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dedupeKey: "pulse:weekly:2026-08-24",
        event: expect.objectContaining({ type: "pulse.weekly" }),
      }),
      expect.objectContaining({ dedupeKey: "milestone:total_teachers:1000" }),
      expect.objectContaining({ dedupeKey: "milestone:mrr_cents:1000000" }),
    ]));
  });

  it("deduplicates crossed budget, delivery-success, and p95 latency incidents", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-26T17:00:00.000Z"));
    mocks.isAdminAlertDeliveryEnabled.mockReturnValue(true);
    mocks.resolveAdminAlertOperationalConfig.mockReturnValue({
      monthlyBudgetUsd: 1,
      p95LatencyTargetMs: 60_000,
    });
    mocks.getAdminAlertOperationalAggregate.mockResolvedValue({
      budgetPeriod: "2026-08",
      providerSpendMicrousd: 900_000,
      rollingWindowStartAt: Date.parse("2026-08-25T17:00:00.000Z"),
      rollingWindowEndAt: Date.parse("2026-08-26T17:00:00.000Z"),
      completedAttempts: 20,
      usableAttempts: 18,
      latencySampleCount: 20,
      p95LatencyMs: 70_000,
    });
    const { GET } = await import("@/app/api/cron/admin-alerts/route");

    const response = await GET(new Request("http://localhost/api/cron/admin-alerts", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    const body = await response.json() as { incidents: { requested: number; inserted: number } };

    expect(response.status).toBe(200);
    expect(body.incidents).toEqual({ requested: 5, inserted: 5 });
    const incidents = mocks.enqueueAdminAlerts.mock.calls[0]?.[0] as Array<{
      dedupeKey: string;
      event: { code: string; summary: string };
    }>;
    expect(incidents.map((input) => input.dedupeKey)).toEqual([
      "incident:ai-monthly-budget:2026-08:50",
      "incident:ai-monthly-budget:2026-08:75",
      "incident:ai-monthly-budget:2026-08:90",
      "incident:ai-delivery-success:2026-08-26",
      "incident:ai-grading-p95:2026-08-26:60000",
    ]);
    expect(incidents.map((input) => input.event.code)).toEqual([
      "ai_monthly_budget_50",
      "ai_monthly_budget_75",
      "ai_monthly_budget_90",
      "ai_delivery_success_below_95",
      "ai_grading_p95_above_target",
    ]);
    expect(incidents.map((input) => input.event.summary)).toEqual([
      "AI provider spend is $0.90 of $1.00 for 2026-08 (50% threshold crossed).",
      "AI provider spend is $0.90 of $1.00 for 2026-08 (75% threshold crossed).",
      "AI provider spend is $0.90 of $1.00 for 2026-08 (90% threshold crossed).",
      "Rolling 24-hour AI delivery: 18/20 usable (90.0%); alert threshold is 95%.",
      "Rolling 24-hour AI grading p95 is 70000 ms across 20 samples; target is 60000 ms.",
    ]);
    expect(incidents.every((input) => input.event.summary.length <= 200)).toBe(true);
    expect(JSON.stringify(incidents)).not.toMatch(/@|https?:\/\//i);
  });
});

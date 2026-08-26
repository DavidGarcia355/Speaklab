import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { requireSubscriptionPeriodBoundsMs } from "@/app/api/billing/_shared";

function subscriptionWithPeriods(
  periods: Array<{ start: number; end: number }>,
  hasMore = false,
) {
  return {
    items: {
      has_more: hasMore,
      data: periods.map((period) => ({
        current_period_start: period.start,
        current_period_end: period.end,
      })),
    },
  } as unknown as Stripe.Subscription;
}

describe("verified Stripe subscription period projection", () => {
  it("returns the one coherent item period in epoch milliseconds", () => {
    expect(
      requireSubscriptionPeriodBoundsMs(
        subscriptionWithPeriods([
          { start: 1_700_000_000, end: 1_702_592_000 },
        ]),
      ),
    ).toEqual({
      periodStart: 1_700_000_000_000,
      periodEnd: 1_702_592_000_000,
    });
  });

  it("rejects mixed item periods instead of inventing one", () => {
    expect(() =>
      requireSubscriptionPeriodBoundsMs(
        subscriptionWithPeriods([
          { start: 1_700_000_000, end: 1_702_592_000 },
          { start: 1_700_000_001, end: 1_702_592_000 },
        ]),
      ),
    ).toThrow(/do not share one current period/i);
  });

  it("rejects paginated or empty item state", () => {
    expect(() =>
      requireSubscriptionPeriodBoundsMs(
        subscriptionWithPeriods([{ start: 1_700_000_000, end: 1_702_592_000 }], true),
      ),
    ).toThrow(/could not be verified completely/i);
    expect(() => requireSubscriptionPeriodBoundsMs(subscriptionWithPeriods([]))).toThrow(
      /could not be verified completely/i,
    );
  });
});

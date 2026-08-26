import { describe, expect, it } from "vitest";
import {
  chicagoWallClockToUtc,
  getDueAdminAlertWindows,
} from "@/lib/admin-alerts/schedule";

describe("admin alert schedule", () => {
  it("resolves Chicago midnight across daylight-saving offsets", () => {
    expect(new Date(chicagoWallClockToUtc({ year: 2026, month: 1, day: 15 })).toISOString())
      .toBe("2026-01-15T06:00:00.000Z");
    expect(new Date(chicagoWallClockToUtc({ year: 2026, month: 7, day: 15 })).toISOString())
      .toBe("2026-07-15T05:00:00.000Z");
  });

  it("makes the daily pulse due at 8 PM Chicago", () => {
    const before = getDueAdminAlertWindows(Date.parse("2026-08-27T00:59:00.000Z"));
    const due = getDueAdminAlertWindows(Date.parse("2026-08-27T01:00:00.000Z"));

    expect(before.daily).toBeNull();
    expect(due.daily).toMatchObject({
      date: "2026-08-26",
      startAt: Date.parse("2026-08-26T05:00:00.000Z"),
      endAt: Date.parse("2026-08-27T01:00:00.000Z"),
      dedupeKey: "pulse:daily:2026-08-26",
    });
  });

  it("uses the prior two complete Chicago weeks for Monday scoreboards", () => {
    const result = getDueAdminAlertWindows(Date.parse("2026-08-31T14:00:00.000Z"));

    expect(result.weekly).toEqual({
      periodStart: "2026-08-24",
      periodEnd: "2026-08-30",
      currentStartAt: Date.parse("2026-08-24T05:00:00.000Z"),
      currentEndAt: Date.parse("2026-08-31T05:00:00.000Z"),
      previousStartAt: Date.parse("2026-08-17T05:00:00.000Z"),
      previousEndAt: Date.parse("2026-08-24T05:00:00.000Z"),
      dedupeKey: "pulse:weekly:2026-08-24",
    });
  });
});


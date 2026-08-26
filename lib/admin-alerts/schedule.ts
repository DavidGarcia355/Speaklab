import "server-only";

const ADMIN_TIME_ZONE = "America/Chicago";
const DAY_MS = 24 * 60 * 60 * 1_000;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

export type DailyPulseWindow = {
  date: string;
  startAt: number;
  endAt: number;
  dedupeKey: string;
};

export type WeeklyScoreboardWindow = {
  periodStart: string;
  periodEnd: string;
  currentStartAt: number;
  currentEndAt: number;
  previousStartAt: number;
  previousEndAt: number;
  dedupeKey: string;
};

const zonedFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ADMIN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

function zonedParts(timestamp: number): ZonedParts {
  const parts = zonedFormatter.formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: value("weekday"),
  };
}

function isoDate(input: { year: number; month: number; day: number }) {
  return `${input.year.toString().padStart(4, "0")}-${input.month
    .toString()
    .padStart(2, "0")}-${input.day.toString().padStart(2, "0")}`;
}

function addCalendarDays(
  input: { year: number; month: number; day: number },
  days: number,
) {
  const shifted = new Date(Date.UTC(input.year, input.month - 1, input.day) + days * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Resolves a wall-clock time in America/Chicago without assuming a fixed UTC
 * offset. The short correction loop handles both CST and CDT boundaries.
 */
export function chicagoWallClockToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
}) {
  const targetAsUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour ?? 0,
    input.minute ?? 0,
  );
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedParts(candidate);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const correction = targetAsUtc - observedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  return candidate;
}

export function getDueAdminAlertWindows(now = Date.now()): {
  daily: DailyPulseWindow | null;
  weekly: WeeklyScoreboardWindow | null;
} {
  const local = zonedParts(now);
  const localDate = { year: local.year, month: local.month, day: local.day };
  const today = isoDate(localDate);
  const todayStart = chicagoWallClockToUtc(localDate);

  const daily = local.hour >= 20
    ? {
        date: today,
        startAt: todayStart,
        endAt: now,
        dedupeKey: `pulse:daily:${today}`,
      }
    : null;

  if (local.weekday !== "Mon" || local.hour < 9) {
    return { daily, weekly: null };
  }

  const currentStartDate = addCalendarDays(localDate, -7);
  const previousStartDate = addCalendarDays(localDate, -14);
  const currentStartAt = chicagoWallClockToUtc(currentStartDate);
  const currentEndAt = todayStart;
  const previousStartAt = chicagoWallClockToUtc(previousStartDate);
  const periodEndDate = addCalendarDays(localDate, -1);

  return {
    daily,
    weekly: {
      periodStart: isoDate(currentStartDate),
      periodEnd: isoDate(periodEndDate),
      currentStartAt,
      currentEndAt,
      previousStartAt,
      previousEndAt: currentStartAt,
      dedupeKey: `pulse:weekly:${isoDate(currentStartDate)}`,
    },
  };
}

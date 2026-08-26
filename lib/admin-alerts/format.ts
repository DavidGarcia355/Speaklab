import "server-only";

import type { AdminAlertEnvironment } from "@/lib/db";
import type { AdminAlertEvent, WeeklyAdminAlertAggregate } from "@/lib/admin-alerts/events";

type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type DiscordWebhookPayload = {
  username: "Habla Pulse";
  avatar_url: "https://tryhabla.com/tryhabla-auth-logo.svg";
  allowed_mentions: { parse: [] };
  embeds: Array<{
    title: string;
    description?: string;
    color: number;
    fields: DiscordEmbedField[];
    footer: { text: string };
    timestamp: string;
  }>;
};

const COLORS = {
  traction: 0xf97316,
  revenue: 0x22c55e,
  milestone: 0xf59e0b,
  pulse: 0xf97316,
  incident: 0xef4444,
} as const;

export function escapeDiscordText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/@/g, "@\u200B")
    .replace(/([`*_{}\[\]()<>#+\-.!|~])/g, "\\$1");
}

function field(name: string, value: string | number, inline = true): DiscordEmbedField {
  return {
    name,
    value: typeof value === "number" ? String(value) : escapeDiscordText(value),
    inline,
  };
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function wholeNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function centralTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

function minutesLabel(value: number) {
  return `${wholeNumber(value)} minute${value === 1 ? "" : "s"}`;
}

function estimatedTimeSavedLabel(minutes: number) {
  if (minutes < 60) return minutesLabel(minutes);
  const hours = minutes / 60;
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: hours < 10 ? 1 : 0,
  }).format(hours)} estimated hours`;
}

function milestoneTitle(
  event: Extract<AdminAlertEvent, { type: "milestone.reached" }>,
) {
  if (event.metric === "mrr_cents") return `🏆 ${money(event.threshold)} MRR`;
  return `🏆 ${wholeNumber(event.threshold)} ${event.metric
    .replaceAll("_", " ")
    .toUpperCase()}`;
}

function durationBucketLabel(value: "under_1_minute" | "1_to_2_minutes" | "2_to_5_minutes") {
  switch (value) {
    case "under_1_minute":
      return "Under 1 minute";
    case "1_to_2_minutes":
      return "1-2 minutes";
    case "2_to_5_minutes":
      return "2-5 minutes";
  }
}

function productionAdminLink(path: string | undefined, environment: AdminAlertEnvironment) {
  if (!path || environment !== "production") return path;
  const configuredOrigin = process.env.NEXTAUTH_URL?.trim() || "";
  try {
    const origin = new URL(configuredOrigin);
    if (
      origin.protocol !== "https:"
      || origin.username
      || origin.password
      || origin.search
      || origin.hash
      || !["tryhabla.com", "www.tryhabla.com"].includes(origin.hostname.toLowerCase())
    ) {
      return path;
    }
    const url = new URL(path, origin.origin);
    return `[Open protected admin](${url.toString()})`;
  } catch {
    return path;
  }
}

function changeIndicator(current: number, previous: number, lowerIsBetter = false) {
  if (current === previous) return "⚪";
  const improved = lowerIsBetter ? current < previous : current > previous;
  return improved ? "🟢" : "🔴";
}

function comparisonLine(
  label: string,
  current: number,
  previous: number,
  options: { lowerIsBetter?: boolean; format?: (value: number) => string } = {},
) {
  const formatter = options.format ?? wholeNumber;
  return `${changeIndicator(current, previous, options.lowerIsBetter)} ${label}: ${formatter(current)} · prev ${formatter(previous)}`;
}

function weeklyFields(
  current: WeeklyAdminAlertAggregate,
  previous: WeeklyAdminAlertAggregate,
): DiscordEmbedField[] {
  const growth = [
    comparisonLine("New teachers", current.newTeachers, previous.newTeachers),
    comparisonLine("Activated", current.activatedTeachers, previous.activatedTeachers),
    comparisonLine("New paid", current.newPaidTeachers, previous.newPaidTeachers),
    comparisonLine(
      "Free-to-paid",
      current.eligibleFreeTeachers > 0
        ? current.convertedEligibleFreeTeachers / current.eligibleFreeTeachers
        : 0,
      previous.eligibleFreeTeachers > 0
        ? previous.convertedEligibleFreeTeachers / previous.eligibleFreeTeachers
        : 0,
      { format: (value) => `${(value * 100).toFixed(1)}%` },
    ),
    comparisonLine("Assignments", current.assignmentsPublished, previous.assignmentsPublished),
    comparisonLine("Recordings", current.recordingsReceived, previous.recordingsReceived),
  ].join("\n");
  const ai = [
    comparisonLine("Successful reviews", current.successfulAiReviews, previous.successfulAiReviews),
    comparisonLine(
      "AI success",
      current.aiAttempts > 0 ? (current.aiAttempts - current.aiFailures) / current.aiAttempts : 0,
      previous.aiAttempts > 0 ? (previous.aiAttempts - previous.aiFailures) / previous.aiAttempts : 0,
      { format: (value) => `${(value * 100).toFixed(1)}%` },
    ),
    comparisonLine("AI failures", current.aiFailures, previous.aiFailures, { lowerIsBetter: true }),
    comparisonLine("Retries", current.retryCount, previous.retryCount, { lowerIsBetter: true }),
    comparisonLine("Median duration", current.medianDurationSeconds, previous.medianDurationSeconds),
    comparisonLine("p90 duration", current.p90DurationSeconds, previous.p90DurationSeconds),
  ].join("\n");
  const revenue = [
    comparisonLine("Active paid", current.activePaidTeachers, previous.activePaidTeachers),
    comparisonLine("MRR", current.mrrCents, previous.mrrCents, { format: money }),
    comparisonLine(
      "Recognized revenue",
      current.recognizedRevenueCents,
      previous.recognizedRevenueCents,
      { format: money },
    ),
    comparisonLine("Cancellations", current.cancellations, previous.cancellations, { lowerIsBetter: true }),
    comparisonLine("Refunds", current.refundsCents, previous.refundsCents, { lowerIsBetter: true, format: money }),
    comparisonLine("Failed payments", current.failedPayments, previous.failedPayments, { lowerIsBetter: true }),
  ].join("\n");
  const economics = [
    comparisonLine(
      "Provider spend",
      current.estimatedProviderSpendCents,
      previous.estimatedProviderSpendCents,
      { lowerIsBetter: true, format: money },
    ),
    comparisonLine(
      "Stripe fees",
      current.estimatedStripeFeesCents,
      previous.estimatedStripeFeesCents,
      { lowerIsBetter: true, format: money },
    ),
    comparisonLine(
      "Estimated contribution",
      current.estimatedContributionCents,
      previous.estimatedContributionCents,
      { format: money },
    ),
  ].join("\n");
  const intent = [
    `⚪ Free trials exhausted: ${wholeNumber(current.freeTrialsExhausted)} · prev ${wholeNumber(previous.freeTrialsExhausted)}`,
    `⚪ Teachers at 250: ${wholeNumber(current.nearPaidLimitTeachers)} · prev ${wholeNumber(previous.nearPaidLimitTeachers)}`,
    `⚪ Teachers at 300: ${wholeNumber(current.paidLimitExhaustedTeachers)} · prev ${wholeNumber(previous.paidLimitExhaustedTeachers)}`,
    comparisonLine("School leads", current.schoolLeads, previous.schoolLeads),
  ].join("\n");
  return [
    field("Growth", growth, false),
    field("AI delivery", ai, false),
    field("Revenue", revenue, false),
    field("Estimated economics", economics, false),
    field("Intent signals", intent, false),
  ];
}

function eventPresentation(
  event: AdminAlertEvent,
  environment: AdminAlertEnvironment,
): { title: string; color: number; fields: DiscordEmbedField[] } {
  switch (event.type) {
    case "teacher.signed_up":
      return {
        title: "🌱 New teacher joined TryHabla",
        color: COLORS.traction,
        fields: [
          field("Teacher", event.teacherRef),
          field("Source", event.source ?? "Unknown"),
          field("Free AI reviews", 30),
        ],
      };
    case "class.first_created":
      return {
        title: "🏫 A teacher created their first class",
        color: COLORS.traction,
        fields: [field("Teacher", event.teacherRef), field("Time from signup", minutesLabel(event.minutesFromSignup))],
      };
    case "assignment.first_published":
      return {
        title: "📚 First assignment published",
        color: COLORS.traction,
        fields: [field("Teacher", event.teacherRef), field("Time from signup", minutesLabel(event.minutesFromSignup))],
      };
    case "recording.first_received":
      return {
        title: "🎙️ A classroom is officially live",
        color: COLORS.traction,
        fields: [
          field("Teacher", event.teacherRef),
          field("Time from assignment", minutesLabel(event.minutesFromAssignment)),
        ],
      };
    case "teacher.activated":
      return {
        title: "🎉 A teacher activated TryHabla",
        color: COLORS.traction,
        fields: [field("Teacher", event.teacherRef), field("Time to activation", minutesLabel(event.minutesToActivation))],
      };
    case "ai.first_review":
      return {
        title: "✨ TryHabla just saved a teacher time",
        color: COLORS.traction,
        fields: [
          field("Teacher", event.teacherRef),
          field("Recording", durationBucketLabel(event.durationBucket)),
          field("Estimated provider cost", money(event.estimatedCostCents)),
        ],
      };
    case "trial.half_used":
      return {
        title: "👀 A teacher is halfway through the free allowance",
        color: COLORS.traction,
        fields: [
          field("Teacher", event.teacherRef),
          field("Reviews used", event.used),
          field("Reviews remaining", event.limit - event.used),
        ],
      };
    case "trial.exhausted":
      return {
        title: "🔥 High-intent teacher used all 30 free reviews",
        color: COLORS.revenue,
        fields: [
          field("Teacher", event.teacherRef),
          field("Days since signup", event.daysSinceSignup),
          field("Upgrade status", event.upgradeStatus ?? "Unknown"),
        ],
      };
    case "subscription.started":
      return {
        title: "💸 NEW PAID TEACHER",
        color: COLORS.revenue,
        fields: [
          field("MRR added", `+${money(event.amountCents)}`),
          field("Teacher", event.teacherRef),
          field("Free reviews used", event.freeReviewsUsed),
        ],
      };
    case "subscription.renewed":
      return {
        title: "🔁 Teacher subscription renewed",
        color: COLORS.revenue,
        fields: [
          field("Retained revenue", money(event.amountCents)),
          field("Teacher", event.teacherRef),
          field("Subscription month", event.subscriptionMonth),
        ],
      };
    case "subscription.cancelled":
      return {
        title: "👋 Subscription scheduled to end",
        color: COLORS.revenue,
        fields: [
          field("Teacher", event.teacherRef),
          field("Access ends", event.accessEndsAt),
          ...(event.category ? [field("Category", event.category)] : []),
        ],
      };
    case "payment.failed":
      return {
        title: "⚠️ Payment failed",
        color: COLORS.incident,
        fields: [
          field("Teacher", event.teacherRef),
          field("Stripe status", event.stripeStatus),
          ...(event.retryAt ? [field("Next retry", event.retryAt)] : []),
        ],
      };
    case "refund.issued":
      return {
        title: "↩️ Refund issued",
        color: COLORS.revenue,
        fields: [field("Amount", money(event.amountCents)), field("Payment", event.paymentRef)],
      };
    case "allowance.near_limit":
      return {
        title: "🏫 Possible school-plan lead",
        color: COLORS.revenue,
        fields: [
          field("Teacher", event.teacherRef),
          field("Reviews used", event.used),
          field("Reviews remaining", event.limit - event.used),
        ],
      };
    case "allowance.exhausted": {
      const allowanceAdminLink = productionAdminLink(event.adminPath, environment);
      return {
        title: "🚀 Teacher reached the monthly AI limit",
        color: COLORS.revenue,
        fields: [
          field("Teacher", event.teacherRef),
          field("Reviews used", event.used),
          ...(event.outreachState ? [field("Outreach", event.outreachState)] : []),
          ...(allowanceAdminLink
            ? [{ name: "Protected record", value: allowanceAdminLink, inline: false }]
            : []),
        ],
      };
    }
    case "school.lead": {
      const adminLink = productionAdminLink(event.adminPath, environment);
      return {
        title: "🏢 NEW SCHOOL LEAD",
        color: COLORS.revenue,
        fields: [
          field("Lead", event.leadRef),
          ...(event.requestedCapacity === undefined ? [] : [field("Requested capacity", event.requestedCapacity)]),
          ...(adminLink
            ? [{ name: "Protected record", value: adminLink, inline: false }]
            : []),
        ],
      };
    }
    case "milestone.reached":
      return {
        title: milestoneTitle(event),
        color: COLORS.milestone,
        fields: [
          field(
            "Current total",
            event.metric === "mrr_cents" ? money(event.currentTotal) : event.currentTotal,
          ),
          ...(event.estimatedTeacherMinutesSaved === undefined
            ? []
            : [field(
                "Estimated teacher time saved",
                estimatedTimeSavedLabel(event.estimatedTeacherMinutesSaved),
              )]),
          ...(event.estimatedProviderCostCents === undefined
            ? []
            : [field("Estimated provider cost", money(event.estimatedProviderCostCents))]),
        ],
      };
    case "pulse.daily":
      return {
        title: "📊 TRYHABLA TODAY",
        color: COLORS.pulse,
        fields: [
          field("Date", event.date),
          field("New teachers", event.newTeachers),
          field("Activated teachers", event.activatedTeachers),
          field("New paid teachers", event.newPaidTeachers),
          field("New MRR", money(event.newMrrCents)),
          field("Recordings received", event.recordingsReceived),
          field("Successful AI reviews", event.successfulAiReviews),
          field("Free trials exhausted", event.freeTrialsExhausted),
          field("School leads", event.schoolLeads),
          field("Estimated provider spend", money(event.estimatedProviderSpendCents)),
          field(
            "AI success rate",
            percent(Math.max(0, event.aiAttempts - event.aiFailures), event.aiAttempts),
          ),
        ],
      };
    case "pulse.weekly":
      return {
        title: "📈 TRYHABLA WEEKLY SCOREBOARD",
        color: COLORS.pulse,
        fields: [
          field("Window", `${event.periodStart} through ${event.periodEnd}`, false),
          ...weeklyFields(event.current, event.previous),
        ],
      };
    case "incident":
      return {
        title: "🚨 TryHabla incident",
        color: COLORS.incident,
        fields: [field("Code", event.code), field("Summary", event.summary, false)],
      };
  }
}

export function formatAdminAlertForDiscord(input: {
  event: AdminAlertEvent;
  environment: AdminAlertEnvironment;
  occurredAt: number;
}): DiscordWebhookPayload {
  const presentation = eventPresentation(input.event, input.environment);
  const environmentBadge = input.environment === "production"
    ? undefined
    : `**${input.environment.toUpperCase()} — TESTING ONLY**`;
  return {
    username: "Habla Pulse",
    avatar_url: "https://tryhabla.com/tryhabla-auth-logo.svg",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: presentation.title,
      ...(environmentBadge ? { description: environmentBadge } : {}),
      color: presentation.color,
      fields: presentation.fields,
      footer: {
        text: `${centralTime(input.occurredAt)} · ${input.environment}`,
      },
      timestamp: new Date(input.occurredAt).toISOString(),
    }],
  };
}

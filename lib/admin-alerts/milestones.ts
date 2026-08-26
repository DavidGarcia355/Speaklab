import "server-only";

import type { AdminAlertEvent } from "@/lib/admin-alerts/events";

export type AdminMilestoneSnapshot = {
  totalTeachers: number;
  activatedTeachers: number;
  paidTeachers: number;
  successfulAiReviews: number;
  studentRecordings: number;
  mrrCents: number;
  schoolLeads: number;
  estimatedProviderCostCents: number;
};

export type AdminMilestoneIntent = {
  event: Extract<AdminAlertEvent, { type: "milestone.reached" }>;
  dedupeKey: string;
};

const THRESHOLDS = {
  total_teachers: [1, 5, 10, 25, 50, 100, 250, 500, 1_000],
  activated_teachers: [1, 5, 10, 25, 50, 100, 250, 500],
  paid_teachers: [1, 5, 10, 25, 50, 100, 250, 500],
  successful_ai_reviews: [1, 30, 100, 300, 1_000, 5_000, 10_000, 50_000, 100_000],
  student_recordings: [1, 100, 500, 1_000, 5_000, 10_000, 50_000, 100_000],
  mrr_cents: [2_000, 10_000, 20_000, 50_000, 100_000, 250_000, 500_000, 1_000_000],
  school_leads: [1, 5, 10, 25, 50],
} as const;

const TEACHER_MINUTES_SAVED_PER_SUCCESSFUL_REVIEW = 2.5;

function safeCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function buildAdminMilestoneIntents(
  snapshot: AdminMilestoneSnapshot,
): AdminMilestoneIntent[] {
  const totals = {
    total_teachers: safeCount(snapshot.totalTeachers),
    activated_teachers: safeCount(snapshot.activatedTeachers),
    paid_teachers: safeCount(snapshot.paidTeachers),
    successful_ai_reviews: safeCount(snapshot.successfulAiReviews),
    student_recordings: safeCount(snapshot.studentRecordings),
    mrr_cents: safeCount(snapshot.mrrCents),
    school_leads: safeCount(snapshot.schoolLeads),
  };
  const intents: AdminMilestoneIntent[] = [];

  for (const metric of Object.keys(THRESHOLDS) as Array<keyof typeof THRESHOLDS>) {
    const currentTotal = totals[metric];
    for (const threshold of THRESHOLDS[metric]) {
      if (currentTotal < threshold) continue;
      intents.push({
        event: {
          type: "milestone.reached",
          metric,
          threshold,
          currentTotal,
          ...(metric === "successful_ai_reviews"
            ? {
                estimatedTeacherMinutesSaved: Math.floor(
                  currentTotal * TEACHER_MINUTES_SAVED_PER_SUCCESSFUL_REVIEW,
                ),
                estimatedProviderCostCents: safeCount(snapshot.estimatedProviderCostCents),
              }
            : {}),
        },
        dedupeKey: `milestone:${metric}:${threshold}`,
      });
    }
  }

  return intents;
}


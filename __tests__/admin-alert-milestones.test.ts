import { describe, expect, it } from "vitest";
import { buildAdminMilestoneIntents } from "@/lib/admin-alerts/milestones";

describe("admin alert milestones", () => {
  it("returns every newly dedupeable threshold at or below the current total", () => {
    const intents = buildAdminMilestoneIntents({
      totalTeachers: 10,
      activatedTeachers: 0,
      paidTeachers: 1,
      successfulAiReviews: 1_000,
      studentRecordings: 602,
      mrrCents: 2_000,
      schoolLeads: 0,
      estimatedProviderCostCents: 1_330,
    });

    expect(intents.map((intent) => intent.dedupeKey)).toContain("milestone:total_teachers:10");
    expect(intents.map((intent) => intent.dedupeKey)).toContain("milestone:student_recordings:500");
    expect(intents.map((intent) => intent.dedupeKey)).not.toContain("milestone:student_recordings:1000");
    expect(intents.find((intent) => intent.dedupeKey === "milestone:successful_ai_reviews:1000"))
      .toMatchObject({
        event: {
          currentTotal: 1_000,
          estimatedTeacherMinutesSaved: 2_500,
          estimatedProviderCostCents: 1_330,
        },
      });
  });

  it("clamps invalid counters instead of creating malformed events", () => {
    expect(buildAdminMilestoneIntents({
      totalTeachers: Number.NaN,
      activatedTeachers: -1,
      paidTeachers: 0,
      successfulAiReviews: 0,
      studentRecordings: 0,
      mrrCents: 0,
      schoolLeads: 0,
      estimatedProviderCostCents: 0,
    })).toEqual([]);
  });
});

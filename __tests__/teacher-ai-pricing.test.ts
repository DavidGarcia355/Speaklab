import { describe, expect, it } from "vitest";
import {
  TEACHER_AI_PRICE_BOOK,
  estimateTeacherAiPricing,
  type TeacherAiPricingInputs,
} from "@/lib/teacher-ai-pricing";

const typicalInputs: TeacherAiPricingInputs = {
  classCount: 5,
  studentsPerClass: 28,
  aiAssignmentsPerClass: 4,
  submissionsPerStudent: 1,
  averageAudioMinutes: 2,
};

describe("Teacher AI pricing", () => {
  it("locks one canonical v3 Free and Teacher plan contract", () => {
    expect(TEACHER_AI_PRICE_BOOK).toEqual({
      id: "tryhabla-teacher-usd-v3",
      currency: "USD",
      status: "active",
      publishedAt: "2026-08-26",
      effectiveAt: "2026-08-26",
      plan: "teacher",
      billingModel: "licensed_allowance",
      monthlyPriceUsd: 20,
      billingCadence: "month",
      includedAiReviews: 300,
      maxAudioMinutesPerReview: 5,
      overagePolicy: "pause_ai",
      rollover: false,
      successfulReviewIdentity: "teacher_assignment_recording",
      feedbackIncluded: true,
      freeAllowance: {
        reviews: 30,
        period: "account_lifetime",
        rollover: false,
      },
    });
    expect(Object.isFrozen(TEACHER_AI_PRICE_BOOK)).toBe(true);
    expect(Object.isFrozen(TEACHER_AI_PRICE_BOOK.freeAllowance)).toBe(true);
  });

  it("estimates classroom review volume and plan fit without exposing provider cost", () => {
    const estimate = estimateTeacherAiPricing(typicalInputs);

    expect(estimate).toEqual({
      priceBookId: "tryhabla-teacher-usd-v3",
      totalStudents: 140,
      projectedAiReviews: 560,
      projectedAudioMinutes: 1_120,
      freeAllowanceReviews: 30,
      fitsFreeLifetime: false,
      teacherIncludedReviews: 300,
      teacherMonthlyPriceUsd: 20,
      teacherPeriodsNeeded: 2,
      fitsOneTeacherPeriod: false,
      includedClassAssignmentSets: 10,
    });
    expect(Object.keys(estimate)).not.toEqual(
      expect.arrayContaining(["providerCost", "margin", "overageCharge"]),
    );
  });

  it("treats Free and Teacher as separate caps instead of stacking them", () => {
    const free = estimateTeacherAiPricing({
      classCount: 1,
      studentsPerClass: 30,
      aiAssignmentsPerClass: 1,
      submissionsPerStudent: 1,
      averageAudioMinutes: 1,
    });
    expect(free.fitsFreeLifetime).toBe(true);
    expect(free.teacherPeriodsNeeded).toBe(1);
    expect(free.fitsOneTeacherPeriod).toBe(true);

    const oneTeacherPeriod = estimateTeacherAiPricing({
      classCount: 1,
      studentsPerClass: 30,
      aiAssignmentsPerClass: 10,
      submissionsPerStudent: 1,
      averageAudioMinutes: 5,
    });
    expect(oneTeacherPeriod.projectedAiReviews).toBe(300);
    expect(oneTeacherPeriod.fitsFreeLifetime).toBe(false);
    expect(oneTeacherPeriod.teacherPeriodsNeeded).toBe(1);
    expect(oneTeacherPeriod.fitsOneTeacherPeriod).toBe(true);

    const overCap = estimateTeacherAiPricing({
      classCount: 1,
      studentsPerClass: 30,
      aiAssignmentsPerClass: 12,
      submissionsPerStudent: 1,
      averageAudioMinutes: 5,
    });
    expect(overCap.projectedAiReviews).toBe(360);
    expect(overCap.teacherPeriodsNeeded).toBe(2);
    expect(overCap.fitsOneTeacherPeriod).toBe(false);
  });

  it("reports zero plan periods for zero projected reviews", () => {
    const estimate = estimateTeacherAiPricing({
      ...typicalInputs,
      classCount: 10,
      studentsPerClass: 1,
      aiAssignmentsPerClass: 0,
    });

    expect(estimate.fitsFreeLifetime).toBe(true);
    expect(estimate.teacherPeriodsNeeded).toBe(0);
  });

  it("rejects invalid or unbounded calculator values", () => {
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, classCount: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, studentsPerClass: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, averageAudioMinutes: 5.1 }),
    ).toThrow(RangeError);
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, classCount: 51 }),
    ).toThrow(RangeError);
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, submissionsPerStudent: 1.5 }),
    ).toThrow(RangeError);
  });
});

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

describe("teacher AI pricing", () => {
  it("locks launch price book v2 as an immutable policy contract", () => {
    expect(TEACHER_AI_PRICE_BOOK).toEqual({
      id: "habla-teacher-ai-usd-v2",
      currency: "USD",
      status: "active",
      publishedAt: "2026-08-21",
      effectiveAt: "2026-08-21",
      baseSuccessfulGradeUsd: 0.05,
      audioMinuteUsd: 0.01,
      successfulGradeIdentity: "teacher_assignment_recording",
      feedbackIncluded: true,
      freeCreditPolicy: {
        kind: "qualifying_classes_minus_one",
        qualifyingClass: "rostered_student_and_assignment",
        maxQualifyingClasses: 30,
        period: "utc_month",
        covers: "entire_ai_result",
        rollover: false,
      },
    });
    expect(Object.isFrozen(TEACHER_AI_PRICE_BOOK)).toBe(true);
    expect(Object.isFrozen(TEACHER_AI_PRICE_BOOK.freeCreditPolicy)).toBe(true);
  });

  it("uses classroom volume and audio duration with feedback included", () => {
    const estimate = estimateTeacherAiPricing(typicalInputs);

    expect(estimate).toMatchObject({
      priceBookId: "habla-teacher-ai-usd-v2",
      totalStudents: 140,
      projectedAiGrades: 560,
      monthlyFreeAiGrades: 4,
      appliedFreeAiGrades: 4,
      billableAiGrades: 556,
      billableAudioMinutes: 1_112,
      baseChargeUsd: 27.8,
      audioChargeUsd: 11.12,
      estimatedMonthlyUsd: 38.92,
      estimatedPerSuccessfulGradeUsd: 0.07,
      freeCreditValueUsd: 0.28,
    });
  });

  it("provides exactly one fewer monthly credit than active classes", () => {
    expect(
      estimateTeacherAiPricing({ ...typicalInputs, classCount: 1 }).monthlyFreeAiGrades,
    ).toBe(0);
    expect(
      estimateTeacherAiPricing({ ...typicalInputs, classCount: 7 }).monthlyFreeAiGrades,
    ).toBe(6);
    expect(
      estimateTeacherAiPricing({ ...typicalInputs, classCount: 30 }).monthlyFreeAiGrades,
    ).toBe(29);

    const canonical = estimateTeacherAiPricing({
      classCount: 7,
      studentsPerClass: 40,
      aiAssignmentsPerClass: 8,
      submissionsPerStudent: 1,
      averageAudioMinutes: 5,
    });

    expect(canonical.projectedAiGrades).toBe(2_240);
    expect(canonical.billableAiGrades).toBe(2_234);
    expect(canonical.estimatedPerSuccessfulGradeUsd).toBe(0.1);
    expect(canonical.estimatedMonthlyUsd).toBe(223.4);
  });

  it("never turns unused free credits into a negative bill", () => {
    const estimate = estimateTeacherAiPricing({
      ...typicalInputs,
      classCount: 10,
      studentsPerClass: 1,
      aiAssignmentsPerClass: 0,
    });

    expect(estimate.monthlyFreeAiGrades).toBe(9);
    expect(estimate.appliedFreeAiGrades).toBe(0);
    expect(estimate.billableAiGrades).toBe(0);
    expect(estimate.estimatedMonthlyUsd).toBe(0);
  });

  it("rejects invalid or unbounded calculator values", () => {
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, classCount: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, studentsPerClass: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, averageAudioMinutes: 10.5 }),
    ).toThrow(RangeError);
    expect(() =>
      estimateTeacherAiPricing({ ...typicalInputs, classCount: 31 }),
    ).toThrow(RangeError);
  });
});

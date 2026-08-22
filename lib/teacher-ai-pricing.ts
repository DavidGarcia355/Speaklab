export type TeacherAiPricingInputs = {
  classCount: number;
  studentsPerClass: number;
  aiAssignmentsPerClass: number;
  submissionsPerStudent: number;
  averageAudioMinutes: number;
};

export type TeacherAiPriceBook = {
  readonly id: string;
  readonly currency: "USD";
  readonly status: "planned" | "active";
  readonly publishedAt: string;
  readonly effectiveAt: string | null;
  readonly baseSuccessfulGradeUsd: number;
  readonly audioMinuteUsd: number;
  readonly feedbackIncluded: true;
  readonly freeCreditPolicy: {
    readonly kind: "qualifying_classes_minus_one";
    readonly qualifyingClass: "rostered_student_and_assignment";
    readonly period: "utc_month";
    readonly covers: "entire_ai_result";
    readonly rollover: false;
  };
};

export const TEACHER_AI_PRICE_BOOK: TeacherAiPriceBook = Object.freeze({
  id: "habla-teacher-ai-usd-v2",
  currency: "USD",
  status: "active",
  publishedAt: "2026-08-21",
  effectiveAt: "2026-08-21",
  baseSuccessfulGradeUsd: 0.05,
  audioMinuteUsd: 0.01,
  feedbackIncluded: true,
  freeCreditPolicy: Object.freeze({
    kind: "qualifying_classes_minus_one",
    qualifyingClass: "rostered_student_and_assignment",
    period: "utc_month",
    covers: "entire_ai_result",
    rollover: false,
  }),
});

/** @deprecated Read metadata from TEACHER_AI_PRICE_BOOK so rates and policy stay versioned together. */
export const TEACHER_AI_PRICE_BOOK_META = Object.freeze({
  id: TEACHER_AI_PRICE_BOOK.id,
  currency: TEACHER_AI_PRICE_BOOK.currency,
  status: TEACHER_AI_PRICE_BOOK.status,
  publishedAt: TEACHER_AI_PRICE_BOOK.publishedAt,
  effectiveAt: TEACHER_AI_PRICE_BOOK.effectiveAt,
});

export const TEACHER_AI_PRICING_LIMITS = Object.freeze({
  classCount: { min: 0, max: 30 },
  studentsPerClass: { min: 0, max: 100 },
  aiAssignmentsPerClass: { min: 0, max: 30 },
  submissionsPerStudent: { min: 0, max: 3 },
  averageAudioMinutes: { min: 0, max: 10 },
});

const MICRO_USD_PER_USD = 1_000_000;

function assertInRange(
  name: keyof TeacherAiPricingInputs,
  value: number,
  options: { min: number; max: number; integer?: boolean },
) {
  if (!Number.isFinite(value) || value < options.min || value > options.max) {
    throw new RangeError(`${name} must be between ${options.min} and ${options.max}.`);
  }

  if (options.integer && !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a whole number.`);
  }
}

function validateInputs(input: TeacherAiPricingInputs) {
  assertInRange("classCount", input.classCount, {
    ...TEACHER_AI_PRICING_LIMITS.classCount,
    integer: true,
  });
  assertInRange("studentsPerClass", input.studentsPerClass, {
    ...TEACHER_AI_PRICING_LIMITS.studentsPerClass,
    integer: true,
  });
  assertInRange("aiAssignmentsPerClass", input.aiAssignmentsPerClass, {
    ...TEACHER_AI_PRICING_LIMITS.aiAssignmentsPerClass,
    integer: true,
  });
  assertInRange("submissionsPerStudent", input.submissionsPerStudent, {
    ...TEACHER_AI_PRICING_LIMITS.submissionsPerStudent,
    integer: true,
  });
  assertInRange("averageAudioMinutes", input.averageAudioMinutes, {
    ...TEACHER_AI_PRICING_LIMITS.averageAudioMinutes,
  });
}

function validatePriceBook(priceBook: TeacherAiPriceBook) {
  for (const [name, value] of Object.entries({
    baseSuccessfulGradeUsd: priceBook.baseSuccessfulGradeUsd,
    audioMinuteUsd: priceBook.audioMinuteUsd,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative number.`);
    }
  }
}

function dollarsToMicros(amount: number) {
  return Math.round(amount * MICRO_USD_PER_USD);
}

function microsToDollars(amount: number) {
  return amount / MICRO_USD_PER_USD;
}

export function calculatePrepaidAiUsageMicrousd(
  input: { successfulGrades: number; audioSeconds: number },
  priceBook: TeacherAiPriceBook = TEACHER_AI_PRICE_BOOK,
) {
  validatePriceBook(priceBook);
  if (!Number.isSafeInteger(input.successfulGrades) || input.successfulGrades < 0) {
    throw new RangeError("successfulGrades must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(input.audioSeconds) || input.audioSeconds < 0) {
    throw new RangeError("audioSeconds must be a non-negative safe integer.");
  }

  const gradeMicrousd = dollarsToMicros(
    input.successfulGrades * priceBook.baseSuccessfulGradeUsd,
  );
  const audioMicrousd = dollarsToMicros(
    (input.audioSeconds / 60) * priceBook.audioMinuteUsd,
  );
  return {
    priceBookId: priceBook.id,
    gradeMicrousd,
    audioMicrousd,
    totalMicrousd: gradeMicrousd + audioMicrousd,
  };
}

export function estimateTeacherAiPricing(
  input: TeacherAiPricingInputs,
  priceBook: TeacherAiPriceBook = TEACHER_AI_PRICE_BOOK,
) {
  validateInputs(input);
  validatePriceBook(priceBook);

  const totalStudents = input.classCount * input.studentsPerClass;
  const projectedAiGrades =
    totalStudents * input.aiAssignmentsPerClass * input.submissionsPerStudent;
  const monthlyFreeAiGrades = Math.max(0, input.classCount - 1);
  const appliedFreeAiGrades = Math.min(projectedAiGrades, monthlyFreeAiGrades);
  const billableAiGrades = Math.max(0, projectedAiGrades - appliedFreeAiGrades);
  const billableAudioMinutes = billableAiGrades * input.averageAudioMinutes;

  const baseMicros = dollarsToMicros(
    billableAiGrades * priceBook.baseSuccessfulGradeUsd,
  );
  const audioMicros = dollarsToMicros(billableAudioMinutes * priceBook.audioMinuteUsd);
  const estimatedMonthlyMicros = baseMicros + audioMicros;

  const perSuccessfulGradeMicros = dollarsToMicros(
    priceBook.baseSuccessfulGradeUsd +
      input.averageAudioMinutes * priceBook.audioMinuteUsd,
  );
  const freeCreditValueMicros = perSuccessfulGradeMicros * appliedFreeAiGrades;

  return {
    priceBookId: priceBook.id,
    totalStudents,
    projectedAiGrades,
    monthlyFreeAiGrades,
    appliedFreeAiGrades,
    billableAiGrades,
    billableAudioMinutes,
    baseChargeUsd: microsToDollars(baseMicros),
    audioChargeUsd: microsToDollars(audioMicros),
    estimatedMonthlyUsd: microsToDollars(estimatedMonthlyMicros),
    estimatedPerSuccessfulGradeUsd: microsToDollars(perSuccessfulGradeMicros),
    freeCreditValueUsd: microsToDollars(freeCreditValueMicros),
  };
}

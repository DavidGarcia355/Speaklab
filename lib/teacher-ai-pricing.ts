export type TeacherAiPricingInputs = {
  classCount: number;
  studentsPerClass: number;
  aiAssignmentsPerClass: number;
  submissionsPerStudent: number;
  averageAudioMinutes: number;
  outputTokensPerGrade: number;
};

export type TeacherAiPriceBook = {
  readonly id: string;
  readonly currency: "USD";
  readonly status: "planned" | "active";
  readonly publishedAt: string;
  readonly effectiveAt: string | null;
  readonly baseSuccessfulGradeUsd: number;
  readonly audioMinuteUsd: number;
  readonly outputThousandTokensUsd: number;
  readonly freeCreditPolicy: {
    readonly kind: "qualifying_classes_minus_one";
    readonly qualifyingClass: "rostered_student_and_assignment";
    readonly period: "utc_month";
    readonly covers: "entire_ai_result";
    readonly rollover: false;
  };
};

export const TEACHER_AI_PRICE_BOOK: TeacherAiPriceBook = Object.freeze({
  id: "habla-teacher-ai-usd-v1",
  currency: "USD",
  status: "active",
  publishedAt: "2026-08-21",
  effectiveAt: "2026-08-21",
  baseSuccessfulGradeUsd: 0.01,
  audioMinuteUsd: 0.01,
  outputThousandTokensUsd: 0.005,
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
  outputTokensPerGrade: { min: 0, max: 2_000 },
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
  assertInRange("outputTokensPerGrade", input.outputTokensPerGrade, {
    ...TEACHER_AI_PRICING_LIMITS.outputTokensPerGrade,
    integer: true,
  });
}

function validatePriceBook(priceBook: TeacherAiPriceBook) {
  for (const [name, value] of Object.entries({
    baseSuccessfulGradeUsd: priceBook.baseSuccessfulGradeUsd,
    audioMinuteUsd: priceBook.audioMinuteUsd,
    outputThousandTokensUsd: priceBook.outputThousandTokensUsd,
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
  const billableOutputTokens = billableAiGrades * input.outputTokensPerGrade;

  const baseMicros = dollarsToMicros(
    billableAiGrades * priceBook.baseSuccessfulGradeUsd,
  );
  const audioMicros = dollarsToMicros(billableAudioMinutes * priceBook.audioMinuteUsd);
  const outputMicros = dollarsToMicros(
    (billableOutputTokens / 1_000) * priceBook.outputThousandTokensUsd,
  );
  const estimatedMonthlyMicros = baseMicros + audioMicros + outputMicros;

  const perSuccessfulGradeMicros = dollarsToMicros(
    priceBook.baseSuccessfulGradeUsd +
      input.averageAudioMinutes * priceBook.audioMinuteUsd +
      (input.outputTokensPerGrade / 1_000) * priceBook.outputThousandTokensUsd,
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
    billableOutputTokens,
    baseChargeUsd: microsToDollars(baseMicros),
    audioChargeUsd: microsToDollars(audioMicros),
    outputChargeUsd: microsToDollars(outputMicros),
    estimatedMonthlyUsd: microsToDollars(estimatedMonthlyMicros),
    estimatedPerSuccessfulGradeUsd: microsToDollars(perSuccessfulGradeMicros),
    freeCreditValueUsd: microsToDollars(freeCreditValueMicros),
  };
}

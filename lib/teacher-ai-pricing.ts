export type TeacherAiPricingInputs = {
  classCount: number;
  studentsPerClass: number;
  aiAssignmentsPerClass: number;
  submissionsPerStudent: number;
  averageAudioMinutes: number;
};

export type TeacherAiPriceBook = Readonly<{
  id: "tryhabla-teacher-usd-v3";
  currency: "USD";
  status: "active";
  publishedAt: string;
  effectiveAt: string;
  plan: "teacher";
  billingModel: "licensed_allowance";
  monthlyPriceUsd: 20;
  billingCadence: "month";
  includedAiReviews: 300;
  maxAudioMinutesPerReview: 5;
  overagePolicy: "pause_ai";
  rollover: false;
  successfulReviewIdentity: "teacher_assignment_recording";
  feedbackIncluded: true;
  freeAllowance: Readonly<{
    reviews: 30;
    period: "account_lifetime";
    rollover: false;
  }>;
}>;

/** Canonical commercial contract shared by Stripe, entitlement, quota, and UI code. */
export const TEACHER_AI_PRICE_BOOK: TeacherAiPriceBook = Object.freeze({
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
  freeAllowance: Object.freeze({
    reviews: 30,
    period: "account_lifetime",
    rollover: false,
  }),
});

export const TEACHER_AI_PRICE_BOOK_META = Object.freeze({
  id: TEACHER_AI_PRICE_BOOK.id,
  currency: TEACHER_AI_PRICE_BOOK.currency,
  status: TEACHER_AI_PRICE_BOOK.status,
  publishedAt: TEACHER_AI_PRICE_BOOK.publishedAt,
  effectiveAt: TEACHER_AI_PRICE_BOOK.effectiveAt,
});

export const TEACHER_AI_PRICING_LIMITS = Object.freeze({
  classCount: { min: 0, max: 50 },
  studentsPerClass: { min: 0, max: 100 },
  aiAssignmentsPerClass: { min: 0, max: 30 },
  submissionsPerStudent: { min: 0, max: 3 },
  averageAudioMinutes: {
    min: 0,
    max: TEACHER_AI_PRICE_BOOK.maxAudioMinutesPerReview,
  },
});

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

/** Estimates review volume and plan fit; it never estimates provider cost or overages. */
export function estimateTeacherAiPricing(
  input: TeacherAiPricingInputs,
  priceBook: TeacherAiPriceBook = TEACHER_AI_PRICE_BOOK,
) {
  validateInputs(input);
  if (priceBook.id !== TEACHER_AI_PRICE_BOOK.id) {
    throw new Error("Only the active TryHabla Teacher price book can be estimated.");
  }

  const totalStudents = input.classCount * input.studentsPerClass;
  const projectedAiReviews =
    totalStudents * input.aiAssignmentsPerClass * input.submissionsPerStudent;
  const teacherPeriodsNeeded =
    projectedAiReviews === 0
      ? 0
      : Math.ceil(projectedAiReviews / priceBook.includedAiReviews);
  const reviewsPerClassAssignment = input.studentsPerClass * input.submissionsPerStudent;
  const includedClassAssignmentSets =
    reviewsPerClassAssignment === 0
      ? 0
      : Math.floor(priceBook.includedAiReviews / reviewsPerClassAssignment);

  return Object.freeze({
    priceBookId: priceBook.id,
    totalStudents,
    projectedAiReviews,
    projectedAudioMinutes: projectedAiReviews * input.averageAudioMinutes,
    freeAllowanceReviews: priceBook.freeAllowance.reviews,
    fitsFreeLifetime: projectedAiReviews <= priceBook.freeAllowance.reviews,
    teacherIncludedReviews: priceBook.includedAiReviews,
    teacherMonthlyPriceUsd: priceBook.monthlyPriceUsd,
    teacherPeriodsNeeded,
    fitsOneTeacherPeriod: projectedAiReviews <= priceBook.includedAiReviews,
    includedClassAssignmentSets,
  });
}

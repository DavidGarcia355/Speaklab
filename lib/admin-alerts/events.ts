import "server-only";

import { z } from "zod";
import type { AdminAlertDestination } from "@/lib/db";

const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0).max(1_000_000_000);
const cents = z.number().int().min(0).max(1_000_000_000_000);
const signedCents = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const teacherRef = z.string().regex(/^T-[A-F0-9]{12}$/);
const leadRef = z.string().regex(/^L-[A-F0-9]{12}$/);
const paymentRef = z.string().regex(/^P-[A-F0-9]{12}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
});
const isoTimestamp = z.string().max(40).refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
});

const unsafeIncidentText = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|https?:\/\/|www\.|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:sk_(?:live|test)|rk_(?:live|test)|whsec_|ghp_|xox[baprs]-|eyJ[A-Za-z0-9_-]*\.)[A-Za-z0-9._-]*)/i;
const incidentSummary = z.string().trim().min(1).max(200).refine(
  (value) => !unsafeIncidentText.test(value) && !/[\u0000-\u001F\u007F]/.test(value),
  "Incident summaries cannot contain contact details, URLs, IP addresses, or secret-like values.",
);
const protectedAdminPath = z.string().regex(/^\/admin(?:\/[A-Za-z0-9_-]+)*$/);

const weeklyAggregateSchema = z.object({
  newTeachers: count,
  activatedTeachers: count,
  newPaidTeachers: count,
  eligibleFreeTeachers: count,
  convertedEligibleFreeTeachers: count,
  assignmentsPublished: count,
  recordingsReceived: count,
  successfulAiReviews: count,
  aiAttempts: count,
  aiFailures: count,
  retryCount: count,
  durationSampleCount: count,
  medianDurationSeconds: nonNegativeInteger,
  p90DurationSeconds: nonNegativeInteger,
  activePaidTeachers: count,
  mrrCents: cents,
  recognizedRevenueCents: cents,
  cancellations: count,
  refundsCents: cents,
  failedPayments: count,
  estimatedProviderSpendCents: cents,
  estimatedStripeFeesCents: cents,
  estimatedContributionCents: signedCents,
  freeTrialsExhausted: count,
  nearPaidLimitTeachers: count,
  paidLimitExhaustedTeachers: count,
  schoolLeads: count,
}).strict();

export const adminAlertEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("teacher.signed_up"),
    teacherRef,
    source: z.enum(["direct", "organic", "referral", "school", "social", "other"]).optional(),
  }).strict(),
  z.object({
    type: z.literal("class.first_created"),
    teacherRef,
    minutesFromSignup: nonNegativeInteger,
  }).strict(),
  z.object({
    type: z.literal("assignment.first_published"),
    teacherRef,
    minutesFromSignup: nonNegativeInteger,
  }).strict(),
  z.object({
    type: z.literal("recording.first_received"),
    teacherRef,
    minutesFromAssignment: nonNegativeInteger,
  }).strict(),
  z.object({
    type: z.literal("teacher.activated"),
    teacherRef,
    minutesToActivation: nonNegativeInteger,
  }).strict(),
  z.object({
    type: z.literal("ai.first_review"),
    teacherRef,
    durationBucket: z.enum([
      "under_1_minute",
      "1_to_2_minutes",
      "2_to_5_minutes",
    ]),
    estimatedCostCents: cents,
  }).strict(),
  z.object({
    type: z.literal("trial.half_used"),
    teacherRef,
    used: z.literal(15),
    limit: z.literal(30),
  }).strict(),
  z.object({
    type: z.literal("trial.exhausted"),
    teacherRef,
    daysSinceSignup: nonNegativeInteger,
    upgradeStatus: z.enum(["free", "checkout_started", "paid"]).optional(),
  }).strict(),
  z.object({
    type: z.literal("subscription.started"),
    teacherRef,
    amountCents: z.literal(2_000),
    freeReviewsUsed: z.number().int().min(0).max(30),
  }).strict(),
  z.object({
    type: z.literal("subscription.renewed"),
    teacherRef,
    amountCents: z.literal(2_000),
    subscriptionMonth: z.number().int().min(1).max(1_200),
  }).strict(),
  z.object({
    type: z.literal("subscription.cancelled"),
    teacherRef,
    accessEndsAt: isoTimestamp,
    category: z.enum([
      "cost",
      "no_longer_needed",
      "missing_feature",
      "technical_issue",
      "other",
    ]).optional(),
  }).strict(),
  z.object({
    type: z.literal("payment.failed"),
    teacherRef,
    stripeStatus: z.enum([
      "requires_payment_method",
      "past_due",
      "unpaid",
      "incomplete",
      "canceled",
      "unknown",
    ]),
    retryAt: isoTimestamp.optional(),
  }).strict(),
  z.object({
    type: z.literal("refund.issued"),
    paymentRef,
    amountCents: cents,
  }).strict(),
  z.object({
    type: z.literal("allowance.near_limit"),
    teacherRef,
    used: z.literal(250),
    limit: z.literal(300),
  }).strict(),
  z.object({
    type: z.literal("allowance.exhausted"),
    teacherRef,
    used: z.literal(300),
    limit: z.literal(300),
    outreachState: z.enum(["not_started", "contacted", "qualified", "closed"]).optional(),
    adminPath: protectedAdminPath.optional(),
  }).strict(),
  z.object({
    type: z.literal("school.lead"),
    leadRef,
    requestedCapacity: count.optional(),
    adminPath: protectedAdminPath.optional(),
  }).strict(),
  z.object({
    type: z.literal("milestone.reached"),
    metric: z.enum([
      "total_teachers",
      "activated_teachers",
      "paid_teachers",
      "successful_ai_reviews",
      "student_recordings",
      "mrr_cents",
      "school_leads",
    ]),
    threshold: nonNegativeInteger,
    currentTotal: nonNegativeInteger,
    estimatedTeacherMinutesSaved: nonNegativeInteger.optional(),
    estimatedProviderCostCents: cents.optional(),
  }).strict(),
  z.object({
    type: z.literal("pulse.daily"),
    date: isoDate,
    newTeachers: count,
    activatedTeachers: count,
    newPaidTeachers: count,
    newMrrCents: cents,
    recordingsReceived: count,
    successfulAiReviews: count,
    freeTrialsExhausted: count,
    schoolLeads: count,
    estimatedProviderSpendCents: cents,
    aiAttempts: count,
    aiFailures: count,
  }).strict(),
  z.object({
    type: z.literal("pulse.weekly"),
    periodStart: isoDate,
    periodEnd: isoDate,
    current: weeklyAggregateSchema,
    previous: weeklyAggregateSchema,
  }).strict(),
  z.object({
    type: z.literal("incident"),
    code: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    summary: incidentSummary,
  }).strict(),
]);

export type AdminAlertEvent = z.infer<typeof adminAlertEventSchema>;
export type WeeklyAdminAlertAggregate = z.infer<typeof weeklyAggregateSchema>;

export function parseAdminAlertEvent(input: unknown): AdminAlertEvent {
  return adminAlertEventSchema.parse(input);
}

export function getAdminAlertDestinations(
  event: AdminAlertEvent,
): readonly AdminAlertDestination[] {
  switch (event.type) {
    case "teacher.signed_up":
    case "class.first_created":
    case "assignment.first_published":
    case "recording.first_received":
    case "teacher.activated":
    case "ai.first_review":
    case "trial.half_used":
      return ["traction"];
    case "trial.exhausted":
    case "subscription.started":
    case "subscription.renewed":
    case "subscription.cancelled":
    case "refund.issued":
    case "allowance.near_limit":
    case "allowance.exhausted":
    case "school.lead":
      return ["revenue"];
    case "payment.failed":
      return ["revenue", "incidents"];
    case "milestone.reached":
      return ["milestones"];
    case "pulse.daily":
    case "pulse.weekly":
      return ["pulse"];
    case "incident":
      return ["incidents"];
  }
}

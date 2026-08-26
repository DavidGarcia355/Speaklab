/**
 * Stripe accepts meter events from the past 35 calendar days. Automatic
 * recovery is limited to dimensions whose durable outbox claim has never been
 * attempted, so the identifier's shorter deduplication horizon is irrelevant
 * to these first deliveries. Keep a full-day safety margin for clock and cron
 * drift; attempted-but-unreported claims always require manual reconciliation.
 */
export const STRIPE_AUTOMATIC_USAGE_RECOVERY_WINDOW_MS =
  34 * 24 * 60 * 60 * 1000;

export function getStripeAutomaticUsageRecoverySupportedSince(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError("now must be a non-negative safe integer.");
  }
  return Math.max(0, now - STRIPE_AUTOMATIC_USAGE_RECOVERY_WINDOW_MS);
}

export function isStripeAutomaticUsageRecoverySupported(
  occurredAt: number,
  now: number,
) {
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    throw new RangeError("occurredAt must be a non-negative safe integer.");
  }
  return occurredAt >= getStripeAutomaticUsageRecoverySupportedSince(now);
}

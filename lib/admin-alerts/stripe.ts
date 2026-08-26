import "server-only";

import type Stripe from "stripe";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import {
  getConsumedFreeAiReviewCount,
  getStripeBillingAccountByCustomerId,
  getStripeBillingAccountByTeacherEmail,
  type StripeBillingAccountRow,
} from "@/lib/db";
import type { AdminAlertEvent } from "@/lib/admin-alerts/events";
import { deriveAdminAlertIdentity } from "@/lib/admin-alerts/identity";

export type StripeAdminAlertScope = {
  livemode: boolean;
  stripeAccountId: string;
  billingContractId: string;
};

const PAYMENT_FAILURE_STATUSES = new Set([
  "requires_payment_method",
  "past_due",
  "unpaid",
  "incomplete",
  "canceled",
]);

function metadataValue(metadata: Stripe.Metadata | null | undefined, key: string) {
  return metadata?.[key]?.trim() || "";
}

function isTryHablaMetadata(metadata: Stripe.Metadata | null | undefined) {
  return metadataValue(metadata, "habla_app") === "tryhabla";
}

function stripeId(value: unknown, prefix: string): string | null {
  if (typeof value === "string") return value.startsWith(prefix) ? value : null;
  if (!value || typeof value !== "object" || !("id" in value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.startsWith(prefix) ? id : null;
}

function fixedIncident(code: string, summary: string): AdminAlertEvent {
  return { type: "incident", code, summary };
}

function teacherRef(account: StripeBillingAccountRow) {
  return deriveAdminAlertIdentity("teacher", account.teacherEmail).ref;
}

function exactTryHablaAccount(account: StripeBillingAccountRow) {
  return (
    account.priceBookId === STRIPE_CATALOG_MANIFEST.priceBookId
    && account.catalogFingerprint === STRIPE_CATALOG_MANIFEST.fingerprint
  );
}

function accountMatchesScope(
  account: StripeBillingAccountRow,
  scope: StripeAdminAlertScope,
) {
  return (
    account.livemode === scope.livemode
    && account.stripeAccountId === scope.stripeAccountId
    && account.billingContractId === scope.billingContractId
  );
}

async function accountByCustomer(customer: unknown, scope: StripeAdminAlertScope) {
  const customerId = stripeId(customer, "cus_");
  if (!customerId) return null;
  return getStripeBillingAccountByCustomerId(
    customerId,
    scope.livemode,
    scope.stripeAccountId,
    scope.billingContractId,
  );
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  if (invoice.parent?.type !== "subscription_details") return null;
  return stripeId(invoice.parent.subscription_details?.subscription, "sub_");
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const seconds = subscription.items.data[0]?.current_period_end;
  return Number.isSafeInteger(seconds) && Number(seconds) > 0
    ? Number(seconds) * 1_000
    : 0;
}

function utcSubscriptionMonth(startedAt: number, periodStartSeconds: number) {
  const start = new Date(startedAt);
  const period = new Date(Math.max(0, periodStartSeconds) * 1_000);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(period.valueOf())) return 1;
  const elapsedMonths =
    (period.getUTCFullYear() - start.getUTCFullYear()) * 12
    + period.getUTCMonth()
    - start.getUTCMonth();
  return Math.max(1, Math.min(1_200, elapsedMonths + 1));
}

function cancellationCategory(
  feedback: Stripe.Subscription.CancellationDetails.Feedback | null | undefined,
): Extract<AdminAlertEvent, { type: "subscription.cancelled" }>["category"] {
  switch (feedback) {
    case "too_expensive":
      return "cost";
    case "unused":
    case "switched_service":
      return "no_longer_needed";
    case "missing_features":
      return "missing_feature";
    case "low_quality":
    case "too_complex":
      return "technical_issue";
    case "customer_service":
    case "other":
      return "other";
    default:
      return undefined;
  }
}

async function checkoutAlerts(
  session: Stripe.Checkout.Session,
  scope: StripeAdminAlertScope,
): Promise<AdminAlertEvent[]> {
  if (!isTryHablaMetadata(session.metadata)) return [];
  const teacherEmail = (
    metadataValue(session.metadata, "teacher_email")
    || session.client_reference_id?.trim()
    || ""
  ).toLowerCase();
  if (!teacherEmail) {
    return [fixedIncident(
      "stripe_checkout_identity_missing",
      "A verified TryHabla Checkout event has no usable teacher identity.",
    )];
  }
  const account = await getStripeBillingAccountByTeacherEmail(teacherEmail);
  const customerId = stripeId(session.customer, "cus_");
  const subscriptionId = stripeId(session.subscription, "sub_");
  if (
    !account
    || account.stripeCustomerId !== customerId
    || account.stripeSubscriptionId !== subscriptionId
  ) {
    return [fixedIncident(
      "stripe_checkout_mapping_missing",
      "A verified TryHabla Checkout event has no matching local billing account.",
    )];
  }
  if (account.subscriptionStatus !== "active" || !exactTryHablaAccount(account)) {
    return [fixedIncident(
      "stripe_checkout_entitlement_missing",
      "A completed TryHabla Checkout did not produce a verified local entitlement.",
    )];
  }
  if (!accountMatchesScope(account, scope)) {
    return [fixedIncident(
      "stripe_checkout_scope_mismatch",
      "A completed TryHabla Checkout does not match the active billing scope.",
    )];
  }
  return [{
    type: "subscription.started",
    teacherRef: teacherRef(account),
    amountCents: 2_000,
    freeReviewsUsed: Math.min(
      30,
      Math.max(0, await getConsumedFreeAiReviewCount(account.teacherEmail)),
    ),
  }];
}

async function subscriptionAlerts(
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  scope: StripeAdminAlertScope,
): Promise<AdminAlertEvent[]> {
  const account = await accountByCustomer(subscription.customer, scope);
  if (!account) {
    return isTryHablaMetadata(subscription.metadata)
      ? [fixedIncident(
          "stripe_subscription_mapping_missing",
          "A verified TryHabla subscription event has no matching local billing account.",
        )]
      : [];
  }
  if (account.stripeSubscriptionId !== subscription.id) return [];
  const previous = event.data.previous_attributes as Partial<Stripe.Subscription> | undefined;
  const scheduledNow = subscription.cancel_at_period_end === true
    && previous?.cancel_at_period_end === false;
  const deletedNow = event.type === "customer.subscription.deleted";
  if (!scheduledNow && !deletedNow) return [];
  const accessEndsAt = Math.max(
    subscriptionPeriodEnd(subscription),
    account.subscriptionPeriodEnd,
    event.created * 1_000,
  );
  const category = cancellationCategory(subscription.cancellation_details?.feedback);
  return [{
    type: "subscription.cancelled",
    teacherRef: teacherRef(account),
    accessEndsAt: new Date(accessEndsAt).toISOString(),
    ...(category ? { category } : {}),
  }];
}

async function invoiceAlerts(
  event: Stripe.Event,
  invoice: Stripe.Invoice,
  scope: StripeAdminAlertScope,
): Promise<AdminAlertEvent[]> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return [];
  const account = await accountByCustomer(invoice.customer, scope);
  if (!account) {
    const marked = isTryHablaMetadata(invoice.parent?.subscription_details?.metadata);
    return marked
      ? [fixedIncident(
          "stripe_invoice_mapping_missing",
          "A verified TryHabla invoice event has no matching local billing account.",
        )]
      : [];
  }
  if (account.stripeSubscriptionId !== subscriptionId) return [];

  if (event.type === "invoice.paid") {
    if (invoice.billing_reason !== "subscription_cycle") return [];
    if (
      invoice.currency !== "usd"
      || invoice.collection_method !== "charge_automatically"
      || invoice.status !== "paid"
      || invoice.amount_paid !== 2_000
    ) {
      return [fixedIncident(
        "stripe_renewal_contract_mismatch",
        "A TryHabla renewal invoice does not match the published Teacher plan.",
      )];
    }
    return [{
      type: "subscription.renewed",
      teacherRef: teacherRef(account),
      amountCents: 2_000,
      subscriptionMonth: utcSubscriptionMonth(account.createdAt, invoice.period_start),
    }];
  }

  if (event.type === "invoice.payment_failed") {
    const status = account.subscriptionStatus.trim().toLowerCase();
    const stripeStatus = PAYMENT_FAILURE_STATUSES.has(status)
      ? status as Extract<AdminAlertEvent, { type: "payment.failed" }>["stripeStatus"]
      : "unknown";
    const retryAt = invoice.next_payment_attempt && invoice.next_payment_attempt > 0
      ? new Date(invoice.next_payment_attempt * 1_000).toISOString()
      : undefined;
    return [{
      type: "payment.failed",
      teacherRef: teacherRef(account),
      stripeStatus,
      ...(retryAt ? { retryAt } : {}),
    }];
  }

  return [];
}

async function refundAlerts(
  refund: Stripe.Refund,
  scope: StripeAdminAlertScope,
): Promise<AdminAlertEvent[]> {
  const account = await accountByCustomer(refund.customer, scope);
  if (!account) return [];
  if (refund.currency !== "usd" || !Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
    return [fixedIncident(
      "stripe_refund_contract_mismatch",
      "A refund for a TryHabla billing account has an unexpected amount or currency.",
    )];
  }
  return [{
    type: "refund.issued",
    paymentRef: deriveAdminAlertIdentity("payment", refund.id).ref,
    amountCents: refund.amount,
  }];
}

/**
 * Builds safe, typed notification intents only after the verified Stripe event
 * has completed its ordinary local projection. No raw Stripe IDs or customer
 * identity leave this function.
 */
export async function buildProcessedStripeAdminAlerts(
  event: Stripe.Event,
  scope: StripeAdminAlertScope,
): Promise<AdminAlertEvent[]> {
  switch (event.type) {
    case "checkout.session.completed":
      return checkoutAlerts(
        event.data.object as Stripe.Checkout.Session,
        scope,
      );
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return subscriptionAlerts(
        event,
        event.data.object as Stripe.Subscription,
        scope,
      );
    case "invoice.paid":
    case "invoice.payment_failed":
      return invoiceAlerts(event, event.data.object as Stripe.Invoice, scope);
    case "refund.created":
      return refundAlerts(event.data.object as Stripe.Refund, scope);
    default:
      return [];
  }
}

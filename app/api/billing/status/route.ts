import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  STRIPE_CATALOG_MANIFEST,
  getStripeBillingContractId,
  getStripeCheckoutAvailability,
  getStripeClientAvailability,
  getStripePortalAvailability,
  getStripeSubscriptionBillingAvailability,
  isStripePortalRuntimeReady,
  isStripeSubscriptionRuntimeReady,
  requireStripePortalConfig,
  requireStripeSubscriptionBillingConfig,
} from "@/lib/billing";
import {
  getAiReviewAllowanceSummary,
  getStripeBillingAccountByTeacherEmail,
  type StripeBillingAccountRow,
} from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";
import { getAiCheckoutAvailability } from "@/app/api/billing/_shared";

export const runtime = "nodejs";

const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["active"]);
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

function accountIssue(
  account: StripeBillingAccountRow | null,
  runtimeAvailable: boolean,
  subscriptionKeyMode: "test" | "live" | null,
  subscriptionAccountId: string | null,
  billingContractId: string | null,
) {
  if (!account) return null;
  if (
    subscriptionKeyMode &&
    account.livemode !== (subscriptionKeyMode === "live")
  ) {
    return "mode_mismatch" as const;
  }
  if (subscriptionAccountId && account.stripeAccountId !== subscriptionAccountId) {
    return "account_mismatch" as const;
  }
  if (billingContractId && account.billingContractId !== billingContractId) {
    return "billing_contract_mismatch" as const;
  }
  const status = account.subscriptionStatus.trim().toLowerCase();
  if (status !== "invalid_catalog" && !ENTITLED_SUBSCRIPTION_STATUSES.has(status)) return null;
  if (account.priceBookId !== STRIPE_CATALOG_MANIFEST.priceBookId) {
    return "price_book_mismatch" as const;
  }
  if (status === "invalid_catalog") return "catalog_unverified" as const;
  if (account.catalogFingerprint !== STRIPE_CATALOG_MANIFEST.fingerprint) {
    return "catalog_unverified" as const;
  }
  if (!runtimeAvailable) return "billing_paused" as const;
  return null;
}

function canStartCheckout(account: StripeBillingAccountRow | null) {
  const status = account?.subscriptionStatus.trim().toLowerCase() ?? "";
  return !status || TERMINAL_SUBSCRIPTION_STATUSES.has(status);
}

function checkoutUnavailableReason(input: {
  account: StripeBillingAccountRow | null;
  accountIssue: ReturnType<typeof accountIssue>;
  checkoutConfigured: boolean;
  runtimeAvailable: boolean;
  portalRuntimeReady: boolean;
  aiCheckout: ReturnType<typeof getAiCheckoutAvailability>;
}) {
  if (input.accountIssue) {
    return "This account's Stripe billing state must be resolved before another Checkout can start.";
  }
  if (!canStartCheckout(input.account)) {
    return "This account already has a Stripe subscription. Open Manage billing instead.";
  }
  if (!input.checkoutConfigured) {
    return "Stripe self-service is not available for this deployment.";
  }
  if (!input.runtimeAvailable) {
    return "Stripe pricing is being verified before Checkout can open.";
  }
  if (!input.portalRuntimeReady) {
    return "Stripe self-service billing is being verified before Checkout can open.";
  }
  if (!input.aiCheckout.available) return input.aiCheckout.reason;
  return null;
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const clientAvailability = getStripeClientAvailability();
    const portalAvailability = getStripePortalAvailability();
    const subscriptionAvailability = getStripeSubscriptionBillingAvailability();
    const checkoutAvailability = getStripeCheckoutAvailability();
    const aiCheckout = getAiCheckoutAvailability(teacherEmail);
    const subscriptionConfig = subscriptionAvailability.available
      ? requireStripeSubscriptionBillingConfig()
      : null;
    const billingContractId = subscriptionConfig
      ? getStripeBillingContractId(subscriptionConfig)
      : null;
    const [account, allowance, runtimeAvailable] = await Promise.all([
      getStripeBillingAccountByTeacherEmail(teacherEmail),
      getAiReviewAllowanceSummary({ teacherEmail }),
      subscriptionAvailability.available
        ? isStripeSubscriptionRuntimeReady()
        : Promise.resolve(false),
    ]);

    const normalizedSubscriptionStatus = account?.subscriptionStatus.trim().toLowerCase() || null;
    const projectedAccountIssue = accountIssue(
      account,
      runtimeAvailable,
      subscriptionAvailability.available ? subscriptionAvailability.keyMode : null,
      subscriptionConfig?.accountId ?? null,
      billingContractId,
    );
    const issue =
      allowance.status === "subscription_unavailable"
        ? (projectedAccountIssue ?? "billing_paused")
        : projectedAccountIssue;
    const stripeAccess =
      normalizedSubscriptionStatus &&
      ENTITLED_SUBSCRIPTION_STATUSES.has(normalizedSubscriptionStatus) &&
      issue === null
        ? normalizedSubscriptionStatus
        : null;
    const access =
      stripeAccess ?? (allowance.status === "manual_lifetime" ? "pilot" : "inactive");
    const portalAccountModeMatches =
      portalAvailability.available &&
      (!account?.stripeCustomerId ||
        (account.livemode === (portalAvailability.keyMode === "live") &&
          account.stripeAccountId === requireStripePortalConfig().accountId));
    const portalRuntimeReady = portalAccountModeMatches
      ? await isStripePortalRuntimeReady()
      : false;
    const portalAvailable =
      portalRuntimeReady &&
      Boolean(account?.stripeCustomerId);
    const checkoutPortalReady =
      portalRuntimeReady &&
      portalAvailability.available &&
      checkoutAvailability.available &&
      portalAvailability.keyMode === checkoutAvailability.keyMode;
    const unavailableReason = checkoutUnavailableReason({
      account,
      accountIssue: issue,
      checkoutConfigured: checkoutAvailability.available,
      runtimeAvailable,
      portalRuntimeReady: checkoutPortalReady,
      aiCheckout,
    });
    const checkoutAvailable = unavailableReason === null;
    const periodEnd =
      account && account.subscriptionPeriodEnd > 0
        ? account.subscriptionPeriodEnd
        : null;

    return NextResponse.json({
      clientConfigured: clientAvailability.available,
      runtimeAvailable,
      portalAvailable,
      checkoutAvailable,
      checkoutUnavailableReason: unavailableReason,
      mode: clientAvailability.available ? clientAvailability.keyMode : null,
      accountIssue: issue,
      priceBook: {
        id: TEACHER_AI_PRICE_BOOK.id,
        effectiveAt: TEACHER_AI_PRICE_BOOK.effectiveAt,
      },
      access,
      subscriptionStatus: normalizedSubscriptionStatus,
      periodEnd,
      usage: {
        allowanceKind: allowance.status,
        limit: allowance.limit,
        reservedReviews: allowance.reserved,
        consumedReviews: allowance.consumed,
        usedReviews: allowance.used,
        remainingReviews: allowance.remaining,
        periodStart: allowance.periodStart,
        periodEnd: allowance.periodEnd,
      },
    });
  });
}

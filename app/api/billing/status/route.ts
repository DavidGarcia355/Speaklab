import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  STRIPE_CATALOG_MANIFEST,
  getStripeBillingContractId,
  getStripeCheckoutAvailability,
  getStripeClient,
  getStripeClientAvailability,
  getStripePortalAvailability,
  getStripeUsageBillingAvailability,
  isStripePortalRuntimeReady,
  isStripeUsageRuntimeReady,
  requireStripeClientConfig,
  requireStripePortalConfig,
  requireStripeUsageBillingConfig,
} from "@/lib/billing";
import {
  getAiBillingMonthlySummary,
  getAiBillingUtcMonth,
  getStripeBillingAccountByTeacherEmail,
  isStripeBillingStorageReady,
  getUserIsPaid,
  type StripeBillingAccountRow,
} from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";
import { getAiCheckoutAvailability, subscriptionPeriodEndMs } from "@/app/api/billing/_shared";

export const runtime = "nodejs";

const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["active"]);
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

function estimatedRetailChargeUsd(input: {
  baseUnits: number;
  durationSeconds: number;
}) {
  const baseMicros = Math.round(
    input.baseUnits * TEACHER_AI_PRICE_BOOK.baseSuccessfulGradeUsd * 1_000_000,
  );
  const audioMicros = Math.round(
    (input.durationSeconds / 60) * TEACHER_AI_PRICE_BOOK.audioMinuteUsd * 1_000_000,
  );
  return (baseMicros + audioMicros) / 1_000_000;
}

async function loadSubscriptionPeriodEnd(
  account: StripeBillingAccountRow | null,
  clientConfigured: boolean,
) {
  if (!clientConfigured || !account?.stripeSubscriptionId) return null;
  try {
    const config = requireStripeClientConfig();
    if (account.stripeAccountId !== config.accountId) return null;
    const subscription = await getStripeClient(config).subscriptions.retrieve(
      account.stripeSubscriptionId,
    );
    return subscriptionPeriodEndMs(subscription);
  } catch {
    // Status remains useful from the signed local webhook projection when Stripe is unavailable.
    return null;
  }
}

function accountIssue(
  account: StripeBillingAccountRow | null,
  runtimeAvailable: boolean,
  usageKeyMode: "test" | "live" | null,
  usageAccountId: string | null,
  billingContractId: string | null,
) {
  if (!account) return null;
  if (
    usageKeyMode &&
    account.livemode !== (usageKeyMode === "live")
  ) {
    return "mode_mismatch" as const;
  }
  if (usageAccountId && account.stripeAccountId !== usageAccountId) {
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
    const usageAvailability = getStripeUsageBillingAvailability();
    const checkoutAvailability = getStripeCheckoutAvailability();
    const aiCheckout = getAiCheckoutAvailability(teacherEmail);
    const usageConfig = usageAvailability.available
      ? requireStripeUsageBillingConfig()
      : null;
    const billingContractId = usageConfig
      ? getStripeBillingContractId(usageConfig)
      : null;
    const summaryScope = usageAvailability.available
      ? {
          priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
          catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
          billingContractId: billingContractId!,
          livemode: usageAvailability.keyMode === "live",
        }
      : null;
    const [account, manualAccess, summary, runtimeAvailable] = await Promise.all([
      getStripeBillingAccountByTeacherEmail(teacherEmail),
      getUserIsPaid(teacherEmail),
      summaryScope
        ? getAiBillingMonthlySummary(
            teacherEmail,
            getAiBillingUtcMonth(),
            summaryScope,
          )
        : Promise.resolve(null),
      usageAvailability.available
        ? Promise.all([
            isStripeUsageRuntimeReady(),
            isStripeBillingStorageReady(),
          ]).then((checks) => checks.every(Boolean))
        : Promise.resolve(false),
    ]);

    const normalizedSubscriptionStatus = account?.subscriptionStatus.trim().toLowerCase() || null;
    const issue = accountIssue(
      account,
      runtimeAvailable,
      usageAvailability.available ? usageAvailability.keyMode : null,
      usageConfig?.accountId ?? null,
      billingContractId,
    );
    const stripeAccess =
      normalizedSubscriptionStatus &&
      ENTITLED_SUBSCRIPTION_STATUSES.has(normalizedSubscriptionStatus) &&
      issue === null
        ? normalizedSubscriptionStatus
        : null;
    const access = stripeAccess ?? (manualAccess ? "pilot" : "inactive");
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
    const periodEnd = await loadSubscriptionPeriodEnd(account, clientAvailability.available);

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
        successfulGrades: summary?.successfulResults ?? 0,
        audioSeconds: summary?.billableDurationSeconds ?? 0,
        qualifyingClasses: summary?.qualifyingClassHighWater ?? 0,
        monthlyFreeCredits: summary?.earnedCredits ?? 0,
        freeCreditsUsed: summary?.usedCredits ?? 0,
        estimatedChargeUsd: estimatedRetailChargeUsd({
          baseUnits: summary?.billableBaseUnits ?? 0,
          durationSeconds: summary?.billableDurationSeconds ?? 0,
        }),
      },
    });
  });
}

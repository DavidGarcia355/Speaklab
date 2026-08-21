import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { getStripeBillingAvailability, getStripeClient, requireStripeBillingConfig } from "@/lib/billing";
import {
  getAiBillingMonthlySummary,
  getStripeBillingAccountByTeacherEmail,
  getUserIsPaid,
  type StripeBillingAccountRow,
} from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";
import { getAiCheckoutAvailability, subscriptionPeriodEndMs } from "@/app/api/billing/_shared";

export const runtime = "nodejs";

function estimatedRetailChargeUsd(input: {
  baseUnits: number;
  durationSeconds: number;
  outputTokens: number;
}) {
  const baseMicros = Math.round(
    input.baseUnits * TEACHER_AI_PRICE_BOOK.baseSuccessfulGradeUsd * 1_000_000,
  );
  const audioMicros = Math.round(
    (input.durationSeconds / 60) * TEACHER_AI_PRICE_BOOK.audioMinuteUsd * 1_000_000,
  );
  const outputMicros = Math.round(
    (input.outputTokens / 1_000) *
      TEACHER_AI_PRICE_BOOK.outputThousandTokensUsd *
      1_000_000,
  );
  return (baseMicros + audioMicros + outputMicros) / 1_000_000;
}

async function loadSubscriptionPeriodEnd(
  account: StripeBillingAccountRow | null,
  billingAvailable: boolean,
) {
  if (!billingAvailable || !account?.stripeSubscriptionId) return null;
  try {
    const config = requireStripeBillingConfig();
    const subscription = await getStripeClient(config).subscriptions.retrieve(
      account.stripeSubscriptionId,
    );
    return subscriptionPeriodEndMs(subscription);
  } catch {
    // Status remains useful from the local webhook projection if Stripe is unavailable.
    return null;
  }
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const availability = getStripeBillingAvailability();
    const aiCheckout = getAiCheckoutAvailability(teacherEmail);
    const [account, manualAccess, summary] = await Promise.all([
      getStripeBillingAccountByTeacherEmail(teacherEmail),
      getUserIsPaid(teacherEmail),
      getAiBillingMonthlySummary(teacherEmail),
    ]);
    const subscriptionStatus = account?.subscriptionStatus || null;
    const subscriptionAccess =
      subscriptionStatus === "active" || subscriptionStatus === "trialing"
        ? subscriptionStatus
        : null;
    const access = subscriptionAccess ?? (manualAccess ? "pilot" : "inactive");
    const periodEnd = await loadSubscriptionPeriodEnd(account, availability.available);

    return NextResponse.json({
      configured: availability.available,
      checkoutAvailable: availability.available && aiCheckout.available,
      checkoutUnavailableReason:
        availability.available && !aiCheckout.available ? aiCheckout.reason : null,
      mode: availability.available ? availability.keyMode : null,
      priceBook: {
        id: TEACHER_AI_PRICE_BOOK.id,
        effectiveAt: TEACHER_AI_PRICE_BOOK.effectiveAt,
      },
      access,
      subscriptionStatus,
      periodEnd,
      usage: {
        successfulGrades: summary.successfulResults,
        audioSeconds: summary.billableDurationSeconds,
        outputTokens: summary.billableOutputTokens,
        qualifyingClasses: summary.qualifyingClassHighWater,
        monthlyFreeCredits: summary.earnedCredits,
        freeCreditsUsed: summary.usedCredits,
        estimatedChargeUsd: estimatedRetailChargeUsd({
          baseUnits: summary.billableBaseUnits,
          durationSeconds: summary.billableDurationSeconds,
          outputTokens: summary.billableOutputTokens,
        }),
      },
    });
  });
}

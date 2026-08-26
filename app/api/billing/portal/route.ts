import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  assertConfiguredStripePortal,
  buildBillingPortalSessionParams,
  getStripeClient,
} from "@/lib/billing";
import { getStripeBillingAccountByTeacherEmail } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import {
  canonicalBillingUrl,
  requireStripePortalConfigForApi,
} from "@/app/api/billing/_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const config = requireStripePortalConfigForApi();
    const account = await getStripeBillingAccountByTeacherEmail(teacherEmail);
    if (!account?.stripeCustomerId) {
      throw new HttpError(404, "No Stripe billing account exists for this teacher.");
    }
    if (account.livemode !== (config.keyMode === "live")) {
      throw new HttpError(409, "Stripe billing account mode does not match this deployment.");
    }
    if (account.stripeAccountId !== config.accountId) {
      throw new HttpError(409, "Stripe billing account identity does not match this deployment.");
    }
    try {
      await assertConfiguredStripePortal(config);
    } catch {
      throw new HttpError(
        503,
        "Stripe billing controls are being verified. Try again shortly.",
      );
    }

    const session = await getStripeClient(config).billingPortal.sessions.create(
      buildBillingPortalSessionParams({
        config,
        customerId: account.stripeCustomerId,
        returnUrl: canonicalBillingUrl("/billing"),
      }),
    );
    if (!session.url) throw new HttpError(502, "Stripe did not return a billing portal URL.");
    return NextResponse.json({ url: session.url });
  });
}

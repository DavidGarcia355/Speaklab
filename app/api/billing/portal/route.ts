import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { buildBillingPortalSessionParams, getStripeClient } from "@/lib/billing";
import { getStripeBillingAccountByTeacherEmail } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import {
  canonicalBillingUrl,
  requireBillingConfigForApi,
} from "@/app/api/billing/_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const config = requireBillingConfigForApi();
    const account = await getStripeBillingAccountByTeacherEmail(teacherEmail);
    if (!account?.stripeCustomerId) {
      throw new HttpError(404, "No Stripe billing account exists for this teacher.");
    }

    const session = await getStripeClient(config).billingPortal.sessions.create(
      buildBillingPortalSessionParams({
        customerId: account.stripeCustomerId,
        returnUrl: canonicalBillingUrl("/billing"),
      }),
    );
    if (!session.url) throw new HttpError(502, "Stripe did not return a billing portal URL.");
    return NextResponse.json({ url: session.url });
  });
}

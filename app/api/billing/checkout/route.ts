import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { buildCheckoutSessionParams, getStripeClient } from "@/lib/billing";
import {
  getStripeBillingAccountByTeacherEmail,
  upsertStripeBillingCustomer,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";
import {
  billingIdempotencyKey,
  canonicalBillingUrl,
  requireAiCheckoutForApi,
  requireBillingConfigForApi,
} from "@/app/api/billing/_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const config = requireBillingConfigForApi();
    requireAiCheckoutForApi(teacherEmail);
    const stripe = getStripeClient(config);
    let account = await getStripeBillingAccountByTeacherEmail(teacherEmail);
    if (
      account?.subscriptionStatus &&
      !["canceled", "incomplete_expired"].includes(account.subscriptionStatus)
    ) {
      throw new HttpError(
        409,
        "This account already has a Stripe subscription. Open Manage billing instead.",
      );
    }

    let customerId = account?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: teacherEmail,
          metadata: {
            teacher_email: teacherEmail,
            price_book_id: TEACHER_AI_PRICE_BOOK.id,
          },
        },
        {
          idempotencyKey: billingIdempotencyKey("customer", teacherEmail, "v1"),
        },
      );
      customerId = customer.id;
      account = await upsertStripeBillingCustomer({
        teacherEmail,
        stripeCustomerId: customerId,
      });
      customerId = account.stripeCustomerId;
    }

    const checkoutParams = buildCheckoutSessionParams({
      config,
      teacherEmail,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      customerId,
      successUrl: canonicalBillingUrl("/billing?checkout=success"),
      cancelUrl: canonicalBillingUrl("/billing?checkout=cancelled"),
    });
    const session = await stripe.checkout.sessions.create(
      {
        ...checkoutParams,
        client_reference_id: teacherEmail,
      },
      {
        idempotencyKey: billingIdempotencyKey(
          "checkout",
          teacherEmail,
          `${TEACHER_AI_PRICE_BOOK.id}:${account?.stripeEventCreated ?? 0}`,
        ),
      },
    );
    if (!session.url) throw new HttpError(502, "Stripe Checkout did not return a redirect URL.");
    return NextResponse.json({ url: session.url });
  });
}

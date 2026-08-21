import type Stripe from "stripe";
import { NextResponse } from "next/server";
import {
  constructWebhookEvent,
  getStripeClient,
  type StripeBillingConfig,
} from "@/lib/billing";
import {
  getStripeBillingAccountByCustomerId,
  hasProcessedStripeWebhookEvent,
  recordProcessedStripeWebhookEvent,
  upsertStripeBillingCustomer,
  upsertStripeBillingSubscription,
} from "@/lib/db";
import {
  requireBillingConfigForApi,
  stripeObjectId,
} from "@/app/api/billing/_shared";

export const runtime = "nodejs";

function checkoutTeacherEmail(session: Stripe.Checkout.Session) {
  const metadataEmail = session.metadata?.teacher_email?.trim().toLowerCase() || null;
  const referenceEmail = session.client_reference_id?.trim().toLowerCase() || null;
  if (metadataEmail && referenceEmail && metadataEmail !== referenceEmail) {
    throw new Error("Stripe Checkout teacher identity metadata does not match.");
  }
  const teacherEmail = metadataEmail ?? referenceEmail;
  if (!teacherEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teacherEmail)) {
    throw new Error("Stripe Checkout is missing a valid teacher identity.");
  }
  return teacherEmail;
}

function assertConfiguredMeteredPrices(
  subscription: Stripe.Subscription,
  config: StripeBillingConfig,
) {
  const actualPriceIds = new Set(subscription.items.data.map((item) => item.price.id));
  const expectedPriceIds = Object.values(config.priceIds);
  if (
    subscription.items.data.length !== expectedPriceIds.length ||
    actualPriceIds.size !== expectedPriceIds.length ||
    !expectedPriceIds.every((priceId) => actualPriceIds.has(priceId))
  ) {
    throw new Error("Stripe subscription does not match the configured AI meter catalog.");
  }
}

async function projectSubscription(input: {
  subscription: Stripe.Subscription;
  eventCreated: number;
  config: StripeBillingConfig;
  fallbackPriceBookId?: string | null;
}) {
  const customerId = stripeObjectId(input.subscription.customer, "cus_");
  if (!customerId) throw new Error("Stripe subscription is missing a Customer ID.");
  const account = await getStripeBillingAccountByCustomerId(customerId);
  if (!account) {
    // Failing keeps the event unrecorded so Stripe retries after customer mapping is restored.
    throw new Error("Stripe subscription Customer is not mapped to a Habla teacher.");
  }
  assertConfiguredMeteredPrices(input.subscription, input.config);
  const priceBookId =
    input.subscription.metadata.price_book_id?.trim() ||
    input.fallbackPriceBookId?.trim() ||
    account.priceBookId;
  if (!priceBookId) throw new Error("Stripe subscription is missing its price-book version.");
  const projected = await upsertStripeBillingSubscription({
    stripeCustomerId: customerId,
    stripeSubscriptionId: input.subscription.id,
    subscriptionStatus: input.subscription.status,
    priceBookId,
    stripeEventCreated: input.eventCreated,
  });
  if (!projected) throw new Error("Stripe subscription Customer mapping disappeared.");
}

async function processCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventCreated: number,
  config: StripeBillingConfig,
) {
  const teacherEmail = checkoutTeacherEmail(session);
  const customerId = stripeObjectId(session.customer, "cus_");
  const subscriptionId = stripeObjectId(session.subscription, "sub_");
  if (!customerId || !subscriptionId) {
    throw new Error("Completed Stripe Checkout is missing billing resource IDs.");
  }
  await upsertStripeBillingCustomer({ teacherEmail, stripeCustomerId: customerId });
  // Checkout event expansions are snapshots too. Always retrieve the current
  // subscription so a delayed Checkout event cannot restore stale access.
  const subscription = await getStripeClient(config).subscriptions.retrieve(subscriptionId);
  await projectSubscription({
    subscription,
    eventCreated,
    config,
    fallbackPriceBookId: session.metadata?.price_book_id,
  });
}

async function processBillingEvent(event: Stripe.Event, config: StripeBillingConfig) {
  switch (event.type) {
    case "checkout.session.completed":
      await processCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
        event.created,
        config,
      );
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const eventSubscription = event.data.object as Stripe.Subscription;
      const subscriptionId = stripeObjectId(eventSubscription.id, "sub_");
      if (!subscriptionId) throw new Error("Stripe subscription event is missing a Subscription ID.");
      // Event payloads are immutable snapshots and Stripe does not guarantee
      // delivery order. Project the resource's current state instead.
      const subscription = await getStripeClient(config).subscriptions.retrieve(subscriptionId);
      await projectSubscription({
        subscription,
        eventCreated: event.created,
        config,
      });
      return;
    }
    default:
      return;
  }
}

export async function POST(request: Request) {
  let config: StripeBillingConfig;
  try {
    config = requireBillingConfigForApi();
  } catch {
    return NextResponse.json({ error: "Stripe billing is unavailable." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Stripe-Signature header is required." }, { status: 400 });
  }
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature, config);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
  }

  try {
    if (await hasProcessedStripeWebhookEvent(event.id)) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    await processBillingEvent(event, config);
    await recordProcessedStripeWebhookEvent({
      eventId: event.id,
      eventType: event.type,
      stripeEventCreated: event.created,
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ error: "Stripe webhook processing failed." }, { status: 500 });
  }
}

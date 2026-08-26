import type Stripe from "stripe";
import { NextResponse } from "next/server";
import {
  STRIPE_CATALOG_MANIFEST,
  STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY,
  assertConfiguredStripeAccount,
  assertConfiguredStripeCatalog,
  constructWebhookEvent,
  getStripeClient,
  getStripeBillingContractId,
  requireStripeCatalogConfig,
  type StripeCatalogConfig,
  type StripeWebhookConfig,
} from "@/lib/billing";
import {
  getStripeBillingAccountByTeacherEmail,
  getStripeBillingAccountByCustomerId,
  hasProcessedStripeWebhookEvent,
  isStripeBillingStorageReady,
  projectCurrentStripeEntitledSubscription,
  projectCurrentStripeNonEntitledSubscription,
  recordProcessedStripeWebhookEvent,
  replaceTerminalStripeSubscriptionFromCheckout,
  upsertStripeBillingCustomer,
  upsertStripeBillingSubscription,
  type StripeBillingAccountRow,
} from "@/lib/db";
import {
  requireSubscriptionPeriodBoundsMs,
  requireStripeWebhookConfigForApi,
  stripeObjectId,
} from "@/app/api/billing/_shared";

export const runtime = "nodejs";

const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["active"]);
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

function metadataValue(metadata: Stripe.Metadata | null | undefined, key: string) {
  return metadata?.[key]?.trim() || null;
}

function isHablaMetadata(metadata: Stripe.Metadata | null | undefined) {
  return metadataValue(metadata, "habla_app") === "tryhabla";
}

function assertHablaCatalogMetadata(metadata: Stripe.Metadata | null | undefined) {
  if (!isHablaMetadata(metadata)) {
    throw new Error("Stripe resource is missing the TryHabla application marker.");
  }
  if (metadataValue(metadata, "price_book_id") !== STRIPE_CATALOG_MANIFEST.priceBookId) {
    throw new Error("Stripe resource does not match TryHabla's active price book.");
  }
  if (
    metadataValue(metadata, "catalog_fingerprint") !==
    STRIPE_CATALOG_MANIFEST.fingerprint
  ) {
    throw new Error("Stripe resource catalog fingerprint is not verified.");
  }
  if (
    metadataValue(metadata, "payment_method_policy") !==
    STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY
  ) {
    throw new Error("Stripe resource does not match TryHabla's card-only payment policy.");
  }
}

function checkoutTeacherEmail(session: Stripe.Checkout.Session) {
  const metadataEmail = metadataValue(session.metadata, "teacher_email")?.toLowerCase() || null;
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

function assertConfiguredTeacherSubscription(
  subscription: Stripe.Subscription,
  config: StripeCatalogConfig,
) {
  if (subscription.automatic_tax.enabled !== config.automaticTaxEnabled) {
    throw new Error("Stripe subscription automatic-tax mode does not match this deployment.");
  }
  if (
    (subscription.default_tax_rates?.length ?? 0) > 0 ||
    subscription.items.data.some((item) => (item.tax_rates?.length ?? 0) > 0)
  ) {
    throw new Error("Stripe subscription has unapproved manual tax rates.");
  }
  const item = subscription.items.data[0];
  if (
    subscription.items.has_more === true ||
    subscription.items.data.length !== 1 ||
    item?.price.id !== config.priceIds.teacher ||
    item.quantity !== 1
  ) {
    throw new Error("Stripe subscription does not match the configured Teacher plan.");
  }
}

function assertCollectibleSubscription(
  subscription: Stripe.Subscription,
  config: StripeWebhookConfig,
) {
  if (subscription.livemode !== (config.keyMode === "live")) {
    throw new Error("Stripe subscription mode does not match this deployment.");
  }
  if (subscription.currency !== STRIPE_CATALOG_MANIFEST.currency) {
    throw new Error("Stripe subscription currency does not match TryHabla's USD catalog.");
  }
  if (subscription.collection_method !== "charge_automatically") {
    throw new Error("Stripe subscription is not configured for automatic collection.");
  }
  if (subscription.pause_collection !== null) {
    throw new Error("Stripe subscription payment collection is paused.");
  }
}

async function assertSingleNonterminalHablaSubscription(input: {
  subscription: Stripe.Subscription;
  account: StripeBillingAccountRow;
  config: StripeWebhookConfig;
}): Promise<Stripe.Subscription> {
  const subscriptions = await getStripeClient(input.config).subscriptions.list({
    customer: input.account.stripeCustomerId,
    status: "all",
    limit: 100,
  });
  if (subscriptions.has_more) {
    throw new Error("Stripe subscription history could not be verified completely.");
  }
  const listedRetrievedSubscription = subscriptions.data.find(
    (subscription) => subscription.id === input.subscription.id,
  );
  if (
    !listedRetrievedSubscription ||
    listedRetrievedSubscription.status.trim().toLowerCase() !== "active"
  ) {
    throw new Error("Stripe subscription list is inconsistent with the retrieved subscription.");
  }

  const nonterminalHablaIds = new Set<string>([input.subscription.id]);
  for (const subscription of subscriptions.data) {
    if (
      !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status.trim().toLowerCase())
    ) {
      nonterminalHablaIds.add(subscription.id);
    }
  }
  if (nonterminalHablaIds.size !== 1) {
    throw new Error("Multiple nonterminal TryHabla subscriptions require reconciliation.");
  }
  assertCollectibleSubscription(listedRetrievedSubscription, input.config);
  assertHablaEntitlementMetadata(listedRetrievedSubscription, input.account);
  assertConfiguredTeacherSubscription(
    listedRetrievedSubscription,
    requireStripeCatalogConfig(),
  );
  return listedRetrievedSubscription;
}

async function writeCurrentSubscriptionAmbiguityRevocation(input: {
  account: StripeBillingAccountRow;
  eventCreated: number;
}) {
  const stripeSubscriptionId = input.account.stripeSubscriptionId;
  if (!stripeSubscriptionId) return input.account;
  const projected = await upsertStripeBillingSubscription({
    stripeCustomerId: input.account.stripeCustomerId,
    stripeSubscriptionId,
    subscriptionStatus: "invalid_catalog",
    priceBookId: input.account.priceBookId.trim() || "unverified",
    catalogFingerprint: "",
    stripeAccountId: input.account.stripeAccountId,
    billingContractId: input.account.billingContractId,
    livemode: input.account.livemode,
    stripeEventCreated: Math.max(input.eventCreated, input.account.stripeEventCreated),
    expectedAccount: {
      stripeSubscriptionId: input.account.stripeSubscriptionId,
      subscriptionStatus: input.account.subscriptionStatus,
      stripeEventCreated: input.account.stripeEventCreated,
      projectionRevision: input.account.projectionRevision,
    },
  });
  if (!projected) {
    throw new Error("Stripe subscription mapping changed during ambiguity revocation.");
  }
  return projected;
}

async function reconcileMismatchedNonterminalSubscription(input: {
  subscription: Stripe.Subscription;
  account: StripeBillingAccountRow;
  eventCreated: number;
  config: StripeWebhookConfig;
}) {
  const stripe = getStripeClient(input.config);
  let currentMismatched: Stripe.Subscription;
  let subscriptions: Stripe.ApiList<Stripe.Subscription>;
  try {
    [currentMismatched, subscriptions] = await Promise.all([
      stripe.subscriptions.retrieve(input.subscription.id),
      stripe.subscriptions.list({
        customer: input.account.stripeCustomerId,
        status: "all",
        limit: 100,
      }),
    ]);
  } catch {
    await writeCurrentSubscriptionAmbiguityRevocation(input);
    throw new Error("Stripe subscription ambiguity could not be reconciled.");
  }

  const currentMismatchedCustomerId = stripeObjectId(
    currentMismatched.customer,
    "cus_",
  );
  const mappedSubscription = subscriptions.data.find(
    (subscription) => subscription.id === input.account.stripeSubscriptionId,
  );
  const otherNonterminalSubscriptions = subscriptions.data.filter(
    (subscription) =>
      subscription.id !== input.account.stripeSubscriptionId &&
      !TERMINAL_SUBSCRIPTION_STATUSES.has(
        subscription.status.trim().toLowerCase(),
      ),
  );
  const remainsAmbiguous =
    subscriptions.has_more ||
    currentMismatchedCustomerId !== input.account.stripeCustomerId ||
    !TERMINAL_SUBSCRIPTION_STATUSES.has(
      currentMismatched.status.trim().toLowerCase(),
    ) ||
    otherNonterminalSubscriptions.length > 0 ||
    !mappedSubscription;
  if (remainsAmbiguous) {
    await writeCurrentSubscriptionAmbiguityRevocation(input);
    throw new Error("Multiple nonterminal Stripe subscriptions require reconciliation.");
  }

  await projectSubscription({
    subscription: mappedSubscription,
    account: input.account,
    eventCreated: Math.max(input.eventCreated, input.account.stripeEventCreated),
    config: input.config,
  });
}

function assertHablaEntitlementMetadata(
  subscription: Stripe.Subscription,
  account: StripeBillingAccountRow,
) {
  assertHablaCatalogMetadata(subscription.metadata);
  if (
    metadataValue(subscription.metadata, "teacher_email")?.toLowerCase() !==
    account.teacherEmail.trim().toLowerCase()
  ) {
    throw new Error("Stripe subscription teacher identity does not match its TryHabla account.");
  }
  if (
    metadataValue(subscription.metadata, "stripe_account_id") !==
      account.stripeAccountId ||
    metadataValue(subscription.metadata, "billing_contract_id") !==
      account.billingContractId
  ) {
    throw new Error("Stripe subscription billing scope does not match its TryHabla account.");
  }
}

function unverifiedPriceBookId(input: {
  subscription: Stripe.Subscription;
  account: StripeBillingAccountRow;
  fallbackPriceBookId?: string | null;
}) {
  return (
    metadataValue(input.subscription.metadata, "price_book_id") ||
    input.fallbackPriceBookId?.trim() ||
    input.account.priceBookId.trim() ||
    "unverified"
  );
}

async function writeCurrentEntitledProjection(input: {
  account: StripeBillingAccountRow;
  subscription: Stripe.Subscription;
  eventCreated: number;
  subscriptionStatus: string;
  priceBookId: string;
  catalogFingerprint: string;
}) {
  const period = requireSubscriptionPeriodBoundsMs(input.subscription);
  const projected = await projectCurrentStripeEntitledSubscription({
    stripeCustomerId: input.account.stripeCustomerId,
    stripeSubscriptionId: input.subscription.id,
    subscriptionStatus: input.subscriptionStatus,
    priceBookId: input.priceBookId,
    catalogFingerprint: input.catalogFingerprint,
    stripeAccountId: input.account.stripeAccountId,
    billingContractId: input.account.billingContractId,
    livemode: input.account.livemode,
    subscriptionPeriodStart: period.periodStart,
    subscriptionPeriodEnd: period.periodEnd,
    observedEventCreated: input.eventCreated,
    expectedAccount: {
      stripeSubscriptionId: input.account.stripeSubscriptionId,
      subscriptionStatus: input.account.subscriptionStatus,
      stripeEventCreated: input.account.stripeEventCreated,
      projectionRevision: input.account.projectionRevision,
    },
  });
  if (!projected) {
    throw new Error("Stripe subscription mapping changed during current-state projection.");
  }
}

async function writeSignedNonEntitledProjection(input: {
  account: StripeBillingAccountRow;
  subscription: Stripe.Subscription;
  eventCreated: number;
  subscriptionStatus: string;
}): Promise<StripeBillingAccountRow> {
  if (input.eventCreated < input.account.stripeEventCreated) return input.account;
  const projected = await upsertStripeBillingSubscription({
    stripeCustomerId: input.account.stripeCustomerId,
    stripeSubscriptionId: input.subscription.id,
    subscriptionStatus: input.subscriptionStatus,
    priceBookId: unverifiedPriceBookId(input),
    catalogFingerprint: "",
    stripeAccountId: input.account.stripeAccountId,
    billingContractId: input.account.billingContractId,
    livemode: input.account.livemode,
    stripeEventCreated: input.eventCreated,
    expectedAccount: {
      stripeSubscriptionId: input.account.stripeSubscriptionId,
      subscriptionStatus: input.account.subscriptionStatus,
      stripeEventCreated: input.account.stripeEventCreated,
      projectionRevision: input.account.projectionRevision,
    },
  });
  if (!projected) {
    throw new Error("Stripe subscription mapping changed during signed revocation.");
  }
  return projected;
}

function signedSubscriptionViolatesLocalContract(input: {
  subscription: Stripe.Subscription;
  account: StripeBillingAccountRow;
  config: StripeWebhookConfig;
}) {
  try {
    assertCollectibleSubscription(input.subscription, input.config);
    assertHablaEntitlementMetadata(input.subscription, input.account);
    assertConfiguredTeacherSubscription(input.subscription, requireStripeCatalogConfig());
    return false;
  } catch {
    return true;
  }
}

async function writeCurrentNonEntitledProjection(input: {
  account: StripeBillingAccountRow;
  subscription: Stripe.Subscription;
  eventCreated: number;
  subscriptionStatus: string;
  priceBookId: string;
}) {
  const projected = await projectCurrentStripeNonEntitledSubscription({
    stripeCustomerId: input.account.stripeCustomerId,
    stripeSubscriptionId: input.subscription.id,
    subscriptionStatus: input.subscriptionStatus,
    priceBookId: input.priceBookId,
    stripeAccountId: input.account.stripeAccountId,
    billingContractId: input.account.billingContractId,
    livemode: input.account.livemode,
    observedEventCreated: input.eventCreated,
    expectedAccount: {
      stripeSubscriptionId: input.account.stripeSubscriptionId,
      subscriptionStatus: input.account.subscriptionStatus,
      stripeEventCreated: input.account.stripeEventCreated,
      projectionRevision: input.account.projectionRevision,
    },
  });
  if (!projected) {
    throw new Error("Stripe subscription mapping changed during current-state projection.");
  }
}

async function writeTerminalCheckoutReplacement(input: {
  account: StripeBillingAccountRow;
  subscription: Stripe.Subscription;
  eventCreated: number;
  subscriptionStatus: string;
}) {
  const period = requireSubscriptionPeriodBoundsMs(input.subscription);
  const projected = await replaceTerminalStripeSubscriptionFromCheckout({
    stripeCustomerId: input.account.stripeCustomerId,
    stripeSubscriptionId: input.subscription.id,
    subscriptionStatus: input.subscriptionStatus,
    priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
    catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    stripeAccountId: input.account.stripeAccountId,
    billingContractId: input.account.billingContractId,
    livemode: input.account.livemode,
    subscriptionPeriodStart: period.periodStart,
    subscriptionPeriodEnd: period.periodEnd,
    observedEventCreated: input.eventCreated,
    expectedAccount: {
      stripeSubscriptionId: input.account.stripeSubscriptionId,
      subscriptionStatus: input.account.subscriptionStatus,
      stripeEventCreated: input.account.stripeEventCreated,
      projectionRevision: input.account.projectionRevision,
    },
  });
  if (!projected) {
    throw new Error("Stripe subscription mapping changed during Checkout replacement.");
  }
}

async function projectSubscription(input: {
  subscription: Stripe.Subscription;
  account: StripeBillingAccountRow;
  eventCreated: number;
  config: StripeWebhookConfig;
  fallbackPriceBookId?: string | null;
  allowTerminalCheckoutReplacement?: boolean;
}) {
  const customerId = stripeObjectId(input.subscription.customer, "cus_");
  if (!customerId || customerId !== input.account.stripeCustomerId) {
    throw new Error("Stripe subscription Customer does not match the TryHabla account mapping.");
  }
  const status = input.subscription.status.trim().toLowerCase();
  const mappedSubscriptionDiffers = Boolean(
    input.account.stripeSubscriptionId &&
      input.account.stripeSubscriptionId !== input.subscription.id,
  );
  const replacesTerminalSubscription = Boolean(
    mappedSubscriptionDiffers &&
      input.allowTerminalCheckoutReplacement &&
      TERMINAL_SUBSCRIPTION_STATUSES.has(
        input.account.subscriptionStatus.trim().toLowerCase(),
      ) &&
      ENTITLED_SUBSCRIPTION_STATUSES.has(status),
  );
  if (mappedSubscriptionDiffers && !replacesTerminalSubscription) {
    if (TERMINAL_SUBSCRIPTION_STATUSES.has(status)) return;
    throw new Error("Stripe subscription does not match the currently mapped Subscription.");
  }

  if (!ENTITLED_SUBSCRIPTION_STATUSES.has(status)) {
    await writeCurrentNonEntitledProjection({
      account: input.account,
      subscription: input.subscription,
      eventCreated: input.eventCreated,
      subscriptionStatus: status,
      priceBookId: unverifiedPriceBookId(input),
    });
    return;
  }

  let verifiedSubscription = input.subscription;
  try {
    assertCollectibleSubscription(input.subscription, input.config);
    assertHablaEntitlementMetadata(input.subscription, input.account);
    const catalogConfig = requireStripeCatalogConfig();
    assertConfiguredTeacherSubscription(input.subscription, catalogConfig);
    await assertConfiguredStripeCatalog(catalogConfig);
    if (!(await isStripeBillingStorageReady())) {
      throw new Error("Legacy billing rows require reconciliation.");
    }
    verifiedSubscription = await assertSingleNonterminalHablaSubscription({
      subscription: input.subscription,
      account: input.account,
      config: input.config,
    });
  } catch {
    if (replacesTerminalSubscription) {
      throw new Error("Replacement Stripe subscription catalog verification failed.");
    }
    await writeCurrentNonEntitledProjection({
      account: input.account,
      subscription: input.subscription,
      eventCreated: input.eventCreated,
      subscriptionStatus: "invalid_catalog",
      priceBookId: unverifiedPriceBookId(input),
    });
    throw new Error("Stripe subscription catalog verification failed.");
  }

  if (replacesTerminalSubscription) {
    await writeTerminalCheckoutReplacement({
      account: input.account,
      subscription: verifiedSubscription,
      eventCreated: input.eventCreated,
      subscriptionStatus: verifiedSubscription.status.trim().toLowerCase(),
    });
  } else {
    await writeCurrentEntitledProjection({
      account: input.account,
      subscription: verifiedSubscription,
      eventCreated: input.eventCreated,
      subscriptionStatus: verifiedSubscription.status.trim().toLowerCase(),
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    });
  }
}

async function processCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventCreated: number,
  config: StripeWebhookConfig,
) {
  if (!isHablaMetadata(session.metadata)) return;
  await assertConfiguredStripeAccount(config);
  const catalogConfig = requireStripeCatalogConfig();
  const billingContractId = getStripeBillingContractId(catalogConfig);
  // A session with only the app marker is not enough evidence to mutate teacher mapping.
  assertHablaCatalogMetadata(session.metadata);
  if (
    metadataValue(session.metadata, "stripe_account_id") !== config.accountId ||
    metadataValue(session.metadata, "billing_contract_id") !== billingContractId
  ) {
    throw new Error("Completed TryHabla Checkout does not match this billing scope.");
  }
  if (
    session.payment_method_types.length !== 1 ||
    session.payment_method_types[0] !== "card"
  ) {
    throw new Error("Completed TryHabla Checkout did not use the card-only payment policy.");
  }
  const teacherEmail = checkoutTeacherEmail(session);
  const customerId = stripeObjectId(session.customer, "cus_");
  const subscriptionId = stripeObjectId(session.subscription, "sub_");
  if (!customerId || !subscriptionId) {
    throw new Error("Completed TryHabla Checkout is missing billing resource IDs.");
  }
  const expectedLivemode = config.keyMode === "live";
  // Checkout payload expansions are immutable snapshots. Retrieve and bind the
  // current Subscription before any local Customer mapping can be created.
  const subscription = await getStripeClient(config).subscriptions.retrieve(subscriptionId);
  const subscriptionCustomerId = stripeObjectId(subscription.customer, "cus_");
  if (subscriptionCustomerId !== customerId) {
    throw new Error("Completed TryHabla Checkout Subscription has a different Customer.");
  }
  assertHablaCatalogMetadata(subscription.metadata);
  if (
    metadataValue(subscription.metadata, "teacher_email")?.toLowerCase() !==
    teacherEmail
  ) {
    throw new Error("Completed TryHabla Checkout Subscription has a different teacher.");
  }
  if (
    metadataValue(subscription.metadata, "stripe_account_id") !== config.accountId ||
    metadataValue(subscription.metadata, "billing_contract_id") !== billingContractId
  ) {
    throw new Error("Completed TryHabla Checkout Subscription has a different billing scope.");
  }
  assertCollectibleSubscription(subscription, config);
  const existingAccount = await getStripeBillingAccountByTeacherEmail(teacherEmail);
  if (
    existingAccount &&
    (existingAccount.stripeCustomerId !== customerId ||
      existingAccount.stripeAccountId !== config.accountId ||
      existingAccount.billingContractId !== billingContractId ||
      existingAccount.livemode !== expectedLivemode)
  ) {
    throw new Error(
      "Completed TryHabla Checkout conflicts with the teacher's existing Stripe Customer mapping.",
    );
  }
  const account =
    existingAccount ??
    (await upsertStripeBillingCustomer({
      teacherEmail,
      stripeCustomerId: customerId,
      stripeAccountId: config.accountId,
      billingContractId,
      livemode: expectedLivemode,
    }));
  await projectSubscription({
    subscription,
    account,
    eventCreated,
    config,
    fallbackPriceBookId: metadataValue(session.metadata, "price_book_id"),
    allowTerminalCheckoutReplacement: true,
  });
}

async function processSubscriptionEvent(
  eventSubscription: Stripe.Subscription,
  eventCreated: number,
  config: StripeWebhookConfig,
) {
  const subscriptionId = stripeObjectId(eventSubscription.id, "sub_");
  if (!subscriptionId) {
    if (isHablaMetadata(eventSubscription.metadata)) {
      throw new Error("TryHabla subscription event is missing a Subscription ID.");
    }
    return;
  }

  const customerId = stripeObjectId(eventSubscription.customer, "cus_");
  if (!customerId) {
    if (isHablaMetadata(eventSubscription.metadata)) {
      throw new Error("TryHabla subscription event is missing a Customer ID.");
    }
    return;
  }
  const catalogConfig = requireStripeCatalogConfig();
  const billingContractId = getStripeBillingContractId(catalogConfig);
  const account = await getStripeBillingAccountByCustomerId(
    customerId,
    config.keyMode === "live",
    config.accountId,
    billingContractId,
  );
  if (!account) {
    if (isHablaMetadata(eventSubscription.metadata)) {
      // Leave the event unrecorded so Stripe retries after mapping is restored.
      throw new Error("TryHabla subscription Customer is not mapped to a teacher.");
    }
    return;
  }
  const eventStatus = eventSubscription.status.trim().toLowerCase();
  if (
    account.stripeSubscriptionId &&
    account.stripeSubscriptionId !== subscriptionId
  ) {
    // Once Checkout has replaced a terminal Subscription, delayed terminal
    // events for the old resource must not touch the new mapping.
    if (TERMINAL_SUBSCRIPTION_STATUSES.has(eventStatus)) return;
    // Stripe does not guarantee that Checkout completion is delivered before
    // the new Subscription event. If the mapped Subscription is already
    // terminal, verify current Stripe state and perform the same guarded CAS
    // replacement used by Checkout instead of corrupting the old row into an
    // ambiguity placeholder.
    if (
      TERMINAL_SUBSCRIPTION_STATUSES.has(
        account.subscriptionStatus.trim().toLowerCase(),
      )
    ) {
      const subscription = await getStripeClient(config).subscriptions.retrieve(
        subscriptionId,
      );
      await projectSubscription({
        subscription,
        account,
        eventCreated,
        config,
        allowTerminalCheckoutReplacement: true,
      });
      return;
    }
    await reconcileMismatchedNonterminalSubscription({
      subscription: eventSubscription,
      account,
      eventCreated,
      config,
    });
    return;
  }

  if (
    !account.stripeSubscriptionId &&
    !isHablaMetadata(eventSubscription.metadata) &&
    TERMINAL_SUBSCRIPTION_STATUSES.has(eventStatus)
  ) {
    return;
  }

  // The signed event is sufficient to revoke access. Do this before any Stripe
  // API read so a transient remote outage cannot leave a canceled or delinquent
  // account entitled. Monotonic ordering ignores an older revocation after a
  // newer local state, and the exact snapshot makes concurrent writes retry.
  if (!ENTITLED_SUBSCRIPTION_STATUSES.has(eventStatus)) {
    const revokedAccount =
      eventCreated < account.stripeEventCreated
        ? account
        : await writeSignedNonEntitledProjection({
            account,
            subscription: eventSubscription,
            eventCreated,
            subscriptionStatus: eventStatus,
          });
    // Stripe event timestamps have whole-second precision. Reconcile the
    // current Subscription after revoking so a delayed past_due event cannot
    // permanently beat an active event from the same second. If this read is
    // unavailable, the revocation remains in place and Stripe retries.
    const subscription = await getStripeClient(config).subscriptions.retrieve(subscriptionId);
    await projectSubscription({ subscription, account: revokedAccount, eventCreated, config });
    return;
  }

  // Event payloads are immutable and delivery can be out of order. Project current state.
  let projectionAccount = account;
  if (
    signedSubscriptionViolatesLocalContract({
      subscription: eventSubscription,
      account,
      config,
    })
  ) {
    projectionAccount = await writeSignedNonEntitledProjection({
      account,
      subscription: eventSubscription,
      eventCreated,
      subscriptionStatus: "invalid_catalog",
    });
  }

  const subscription = await getStripeClient(config).subscriptions.retrieve(subscriptionId);
  await projectSubscription({ subscription, account: projectionAccount, eventCreated, config });
}

async function processBillingEvent(event: Stripe.Event, config: StripeWebhookConfig) {
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
    case "customer.subscription.deleted":
      await processSubscriptionEvent(
        event.data.object as Stripe.Subscription,
        event.created,
        config,
      );
      return;
    default:
      return;
  }
}

export async function POST(request: Request) {
  let config: StripeWebhookConfig;
  try {
    config = requireStripeWebhookConfigForApi();
  } catch {
    return NextResponse.json({ error: "Stripe webhook processing is unavailable." }, { status: 503 });
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
  if (event.livemode !== (config.keyMode === "live")) {
    return NextResponse.json(
      { error: "Stripe webhook mode does not match this deployment." },
      { status: 400 },
    );
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

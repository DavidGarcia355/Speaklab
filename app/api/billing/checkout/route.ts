import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  STRIPE_CATALOG_MANIFEST,
  STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY,
  assertConfiguredStripeCatalog,
  assertConfiguredStripePortal,
  buildCheckoutSessionParams,
  getStripeBillingContractId,
  getStripeClient,
} from "@/lib/billing";
import {
  getStripeBillingAccountByTeacherEmail,
  isStripeBillingStorageReady,
  projectCurrentStripeEntitledSubscription,
  projectCurrentStripeNonEntitledSubscription,
  replaceStripeBillingCustomerMappingForRecovery,
  replaceTerminalStripeSubscriptionFromCheckout,
  upsertStripeBillingCustomer,
  type StripeBillingAccountRow,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";
import {
  billingIdempotencyKey,
  canonicalBillingUrl,
  requireAiCheckoutForApi,
  requireSubscriptionPeriodBoundsMs,
  requireStripeCheckoutConfigForApi,
  requireStripePortalConfigForApi,
  stripeObjectId,
} from "@/app/api/billing/_shared";

export const runtime = "nodejs";

const CHECKOUT_SESSION_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

function metadataValue(metadata: Stripe.Metadata | null | undefined, key: string) {
  return metadata?.[key]?.trim() || null;
}

function sessionCustomerId(session: Stripe.Checkout.Session) {
  return stripeObjectId(session.customer, "cus_");
}

function sessionSubscriptionId(session: Stripe.Checkout.Session) {
  return stripeObjectId(session.subscription, "sub_");
}

function subscriptionUsesConfiguredHablaPrice(
  subscription: Stripe.Subscription,
  priceIds: Readonly<{ teacher: string }>,
) {
  return subscription.items.data.some((item) => item.price.id === priceIds.teacher);
}

function checkoutSessionUsesConfiguredHablaPrice(
  session: Stripe.Checkout.Session,
  priceIds: Readonly<{ teacher: string }>,
) {
  return (
    session.line_items?.data.some((item) =>
      item.price?.id === priceIds.teacher,
    ) ?? false
  );
}

function isHablaCheckoutCandidate(
  session: Stripe.Checkout.Session,
  input: { teacherEmail: string; customerId: string },
) {
  return (
    sessionCustomerId(session) === input.customerId &&
    session.mode === "subscription" &&
    metadataValue(session.metadata, "habla_app") === "tryhabla" &&
    metadataValue(session.metadata, "teacher_email")?.toLowerCase() === input.teacherEmail
  );
}

function hasExactCheckoutLineItems(session: Stripe.Checkout.Session, config: {
  priceIds: Readonly<{ teacher: string }>;
}) {
  const lineItems = session.line_items;
  if (!lineItems || lineItems.has_more) return false;
  const item = lineItems.data[0];
  return (
    lineItems.data.length === 1 &&
    item?.price?.id === config.priceIds.teacher &&
    item.quantity === 1
  );
}

function isExactCheckoutSession(
  session: Stripe.Checkout.Session,
  input: {
    teacherEmail: string;
    customerId: string;
    keyMode: "test" | "live";
    priceIds: Readonly<{ teacher: string }>;
    automaticTaxEnabled: boolean;
    accountId: string;
    billingContractId: string;
  },
) {
  return (
    isHablaCheckoutCandidate(session, input) &&
    metadataValue(session.metadata, "price_book_id") === STRIPE_CATALOG_MANIFEST.priceBookId &&
    metadataValue(session.metadata, "catalog_fingerprint") ===
      STRIPE_CATALOG_MANIFEST.fingerprint &&
    session.client_reference_id?.trim().toLowerCase() === input.teacherEmail &&
    session.livemode === (input.keyMode === "live") &&
    session.currency === STRIPE_CATALOG_MANIFEST.currency &&
    session.payment_method_types.length === 1 &&
    session.payment_method_types[0] === "card" &&
    metadataValue(session.metadata, "payment_method_policy") ===
      STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY &&
    metadataValue(session.metadata, "stripe_account_id") === input.accountId &&
    metadataValue(session.metadata, "billing_contract_id") === input.billingContractId &&
    session.automatic_tax?.enabled === input.automaticTaxEnabled &&
    session.adaptive_pricing?.enabled === false &&
    hasExactCheckoutLineItems(session, input)
  );
}

function checkoutSessionGeneration(session: Stripe.Checkout.Session | null) {
  if (!session) return "none";
  // Stripe can flip mutable status/subscription fields between concurrent list
  // reads at expiration. Key generations only by immutable session identity so
  // both requests converge on one Checkout create idempotency key.
  return [session.id, session.created, session.expires_at].join(":");
}

function hasExactBillingMetadata(
  metadata: Stripe.Metadata | null | undefined,
  input: {
    teacherEmail: string;
    accountId: string;
    billingContractId: string;
  },
) {
  return (
    metadataValue(metadata, "habla_app") === "tryhabla" &&
    metadataValue(metadata, "teacher_email")?.toLowerCase() === input.teacherEmail &&
    metadataValue(metadata, "price_book_id") === STRIPE_CATALOG_MANIFEST.priceBookId &&
    metadataValue(metadata, "catalog_fingerprint") ===
      STRIPE_CATALOG_MANIFEST.fingerprint &&
    metadataValue(metadata, "payment_method_policy") ===
      STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY &&
    metadataValue(metadata, "stripe_account_id") === input.accountId &&
    metadataValue(metadata, "billing_contract_id") === input.billingContractId
  );
}

function isExactRecoveryCustomer(
  customer: Stripe.Customer,
  input: {
    teacherEmail: string;
    accountId: string;
    billingContractId: string;
    livemode: boolean;
  },
) {
  return (
    customer.livemode === input.livemode &&
    customer.email?.trim().toLowerCase() === input.teacherEmail &&
    hasExactBillingMetadata(customer.metadata, input)
  );
}

async function listAllStripeCustomersByEmail(
  stripe: ReturnType<typeof getStripeClient>,
  email: string,
) {
  const customers: Stripe.Customer[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.customers.list({
      email,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    customers.push(...page.data);
    if (!page.has_more) return customers;
    const last = page.data.at(-1)?.id;
    if (!last || last === startingAfter) {
      throw new Error("Stripe Customer pagination did not advance.");
    }
    startingAfter = last;
  }
}

async function listAllCustomerSubscriptions(
  stripe: ReturnType<typeof getStripeClient>,
  customerId: string,
) {
  const subscriptions: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    subscriptions.push(...page.data);
    if (!page.has_more) return subscriptions;
    const last = page.data.at(-1)?.id;
    if (!last || last === startingAfter) {
      throw new Error("Stripe Subscription pagination did not advance.");
    }
    startingAfter = last;
  }
}

async function listAllRecentCustomerCheckoutSessions(
  stripe: ReturnType<typeof getStripeClient>,
  customerId: string,
  createdGte: number,
) {
  const sessions: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      created: { gte: createdGte },
      expand: ["data.line_items"],
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    sessions.push(...page.data);
    if (!page.has_more) return sessions;
    const last = page.data.at(-1)?.id;
    if (!last || last === startingAfter) {
      throw new Error("Stripe Checkout Session pagination did not advance.");
    }
    startingAfter = last;
  }
}

function hasExactSubscriptionContract(
  subscription: Stripe.Subscription,
  input: {
    teacherEmail: string;
    customerId: string;
    accountId: string;
    billingContractId: string;
    livemode: boolean;
    automaticTaxEnabled: boolean;
    priceIds: Readonly<{ teacher: string }>;
  },
) {
  const customerId = stripeObjectId(subscription.customer, "cus_");
  const item = subscription.items.data[0];
  return (
    subscription.status.trim().toLowerCase() === "active" &&
    customerId === input.customerId &&
    subscription.livemode === input.livemode &&
    subscription.currency === STRIPE_CATALOG_MANIFEST.currency &&
    subscription.collection_method === "charge_automatically" &&
    subscription.pause_collection === null &&
    subscription.automatic_tax.enabled === input.automaticTaxEnabled &&
    (subscription.default_tax_rates?.length ?? 0) === 0 &&
    subscription.items.data.every((item) => (item.tax_rates?.length ?? 0) === 0) &&
    subscription.items.has_more !== true &&
    subscription.items.data.length === 1 &&
    item?.price.id === input.priceIds.teacher &&
    item.quantity === 1 &&
    hasExactBillingMetadata(subscription.metadata, input)
  );
}

function accountSnapshot(account: StripeBillingAccountRow) {
  return {
    stripeSubscriptionId: account.stripeSubscriptionId,
    subscriptionStatus: account.subscriptionStatus,
    stripeEventCreated: account.stripeEventCreated,
    projectionRevision: account.projectionRevision,
  };
}

async function projectRecoveredSubscription(input: {
  account: StripeBillingAccountRow;
  subscription: Stripe.Subscription;
  exactActiveContract: boolean;
}) {
  const status = input.subscription.status.trim().toLowerCase();
  const observedEventCreated = Math.max(0, input.subscription.created);
  const mappedDiffers = Boolean(
    input.account.stripeSubscriptionId &&
      input.account.stripeSubscriptionId !== input.subscription.id,
  );
  if (input.exactActiveContract) {
    const period = requireSubscriptionPeriodBoundsMs(input.subscription);
    const projected =
      mappedDiffers &&
      TERMINAL_SUBSCRIPTION_STATUSES.has(
        input.account.subscriptionStatus.trim().toLowerCase(),
      )
        ? await replaceTerminalStripeSubscriptionFromCheckout({
            stripeCustomerId: input.account.stripeCustomerId,
            stripeSubscriptionId: input.subscription.id,
            subscriptionStatus: "active",
            priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
            catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
            stripeAccountId: input.account.stripeAccountId,
            billingContractId: input.account.billingContractId,
            livemode: input.account.livemode,
            subscriptionPeriodStart: period.periodStart,
            subscriptionPeriodEnd: period.periodEnd,
            observedEventCreated,
            expectedAccount: accountSnapshot(input.account),
          })
        : await projectCurrentStripeEntitledSubscription({
            stripeCustomerId: input.account.stripeCustomerId,
            stripeSubscriptionId: input.subscription.id,
            subscriptionStatus: "active",
            priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
            catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
            stripeAccountId: input.account.stripeAccountId,
            billingContractId: input.account.billingContractId,
            livemode: input.account.livemode,
            subscriptionPeriodStart: period.periodStart,
            subscriptionPeriodEnd: period.periodEnd,
            observedEventCreated,
            expectedAccount: accountSnapshot(input.account),
          });
    if (!projected) throw new Error("Stripe recovery projection raced another billing update.");
    return projected;
  }

  if (mappedDiffers) {
    throw new Error("A different nonterminal Stripe Subscription requires billing support.");
  }
  const projected = await projectCurrentStripeNonEntitledSubscription({
    stripeCustomerId: input.account.stripeCustomerId,
    stripeSubscriptionId: input.subscription.id,
    subscriptionStatus: status === "active" ? "invalid_catalog" : status,
    priceBookId:
      metadataValue(input.subscription.metadata, "price_book_id") ?? "unverified",
    stripeAccountId: input.account.stripeAccountId,
    billingContractId: input.account.billingContractId,
    livemode: input.account.livemode,
    observedEventCreated,
    expectedAccount: accountSnapshot(input.account),
  });
  if (!projected) throw new Error("Stripe recovery projection raced another billing update.");
  return projected;
}

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const config = requireStripeCheckoutConfigForApi();
    const portalConfig = requireStripePortalConfigForApi();
    const billingContractId = getStripeBillingContractId(config);
    requireAiCheckoutForApi(teacherEmail);
    try {
      if (
        portalConfig.keyMode !== config.keyMode ||
        portalConfig.accountId !== config.accountId
      ) {
        throw new Error("Stripe Portal account does not match Checkout.");
      }
      await Promise.all([
        assertConfiguredStripeCatalog(config),
        assertConfiguredStripePortal(portalConfig),
      ]);
      if (!(await isStripeBillingStorageReady())) {
        throw new Error("Legacy billing rows require reconciliation.");
      }
    } catch {
      throw new HttpError(
        503,
        "Stripe pricing and self-service billing are being verified. Checkout is temporarily unavailable.",
      );
    }
    const stripe = getStripeClient(config);
    let account = await getStripeBillingAccountByTeacherEmail(teacherEmail);
    const expectedLivemode = config.keyMode === "live";
    const recoveryScope = {
      teacherEmail,
      accountId: config.accountId,
      billingContractId,
      livemode: expectedLivemode,
    };
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const remoteCustomers = await listAllStripeCustomersByEmail(stripe, teacherEmail);
    if (
      account &&
      !remoteCustomers.some((customer) => customer.id === account?.stripeCustomerId)
    ) {
      const mappedCustomer = await stripe.customers.retrieve(account.stripeCustomerId);
      if (mappedCustomer.deleted) {
        throw new HttpError(
          409,
          "The mapped Stripe Customer was deleted. Contact billing support.",
        );
      }
      remoteCustomers.push(mappedCustomer);
    }
    const exactCustomers = remoteCustomers.filter((customer) =>
      isExactRecoveryCustomer(customer, recoveryScope),
    );
    if (exactCustomers.length > 1) {
      throw new HttpError(
        409,
        "Multiple Habla Stripe Customers require billing support before Checkout can continue.",
      );
    }

    let customerId = exactCustomers[0]?.id ?? null;
    const subscriptionsByCustomer = new Map<string, Stripe.Subscription[]>();
    const sessionsByCustomer = new Map<string, Stripe.Checkout.Session[]>();
    for (const customer of remoteCustomers) {
      subscriptionsByCustomer.set(
        customer.id,
        await listAllCustomerSubscriptions(stripe, customer.id),
      );
      sessionsByCustomer.set(
        customer.id,
        await listAllRecentCustomerCheckoutSessions(
          stripe,
          customer.id,
          Math.max(0, nowSeconds - CHECKOUT_SESSION_LOOKBACK_SECONDS),
        ),
      );
    }
    if (
      account &&
      !subscriptionsByCustomer.has(account.stripeCustomerId)
    ) {
      throw new HttpError(
        409,
        "The mapped Stripe Customer is outside the recoverable email history. Contact billing support.",
      );
    }
    for (const customer of remoteCustomers) {
      const isCurrentRecoveryCustomer = customer.id === customerId;
      const customerIsHabla =
        metadataValue(customer.metadata, "habla_app") === "tryhabla";
      const customerIsDedicated =
        customerIsHabla || customer.id === account?.stripeCustomerId;
      const unsafeNonterminal = (subscriptionsByCustomer.get(customer.id) ?? []).some(
        (subscription) => {
          const nonterminal = !TERMINAL_SUBSCRIPTION_STATUSES.has(
            subscription.status.trim().toLowerCase(),
          );
          return (
            nonterminal &&
            (customerIsDedicated ||
              metadataValue(subscription.metadata, "habla_app") === "tryhabla" ||
              subscriptionUsesConfiguredHablaPrice(subscription, config.priceIds) ||
              subscription.id === account?.stripeSubscriptionId)
          );
        },
      );
      const subscriptionStatusById = new Map(
        (subscriptionsByCustomer.get(customer.id) ?? []).map((subscription) => [
          subscription.id,
          subscription.status.trim().toLowerCase(),
        ]),
      );
      const unsafeCheckoutSession = (sessionsByCustomer.get(customer.id) ?? []).some(
        (session) => {
          const sessionIsHabla =
            customerIsDedicated ||
            metadataValue(session.metadata, "habla_app") === "tryhabla" ||
            checkoutSessionUsesConfiguredHablaPrice(session, config.priceIds);
          if (!sessionIsHabla) return false;
          if (session.status === "open") return session.expires_at > nowSeconds;
          if (session.status !== "complete") return false;
          const subscriptionId = sessionSubscriptionId(session);
          if (!subscriptionId) return true;
          const subscriptionStatus = subscriptionStatusById.get(subscriptionId);
          return (
            !subscriptionStatus ||
            !TERMINAL_SUBSCRIPTION_STATUSES.has(subscriptionStatus)
          );
        },
      );
      if ((unsafeNonterminal || unsafeCheckoutSession) && !isCurrentRecoveryCustomer) {
        throw new HttpError(
          409,
          "An older Habla Stripe Customer still has an open billing lifecycle. Contact billing support.",
        );
      }
    }
    if (account) {
      const accountMatchesCurrentScope =
        account.livemode === expectedLivemode &&
        account.stripeAccountId === config.accountId &&
        account.billingContractId === billingContractId;
      if (accountMatchesCurrentScope && customerId && account.stripeCustomerId !== customerId) {
        const localStatus = account.subscriptionStatus.trim().toLowerCase();
        if (localStatus && !TERMINAL_SUBSCRIPTION_STATUSES.has(localStatus)) {
          throw new HttpError(
            409,
            "Stripe Customer recovery conflicts with an existing subscription mapping.",
          );
        }
      }
      if (
        accountMatchesCurrentScope &&
        (!customerId || account.stripeCustomerId !== customerId)
      ) {
        throw new HttpError(
          409,
          "The mapped Stripe Customer could not be verified. Contact billing support.",
        );
      }
      if (!accountMatchesCurrentScope) {
        const localStatus = account.subscriptionStatus.trim().toLowerCase();
        if (localStatus && !TERMINAL_SUBSCRIPTION_STATUSES.has(localStatus)) {
          throw new HttpError(
            409,
            "The previous Stripe billing scope still has a nonterminal local subscription.",
          );
        }
        if (!customerId) {
          throw new HttpError(
            409,
            "Stripe billing scope changed and no verified recovery Customer was found.",
          );
        }
        account = await replaceStripeBillingCustomerMappingForRecovery({
          teacherEmail,
          stripeCustomerId: customerId,
          stripeAccountId: config.accountId,
          billingContractId,
          livemode: expectedLivemode,
          expectedAccount: account,
        });
        if (!account) {
          throw new HttpError(409, "Stripe Customer recovery raced another billing update.");
        }
      }
    }

    if (!customerId) {
      if (account) {
        throw new HttpError(409, "The mapped Stripe Customer requires billing support.");
      }
      const customer = await stripe.customers.create(
        {
          email: teacherEmail,
          metadata: {
            habla_app: "tryhabla",
            teacher_email: teacherEmail,
            price_book_id: TEACHER_AI_PRICE_BOOK.id,
            catalog_fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
            payment_method_policy: STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY,
            stripe_account_id: config.accountId,
            billing_contract_id: billingContractId,
          },
        },
        {
          idempotencyKey: billingIdempotencyKey(
            "customer",
            teacherEmail,
            `v2:${billingContractId.slice(0, 16)}`,
          ),
        },
      );
      customerId = customer.id;
      if (
        typeof customer.livemode === "boolean" &&
        customer.livemode !== expectedLivemode
      ) {
        throw new HttpError(502, "Stripe returned a Customer in the wrong mode.");
      }
      account = await upsertStripeBillingCustomer({
        teacherEmail,
        stripeCustomerId: customerId,
        stripeAccountId: config.accountId,
        billingContractId,
        livemode: expectedLivemode,
      });
      customerId = account.stripeCustomerId;
      subscriptionsByCustomer.set(customerId, []);
      sessionsByCustomer.set(customerId, []);
    }

    if (!account) {
      account = await upsertStripeBillingCustomer({
        teacherEmail,
        stripeCustomerId: customerId,
        stripeAccountId: config.accountId,
        billingContractId,
        livemode: expectedLivemode,
      });
    }
    const subscriptions =
      subscriptionsByCustomer.get(customerId) ??
      (await listAllCustomerSubscriptions(stripe, customerId));
    const nonterminalHablaSubscriptions = subscriptions.filter((subscription) => {
      const status = subscription.status.trim().toLowerCase();
      return !TERMINAL_SUBSCRIPTION_STATUSES.has(status);
    });
    if (nonterminalHablaSubscriptions.length > 1) {
      throw new HttpError(
        409,
        "Multiple Habla subscriptions require billing support before Checkout can continue.",
      );
    }
    if (nonterminalHablaSubscriptions.length === 1) {
      const subscription = nonterminalHablaSubscriptions[0];
      account = await projectRecoveredSubscription({
        account,
        subscription,
        exactActiveContract: hasExactSubscriptionContract(subscription, {
          ...recoveryScope,
          customerId,
          automaticTaxEnabled: config.automaticTaxEnabled,
          priceIds: config.priceIds,
        }),
      });
    } else if (account.stripeSubscriptionId) {
      const mappedRemoteSubscription = subscriptions.find(
        (subscription) => subscription.id === account?.stripeSubscriptionId,
      );
      if (!mappedRemoteSubscription) {
        throw new HttpError(
          409,
          "The mapped Stripe Subscription could not be verified. Contact billing support.",
        );
      }
      account = await projectRecoveredSubscription({
        account,
        subscription: mappedRemoteSubscription,
        exactActiveContract: false,
      });
    }
    if (nonterminalHablaSubscriptions.length > 0) {
      throw new HttpError(
        409,
        "This account already has a Stripe subscription. Open Manage billing instead.",
      );
    }

    const recent = await stripe.checkout.sessions.list({
      customer: customerId,
      created: { gte: Math.max(0, nowSeconds - CHECKOUT_SESSION_LOOKBACK_SECONDS) },
      expand: ["data.line_items"],
      limit: 100,
    });
    if (recent.has_more) {
      throw new HttpError(
        503,
        "Checkout history is still being verified. Please try again shortly.",
      );
    }
    const candidates = recent.data
      .filter((session) =>
        isHablaCheckoutCandidate(session, { teacherEmail, customerId }),
      )
      .sort((left, right) => right.created - left.created || right.id.localeCompare(left.id));
    const exactInput = {
      teacherEmail,
      customerId,
      keyMode: config.keyMode,
      priceIds: config.priceIds,
      automaticTaxEnabled: config.automaticTaxEnabled,
      accountId: config.accountId,
      billingContractId,
    };
    const terminalSubscriptionIds = new Set(
      subscriptions
        .filter((subscription) =>
          TERMINAL_SUBSCRIPTION_STATUSES.has(
            subscription.status.trim().toLowerCase(),
          ),
        )
        .map((subscription) => subscription.id),
    );
    const completedAwaitingWebhook = recent.data.find(
      (session) => {
        const subscriptionId = sessionSubscriptionId(session);
        return (
          session.status === "complete" &&
          (!subscriptionId ||
            (!terminalSubscriptionIds.has(subscriptionId) &&
              (subscriptionId !== account?.stripeSubscriptionId ||
                !TERMINAL_SUBSCRIPTION_STATUSES.has(
                  account?.subscriptionStatus.trim().toLowerCase() ?? "",
                ))))
        );
      },
    );
    if (completedAwaitingWebhook) {
      throw new HttpError(
        409,
        "Stripe Checkout completed and account activation is still processing.",
      );
    }

    const openCandidates = recent.data.filter(
      (session) => session.status === "open" && session.expires_at > nowSeconds,
    );
    if (openCandidates.length > 1) {
      throw new HttpError(
        409,
        "Multiple Stripe Checkout sessions are still open. Wait for them to expire or contact billing support.",
      );
    }
    const reusable = openCandidates[0];
    if (reusable && isExactCheckoutSession(reusable, exactInput)) {
      if (!reusable.url) {
        throw new HttpError(502, "Stripe Checkout did not return a redirect URL.");
      }
      return NextResponse.json({ url: reusable.url });
    }
    if (reusable) {
      throw new HttpError(
        409,
        "An existing Stripe Checkout session is still open but does not match the active catalog.",
      );
    }

    const latestCandidate = candidates[0] ?? null;

    const checkoutParams = buildCheckoutSessionParams({
      config,
      teacherEmail,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      customerId,
      successUrl: canonicalBillingUrl("/billing?checkout=returned"),
      cancelUrl: canonicalBillingUrl("/billing?checkout=cancelled"),
    });
    const session = await stripe.checkout.sessions.create(
      {
        ...checkoutParams,
        adaptive_pricing: { enabled: false },
        client_reference_id: teacherEmail,
      },
      {
        idempotencyKey: billingIdempotencyKey(
          "checkout",
          teacherEmail,
          `v5:${billingContractId.slice(0, 16)}:${checkoutSessionGeneration(latestCandidate)}`,
        ),
      },
    );
    if (!session.url) throw new HttpError(502, "Stripe Checkout did not return a redirect URL.");
    return NextResponse.json({ url: session.url });
  });
}

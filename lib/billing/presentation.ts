export type BillingAccess = "inactive" | "pilot" | "active";

export type BillingAccountIssue =
  | "price_book_mismatch"
  | "catalog_unverified"
  | "billing_paused"
  | "mode_mismatch"
  | "account_mismatch"
  | "billing_contract_mismatch"
  | null;

export type BillingStatus = {
  clientConfigured: boolean;
  runtimeAvailable: boolean;
  portalAvailable: boolean;
  checkoutAvailable: boolean;
  checkoutUnavailableReason: string | null;
  mode: "test" | "live" | null;
  accountIssue: BillingAccountIssue;
  priceBook: {
    id: string;
    effectiveAt: string | null;
  };
  access: BillingAccess;
  subscriptionStatus: string | null;
  periodEnd: number | null;
  usage: {
    allowanceKind:
      | "free_lifetime"
      | "manual_lifetime"
      | "teacher_period"
      | "subscription_unavailable";
    limit: number;
    reservedReviews: number;
    consumedReviews: number;
    usedReviews: number;
    remainingReviews: number;
    periodStart: number | null;
    periodEnd: number | null;
  };
};

export type CheckoutReturnState =
  | "none"
  | "returned"
  | "confirmed"
  | "timed_out"
  | "cancelled";

export type BillingNotice = {
  tone: "neutral" | "success" | "warning";
  text: string;
};

export type BillingPresentation = {
  subscribed: boolean;
  heading: string;
  description: string;
  notice: BillingNotice | null;
  availabilityNote: string | null;
  showCheckout: boolean;
  showPortal: boolean;
  portalIsPrimary: boolean;
  showSupport: boolean;
  showRefresh: boolean;
};

const PAYMENT_ATTENTION_STATES = new Set(["past_due", "unpaid", "incomplete", "paused"]);
const TERMINAL_STATES = new Set(["canceled", "incomplete_expired"]);

function normalizedSubscriptionStatus(status: BillingStatus) {
  return status.subscriptionStatus?.trim().toLowerCase() ?? "";
}

function checkoutNotice(
  returnState: CheckoutReturnState,
  subscribed: boolean,
): BillingNotice | null {
  if (subscribed && (returnState === "returned" || returnState === "confirmed")) {
    return {
      tone: "success",
      text: "Stripe confirmation was received. Your AI billing access is active.",
    };
  }
  if (returnState === "returned") {
    return {
      tone: "neutral",
      text: "You returned from Stripe. TryHabla is waiting for signed confirmation before activating AI. Do not start another checkout yet.",
    };
  }
  if (returnState === "timed_out") {
    return {
      tone: "warning",
      text: "Stripe confirmation has not reached TryHabla yet. Refresh your status or contact billing support before starting another checkout.",
    };
  }
  if (returnState === "cancelled" && !subscribed) {
    return {
      tone: "neutral",
      text: "Checkout was not completed during this visit. No new AI access has been confirmed.",
    };
  }
  return null;
}

function issueAvailabilityNote(status: BillingStatus) {
  if (
    status.accountIssue === "mode_mismatch" ||
    status.accountIssue === "account_mismatch" ||
    status.accountIssue === "billing_contract_mismatch"
  ) {
    return "This subscription does not match this deployment's verified Stripe billing scope. AI access and new Checkout stay paused until billing support reconciles it.";
  }
  if (status.accountIssue === "price_book_mismatch") {
    return "This Stripe subscription does not match TryHabla's current published AI price book. Manage the existing plan or contact billing support; do not start another checkout.";
  }
  if (status.accountIssue === "catalog_unverified") {
    return "TryHabla is verifying the Stripe catalog against the published Teacher plan. Checkout stays unavailable until that verification passes.";
  }
  if (status.accountIssue === "billing_paused") {
    return "New Stripe checkout and paid-plan access are temporarily paused. Existing customers can still open Manage billing.";
  }
  if (status.access === "active") {
    return null;
  }
  if (!status.checkoutAvailable && status.checkoutUnavailableReason) {
    return status.checkoutUnavailableReason;
  }
  if (!status.checkoutAvailable) {
    return "Stripe self-service is not available for this account right now.";
  }
  return null;
}

function stateCopy(status: BillingStatus) {
  const subscriptionStatus = normalizedSubscriptionStatus(status);

  if (
    status.accountIssue === "mode_mismatch" ||
    status.accountIssue === "account_mismatch" ||
    status.accountIssue === "billing_contract_mismatch"
  ) {
    return {
      heading: "This Stripe account needs review",
      description:
        "AI billing access is paused because this subscription is outside TryHabla's verified billing environment or contract.",
    };
  }
  if (status.accountIssue === "price_book_mismatch") {
    return {
      heading: "This Stripe plan needs review",
      description:
        "AI billing access is paused because this subscription is not on TryHabla's current published price book.",
    };
  }
  if (subscriptionStatus === "past_due") {
    return {
      heading: "Payment needs attention",
      description:
        "Stripe reports that this subscription is past due. Open Manage billing to update payment details and restore AI access.",
    };
  }
  if (subscriptionStatus === "unpaid") {
    return {
      heading: "This subscription is unpaid",
      description:
        "AI access is paused. Open Manage billing to review the balance and payment method in Stripe.",
    };
  }
  if (subscriptionStatus === "incomplete") {
    return {
      heading: "Finish setting up payment",
      description:
        "Stripe has not completed this subscription. Open Manage billing to finish or correct the payment setup.",
    };
  }
  if (subscriptionStatus === "paused") {
    return {
      heading: "This Stripe plan is paused",
      description:
        "AI billing access is paused. Open Manage billing to review the subscription before using paid AI.",
    };
  }
  if (subscriptionStatus === "canceled") {
    return {
      heading: "The previous Stripe plan ended",
      description:
        "That subscription no longer provides AI access. You may review it in Stripe or start a new plan when Checkout is offered.",
    };
  }
  if (subscriptionStatus === "incomplete_expired") {
    return {
      heading: "The previous Checkout expired",
      description:
        "No AI billing plan was activated from that setup. You may start a new Checkout when it is offered.",
    };
  }
  if (status.access === "active") {
    return {
      heading: "Teacher is active",
      description:
        "$20 per month includes 300 successful AI reviews in each verified Stripe billing period, with no automatic overages.",
    };
  }
  if (status.access === "pilot") {
    return {
      heading: "Manual AI access is active",
      description:
        "Your manual lifetime allowance is separate from Stripe billing and has no automatic overages.",
    };
  }
  if (status.accountIssue === "catalog_unverified") {
    return {
      heading: "Stripe pricing is being verified",
      description:
        "TryHabla will not offer Checkout until its Stripe catalog matches the published AI rates.",
    };
  }
  if (status.accountIssue === "billing_paused") {
    return {
      heading: "New AI billing is temporarily paused",
      description:
        "No new Stripe plan can be started right now. Core recording and manual grading remain available.",
    };
  }
  if (subscriptionStatus) {
    return {
      heading: "Billing needs review",
      description:
        "Stripe reported a subscription state that TryHabla cannot activate automatically. Manage billing or contact support before using paid AI.",
    };
  }
  return {
    heading: "Start with 30 free AI reviews",
    description:
      "Your one-time Free allowance works without a card. Choose Teacher for 300 reviews in each Stripe billing period. Stripe is the only product-payment method.",
  };
}

export function deriveBillingPresentation(
  status: BillingStatus,
  returnState: CheckoutReturnState = "none",
): BillingPresentation {
  const subscriptionStatus = normalizedSubscriptionStatus(status);
  const subscribed = status.access === "active";
  const paymentAttention = PAYMENT_ATTENTION_STATES.has(subscriptionStatus);
  const terminal = TERMINAL_STATES.has(subscriptionStatus);
  const hasSubscriptionRecord = Boolean(subscriptionStatus);
  const awaitingConfirmation = returnState === "returned" || returnState === "timed_out";
  const canStartCheckout =
    status.checkoutAvailable &&
    !subscribed &&
    !paymentAttention &&
    status.accountIssue === null &&
    (!hasSubscriptionRecord || terminal) &&
    !awaitingConfirmation;
  const showPortal = status.portalAvailable;
  const copy = stateCopy(status);

  return {
    subscribed,
    heading: copy.heading,
    description: copy.description,
    notice: checkoutNotice(returnState, subscribed),
    availabilityNote: issueAvailabilityNote(status),
    showCheckout: canStartCheckout,
    showPortal,
    portalIsPrimary:
      showPortal &&
      (subscribed ||
        paymentAttention ||
        Boolean(status.accountIssue) ||
        (hasSubscriptionRecord && !terminal)),
    showSupport:
      Boolean(status.accountIssue) ||
      paymentAttention ||
      (hasSubscriptionRecord && !showPortal) ||
      returnState === "timed_out",
    showRefresh: returnState === "timed_out" && !subscribed,
  };
}

export function billingStatusConfirmsAccess(status: BillingStatus) {
  return status.access === "active";
}

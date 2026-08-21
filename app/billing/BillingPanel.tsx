"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, CreditCard, LoaderCircle, TriangleAlert } from "lucide-react";

type BillingStatus = {
  configured: boolean;
  checkoutAvailable: boolean;
  checkoutUnavailableReason: string | null;
  mode: "test" | "live" | null;
  priceBook: {
    id: string;
    effectiveAt: string | null;
  };
  access: "inactive" | "pilot" | "active" | "trialing";
  subscriptionStatus: string | null;
  periodEnd: number | null;
  usage: {
    successfulGrades: number;
    audioSeconds: number;
    outputTokens: number;
    qualifyingClasses: number;
    monthlyFreeCredits: number;
    freeCreditsUsed: number;
    estimatedChargeUsd: number;
  };
};

type ActionResponse = { url?: string; error?: string };

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPeriodEnd(timestamp: number | null) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function BillingPanel() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"checkout" | "portal" | "">("");
  const [checkoutOutcome, setCheckoutOutcome] = useState<"success" | "cancelled" | "">("");
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/billing/status", { cache: "no-store" });
      const body = (await response.json()) as BillingStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load billing status.");
      setStatus(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load billing status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success" || checkout === "cancelled") setCheckoutOutcome(checkout);
    void loadStatus();
  }, [loadStatus]);

  async function openStripe(kind: "checkout" | "portal") {
    setAction(kind);
    setError("");
    try {
      const response = await fetch(`/api/billing/${kind}`, { method: "POST" });
      const body = (await response.json()) as ActionResponse;
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Stripe could not be opened right now.");
      }
      window.location.assign(body.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stripe could not be opened right now.");
      setAction("");
    }
  }

  if (loading) {
    return (
      <section className="billing-panel billing-panel-loading" aria-live="polite">
        <LoaderCircle className="billing-spinner" size={23} aria-hidden="true" />
        Checking your billing access…
      </section>
    );
  }

  if (!status) {
    return (
      <section className="billing-panel billing-panel-error" role="alert">
        <TriangleAlert size={22} aria-hidden="true" />
        <div>
          <strong>Billing status is unavailable.</strong>
          <p>{error}</p>
          <button className="btn btn-ghost" type="button" onClick={() => void loadStatus()}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  const subscribed = status.access === "active" || status.access === "trialing";
  const hasPortal = subscribed || Boolean(status.subscriptionStatus);
  const canCheckout =
    !status.subscriptionStatus ||
    status.subscriptionStatus === "canceled" ||
    status.subscriptionStatus === "incomplete_expired";

  return (
    <section className="billing-panel" aria-labelledby="billing-status-heading">
      <div className="billing-panel-main">
        {checkoutOutcome ? (
          <p className={`billing-checkout-note ${checkoutOutcome === "success" ? "is-success" : ""}`}>
            {checkoutOutcome === "success"
              ? "Checkout completed. Stripe access can take a moment to appear after the signed webhook arrives."
              : "Checkout was cancelled. No subscription was activated."}
          </p>
        ) : null}
        <div className="billing-status-heading">
          <div className="billing-status-icon" aria-hidden="true">
            {subscribed || status.access === "pilot" ? (
              <CheckCircle2 size={26} />
            ) : (
              <CreditCard size={26} />
            )}
          </div>
          <div>
            <p className="pill pill-subtle">
              {status.mode === "test" ? "Stripe test mode" : "Teacher account"}
            </p>
            <h2 id="billing-status-heading">
              {subscribed
                ? "AI billing is active"
                : status.access === "pilot"
                  ? "AI pilot access is active"
                  : "AI billing is off"}
            </h2>
            <p>
              {subscribed
                ? `Usage is tracked under ${status.priceBook.id}.${
                    status.periodEnd ? ` Current period ends ${formatPeriodEnd(status.periodEnd)}.` : ""
                  }`
                : status.access === "pilot"
                  ? "Your manual pilot access remains separate from Stripe billing."
                  : "You are never charged until you complete Stripe Checkout."}
            </p>
          </div>
        </div>

        {error ? <p className="form-error billing-action-error">{error}</p> : null}

        <div className="billing-actions">
          {!subscribed && status.access !== "pilot" && canCheckout ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={!status.checkoutAvailable || Boolean(action)}
              onClick={() => void openStripe("checkout")}
            >
              {action === "checkout" ? "Opening checkout…" : "Activate AI billing"}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          ) : null}
          {hasPortal ? (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={!status.configured || Boolean(action)}
              onClick={() => void openStripe("portal")}
            >
              {action === "portal" ? "Opening Stripe…" : "Manage billing"}
            </button>
          ) : null}
        </div>

        {!status.configured ? (
          <p className="billing-availability-note">
            Self-serve checkout is not enabled for this deployment yet. Core Habla remains available.
          </p>
        ) : null}
        {status.configured && !status.checkoutAvailable && !subscribed ? (
          <p className="billing-availability-note">
            {status.checkoutUnavailableReason ?? "AI Checkout is not available yet."} Core Habla
            remains available.
          </p>
        ) : null}
      </div>

      <aside className="billing-usage-card" aria-label="Current month AI usage">
        <span>Current UTC month</span>
        <strong>{usd.format(status.usage.estimatedChargeUsd)}</strong>
        <small>recorded retail usage</small>
        <dl>
          <div>
            <dt>Successful grades</dt>
            <dd>{status.usage.successfulGrades.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Audio</dt>
            <dd>
              {status.usage.audioSeconds.toLocaleString()} sec
              {status.usage.audioSeconds > 0
                ? ` (${(status.usage.audioSeconds / 60).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })} min)`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Feedback tokens</dt>
            <dd>{status.usage.outputTokens.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Free credits</dt>
            <dd>
              {status.usage.freeCreditsUsed}/{status.usage.monthlyFreeCredits}
            </dd>
          </div>
        </dl>
      </aside>
    </section>
  );
}

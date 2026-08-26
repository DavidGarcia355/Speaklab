"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, CreditCard, LoaderCircle, TriangleAlert } from "lucide-react";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";
import {
  billingStatusConfirmsAccess,
  deriveBillingPresentation,
  type BillingStatus,
  type CheckoutReturnState,
} from "@/lib/billing/presentation";

type ActionResponse = { url?: string; error?: string };
type StatusResponse = BillingStatus & { error?: string };

const PAYPAL_URL = "https://paypal.me/DavidGarcia355";
const BILLING_SUPPORT_URL =
  "mailto:davidsgarcia325@gmail.com?subject=Habla%20billing%20support";
const CONFIRMATION_POLL_INTERVAL_MS = 1_500;
const MAX_CONFIRMATION_POLLS = 10;

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

function billingBadge(status: BillingStatus) {
  if (status.mode === "test") return "Stripe test mode";
  if (status.runtimeAvailable) return "Habla teacher billing";
  if (status.clientConfigured) return "Stripe controls limited";
  return "Habla AI access";
}

async function responseBody<T extends { error?: string }>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export default function BillingPanel() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"checkout" | "portal" | "refresh" | "">("");
  const [checkoutReturn, setCheckoutReturn] = useState<CheckoutReturnState>("none");
  const [authFailure, setAuthFailure] = useState<401 | 403 | null>(null);
  const [error, setError] = useState("");
  const hasLoadedStatus = status !== null;
  const accessConfirmed = status ? billingStatusConfirmsAccess(status) : false;

  const loadStatus = useCallback(
    async (options: { silent?: boolean; surfaceError?: boolean } = {}) => {
      const silent = options.silent === true;
      if (!silent) {
        setLoading(true);
        setError("");
      }
      try {
        const response = await fetch("/api/billing/status", { cache: "no-store" });
        const body = await responseBody<StatusResponse>(response);
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setAuthFailure(response.status);
          }
          throw new Error(body.error || "Could not load billing status.");
        }
        setAuthFailure(null);
        setStatus(body);
        return body;
      } catch (caught) {
        if (!silent || options.surfaceError) {
          setError(caught instanceof Error ? caught.message : "Could not load billing status.");
        }
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const checkout = url.searchParams.get("checkout");
    if (checkout === "returned" || checkout === "success") {
      setCheckoutReturn("returned");
    } else if (checkout === "cancelled") {
      setCheckoutReturn("cancelled");
    }
    if (checkout) {
      url.searchParams.delete("checkout");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (checkoutReturn !== "returned" || loading || !hasLoadedStatus) return;
    if (accessConfirmed) {
      setCheckoutReturn("confirmed");
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    let attempts = 0;

    async function pollForConfirmation() {
      attempts += 1;
      const nextStatus = await loadStatus({ silent: true });
      if (cancelled) return;
      if (nextStatus && billingStatusConfirmsAccess(nextStatus)) {
        setCheckoutReturn("confirmed");
        return;
      }
      if (attempts >= MAX_CONFIRMATION_POLLS) {
        setCheckoutReturn("timed_out");
        return;
      }
      timeoutId = window.setTimeout(pollForConfirmation, CONFIRMATION_POLL_INTERVAL_MS);
    }

    timeoutId = window.setTimeout(pollForConfirmation, CONFIRMATION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [accessConfirmed, checkoutReturn, hasLoadedStatus, loading, loadStatus]);

  async function openStripe(kind: "checkout" | "portal") {
    setAction(kind);
    setError("");
    try {
      const response = await fetch(`/api/billing/${kind}`, { method: "POST" });
      const body = await responseBody<ActionResponse>(response);
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Stripe could not be opened right now.");
      }
      window.location.assign(body.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stripe could not be opened right now.");
      setAction("");
    }
  }

  async function refreshConfirmation() {
    setAction("refresh");
    setError("");
    const nextStatus = await loadStatus({ silent: true, surfaceError: true });
    if (nextStatus && billingStatusConfirmsAccess(nextStatus)) {
      setCheckoutReturn("confirmed");
    }
    setAction("");
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
    const needsTeacherSignIn = authFailure === 401 || authFailure === 403;
    return (
      <section className="billing-panel billing-panel-error" role="alert">
        <TriangleAlert size={22} aria-hidden="true" />
        <div>
          <strong>
            {needsTeacherSignIn ? "Teacher sign-in is required." : "Billing status is unavailable."}
          </strong>
          <p>
            {needsTeacherSignIn
              ? "Sign in with an approved teacher account to view AI access and Stripe billing."
              : error}
          </p>
          {needsTeacherSignIn ? (
            <GoogleSignInLink className="btn btn-primary" callbackUrl="/billing">
              Sign in as a teacher
            </GoogleSignInLink>
          ) : (
            <button className="btn btn-ghost" type="button" onClick={() => void loadStatus()}>
              Try again
            </button>
          )}
        </div>
      </section>
    );
  }

  const presentation = deriveBillingPresentation(status, checkoutReturn);
  const hasAccess = presentation.subscribed || status.access === "pilot";
  const periodEnd = presentation.subscribed ? formatPeriodEnd(status.periodEnd) : "";
  const portalButton = presentation.showPortal ? (
    <button
      className={`btn ${presentation.portalIsPrimary ? "btn-primary" : "btn-ghost"}`}
      type="button"
      disabled={Boolean(action)}
      onClick={() => void openStripe("portal")}
    >
      {action === "portal" ? "Opening Stripe…" : "Manage billing"}
    </button>
  ) : null;

  return (
    <section className="billing-panel" aria-labelledby="billing-status-heading">
      <div className="billing-panel-main">
        {presentation.notice ? (
          <p
            className={`billing-checkout-note is-${presentation.notice.tone}`}
            role={presentation.notice.tone === "warning" ? "alert" : "status"}
          >
            {presentation.notice.text}
          </p>
        ) : null}

        <div className="billing-status-heading">
          <div className="billing-status-icon" aria-hidden="true">
            {hasAccess ? <CheckCircle2 size={26} /> : <CreditCard size={26} />}
          </div>
          <div>
            <p className="pill pill-subtle">{billingBadge(status)}</p>
            <h2 id="billing-status-heading">{presentation.heading}</h2>
            <p>
              {presentation.description}
              {periodEnd ? ` Current Stripe period ends ${periodEnd}.` : ""}
            </p>
          </div>
        </div>

        <div className="billing-plan-terms" aria-label="Published Stripe AI plan terms">
          <strong>Published Stripe AI plan</strong>
          <p>
            $0.05 per successful unique AI grade plus $0.01 per processed audio minute, billed
            monthly in arrears. Audio is measured per result and rounded up to the next whole second.
            Each distinct recording is a separate result; exact retries of the same recording and
            assignment are deduplicated. AI feedback is included. Each UTC month includes one fewer
            free whole-result credit than your first 30 qualifying active classes (29 credits
            maximum); credits do not roll over. Habla does not add or collect tax through this plan
            in the current release. You can cancel through Manage billing, where Stripe shows the
            effective date before confirmation.
          </p>
        </div>

        {error ? <p className="form-error billing-action-error">{error}</p> : null}

        <div className="billing-actions">
          {presentation.portalIsPrimary ? portalButton : null}
          {presentation.showCheckout ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={Boolean(action)}
              onClick={() => void openStripe("checkout")}
            >
              {action === "checkout" ? "Opening checkout…" : "Activate AI billing"}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          ) : null}
          {!presentation.portalIsPrimary ? portalButton : null}
          {presentation.showRefresh ? (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={Boolean(action)}
              onClick={() => void refreshConfirmation()}
            >
              {action === "refresh" ? "Refreshing…" : "Refresh billing status"}
            </button>
          ) : null}
          {presentation.showPayPal ? (
            <a
              className="btn btn-ghost"
              href={PAYPAL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Support Habla on PayPal
              <ArrowRight size={17} aria-hidden="true" />
            </a>
          ) : null}
          {presentation.showSupport ? (
            <a className="btn btn-ghost" href={BILLING_SUPPORT_URL}>
              Contact billing support
            </a>
          ) : null}
        </div>

        {presentation.availabilityNote ? (
          <p className="billing-availability-note">
            {presentation.availabilityNote} PayPal is voluntary support only and never purchases or
            activates AI access.
          </p>
        ) : null}
      </div>

      <aside className="billing-usage-card" aria-label="Current UTC-month AI usage estimate">
        <span>Current UTC month</span>
        <strong>{usd.format(status.usage.estimatedChargeUsd)}</strong>
        <small>
          {status.access === "active"
            ? "estimated usage at published rates — not a Stripe invoice"
            : "estimated value at published rates — not an amount due"}
        </small>
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
            <dt>AI feedback</dt>
            <dd>Included</dd>
          </div>
          <div>
            <dt>{presentation.subscribed ? "Included credits" : "Published-rate credits"}</dt>
            <dd>
              {status.usage.freeCreditsUsed}/{status.usage.monthlyFreeCredits}
            </dd>
          </div>
        </dl>
        <p className="billing-usage-caveat">
          Habla shows a UTC-calendar-month estimate. Your Stripe invoice period can use different
          dates; Manage billing is the source for invoices and amounts due.
        </p>
      </aside>
    </section>
  );
}

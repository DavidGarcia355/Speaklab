"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CreditCard, LoaderCircle, TriangleAlert } from "lucide-react";
import SignInLink from "@/app/components/SignInLink";
import {
  billingStatusConfirmsAccess,
  deriveBillingPresentation,
  type BillingStatus,
  type CheckoutReturnState,
} from "@/lib/billing/presentation";

type ActionResponse = { url?: string; error?: string };
type StatusResponse = BillingStatus & { error?: string };

const BILLING_SUPPORT_URL =
  "mailto:davidsgarcia325@gmail.com?subject=TryHabla%20billing%20support";
const CONFIRMATION_POLL_INTERVAL_MS = 1_500;
const MAX_CONFIRMATION_POLLS = 10;

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
  if (status.runtimeAvailable) return "TryHabla Teacher billing";
  if (status.clientConfigured) return "Stripe controls limited";
  return "TryHabla AI access";
}

async function responseBody<T extends { error?: string }>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export function CheckoutAgreementNotice() {
  return (
    <p className="billing-availability-note">
      By choosing Teacher and continuing to Stripe, you agree to the{" "}
      <Link href="/terms">Terms of Use</Link> and acknowledge the{" "}
      <Link href="/privacy">Privacy Notice</Link>.
    </p>
  );
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
              ? "Sign in with your teacher account to view AI access and Stripe billing."
              : error}
          </p>
          {needsTeacherSignIn ? (
            <SignInLink className="btn btn-primary" callbackUrl="/billing">
              Sign in as a teacher
            </SignInLink>
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
  const hasAccess =
    presentation.subscribed ||
    status.access === "pilot" ||
    (status.usage.allowanceKind !== "subscription_unavailable" &&
      status.usage.remainingReviews > 0);
  const periodEnd = presentation.subscribed ? formatPeriodEnd(status.periodEnd) : "";
  const allowanceLabel =
    status.usage.allowanceKind === "teacher_period"
      ? "Teacher / current Stripe period"
      : status.usage.allowanceKind === "manual_lifetime"
        ? "Manual grant / lifetime"
        : status.usage.allowanceKind === "free_lifetime"
          ? "Free / lifetime"
          : "Billing verification required";
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

        <div className="billing-plan-terms" aria-label="TryHabla Teacher plan terms">
          <strong>Teacher</strong>
          <p>
            $20 per month includes 300 successful AI reviews in each Stripe billing period.
            Recordings can be up to five minutes. A review is used only when TryHabla delivers a
            usable AI result; failures, unable-to-grade results, and exact retries do not use
            another review. Unused reviews do not roll over, and there are no automatic overages.
            Reaching the limit pauses AI while recording, playback, and manual grading remain
            available. You can cancel through Manage billing, where Stripe shows the effective date
            before confirmation.
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
              {action === "checkout" ? "Opening checkout…" : "Choose Teacher - $20/month"}
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
          {presentation.showSupport ? (
            <a className="btn btn-ghost" href={BILLING_SUPPORT_URL}>
              Contact billing support
            </a>
          ) : null}
        </div>

        {presentation.showCheckout ? <CheckoutAgreementNotice /> : null}

        {presentation.availabilityNote ? (
          <p className="billing-availability-note">{presentation.availabilityNote}</p>
        ) : null}
      </div>

      <aside className="billing-usage-card" aria-label="Current AI review usage">
        <span>AI reviews remaining</span>
        <strong>{status.usage.remainingReviews.toLocaleString()}</strong>
        <small>
          {status.usage.allowanceKind === "subscription_unavailable"
            ? "Refresh billing or contact support before another AI review."
            : `of ${status.usage.limit.toLocaleString()} in your ${allowanceLabel.toLowerCase()} allowance`}
        </small>
        <dl>
          <div>
            <dt>Allowance</dt>
            <dd>{allowanceLabel}</dd>
          </div>
          <div>
            <dt>Successful reviews used</dt>
            <dd>{status.usage.consumedReviews.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Reviews in progress</dt>
            <dd>{status.usage.reservedReviews.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Automatic overages</dt>
            <dd>None</dd>
          </div>
        </dl>
        <p className="billing-usage-caveat">
          Need more AI reviews? Explore TryHabla for Schools.
        </p>
      </aside>
    </section>
  );
}

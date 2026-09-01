import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import BeltMark from "@/app/components/BeltMark";
import { verifyMarketingUnsubscribeToken } from "@/lib/marketing-unsubscribe";

export const metadata: Metadata = {
  title: "Email Preferences",
  robots: { index: false, follow: false },
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your email address";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function UnsubscribeShell({ children }: { children: ReactNode }) {
  return (
    <main className="unsubscribe-page">
      <section className="unsubscribe-card">
        <Link href="/" className="unsubscribe-brand" aria-label="TryHabla home">
          <BeltMark />
          <span>TryHabla</span>
        </Link>
        {children}
      </section>
    </main>
  );
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = first(params.status);

  if (status === "done") {
    return (
      <UnsubscribeShell>
        <p className="pill">Email preferences</p>
        <h1>You’re unsubscribed.</h1>
        <p>You won’t receive future TryHabla product and update emails.</p>
        <Link href="/" className="btn btn-ghost unsubscribe-home-link">
          Back to TryHabla
        </Link>
      </UnsubscribeShell>
    );
  }

  const email = first(params.email).trim().toLowerCase();
  const token = first(params.token);
  const valid = verifyMarketingUnsubscribeToken(email, token);

  return (
    <UnsubscribeShell>
      <p className="pill">Email preferences</p>
      {valid ? (
        <>
          <h1>Unsubscribe from TryHabla updates?</h1>
          <p>
            This will stop product and update emails to {maskEmail(email)}. Your TryHabla account
            and classroom data are not affected.
          </p>
          <form
            action={`/api/email/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`}
            method="post"
            className="unsubscribe-actions"
          >
            <input type="hidden" name="source" value="browser" />
            <button type="submit" className="btn btn-primary">
              Unsubscribe
            </button>
          </form>
          <Link href="/" className="student-text-link unsubscribe-keep-link">
            Keep me subscribed
          </Link>
        </>
      ) : (
        <>
          <h1>This unsubscribe link isn’t valid.</h1>
          <p>Please use the unsubscribe link from the most recent TryHabla update email.</p>
          <Link href="/" className="btn btn-ghost unsubscribe-home-link">
            Back to TryHabla
          </Link>
        </>
      )}
    </UnsubscribeShell>
  );
}

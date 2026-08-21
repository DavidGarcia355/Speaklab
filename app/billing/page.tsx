import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, AudioLines, ShieldCheck } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import BillingPanel from "@/app/billing/BillingPanel";

export const metadata: Metadata = {
  title: "AI Billing - Habla",
  description: "Activate or manage optional usage-based AI grading for your Habla teacher account.",
};

export default function BillingPage() {
  return (
    <main className="page-wrap billing-page">
      <BrandBar label="AI billing" />

      <section className="billing-hero">
        <div>
          <p className="pill">Optional AI</p>
          <h1>Keep the classroom free. Turn on AI when it helps.</h1>
          <p>
            Habla&apos;s audio classroom does not require a subscription. This page only manages
            metered AI grading for an individual teacher account.
          </p>
        </div>
        <div className="billing-hero-mark" aria-hidden="true">
          <AudioLines size={42} />
          <span>Core stays $0</span>
        </div>
      </section>

      <BillingPanel />

      <section className="billing-trust-row" aria-label="Billing safeguards">
        <ShieldCheck size={21} aria-hidden="true" />
        <p>
          Checkout and payment details are handled by Stripe. Habla stores billing identifiers and
          usage totals, never full card details.
        </p>
      </section>

      <Link className="billing-back-link" href="/pricing">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to pricing
      </Link>
    </main>
  );
}

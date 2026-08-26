import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, AudioLines, ShieldCheck } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import BillingPanel from "@/app/billing/BillingPanel";

export const metadata: Metadata = {
  title: "AI Billing",
  description: "Check Free and Teacher AI review access for your TryHabla teacher account.",
  robots: { index: false, follow: false },
};

export default function BillingPage() {
  return (
    <main className="page-wrap billing-page">
      <BrandBar label="AI billing" />

      <section className="billing-hero">
        <div>
          <p className="pill">Optional AI</p>
          <h1>Keep the classroom free. Choose Teacher when AI helps.</h1>
          <p>
            Free includes a lifetime allowance of 30 successful AI reviews per teacher account.
            Teacher is $20 per month for 300 successful reviews in each Stripe billing period, with
            no automatic overages.
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
          Voluntary PayPal support is completed on PayPal and does not activate AI. If this page
          explicitly offers Teacher through Stripe, Stripe handles checkout and card details. Habla
          stores only the identifiers and review counts needed to provide the selected option, never
          full card details. Existing Stripe customers can use Manage billing for invoices, payment
          methods, and cancellation, or email{" "}
          <a href="mailto:davidsgarcia325@gmail.com?subject=Habla%20billing%20support">
            davidsgarcia325@gmail.com
          </a>{" "}
          for billing support.
        </p>
      </section>

      <Link className="billing-back-link" href="/pricing">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to pricing
      </Link>
    </main>
  );
}

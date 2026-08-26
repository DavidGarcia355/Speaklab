import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, AudioLines, ShieldCheck } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import BillingPanel from "@/app/billing/BillingPanel";

export const metadata: Metadata = {
  title: "AI Billing",
  description: "Check the payment and access options available for optional Habla AI grading.",
  robots: { index: false, follow: false },
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
            Habla&apos;s audio classroom does not require a subscription. This page shows your AI access
            status and any self-service billing option currently available to your teacher account.
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
          explicitly offers Stripe self-service, Stripe handles checkout and card details. Habla
          stores only the identifiers and usage totals needed to provide the selected option, never
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

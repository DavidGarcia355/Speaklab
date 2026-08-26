import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  BrainCircuit,
  Building2,
  Check,
  Gauge,
  Ribbon,
} from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import PricingCalculator from "@/app/pricing/PricingCalculator";
import PayPalDonationButton from "@/app/pricing/PayPalDonationButton";
import { PAYPAL_DONATION_DISCLOSURE } from "@/app/constants";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "Pricing",
  description:
    "Start with TryHabla Free, add 300 AI-assisted recordings with Teacher, or contact TryHabla for Schools for larger needs.",
  path: "/pricing",
});

const FREE_FEATURES = [
  "30 AI-assisted recordings for the lifetime of your teacher account",
  "Classes, rosters, and speaking assignments",
  "Student audio recording and submissions",
  "Teacher playback, rubrics, grading, and feedback",
  "Roster tools and gradebook CSV export",
] as const;

const TEACHER_RULES = [
  "300 AI-assisted recordings in each Stripe billing period",
  "A clean transcript is included; AI grading is optional",
  "Transcribing and grading the same recording uses one unit total",
  "Recordings can be up to five minutes each",
  "Provider failures, unusable transcripts, and exact retries do not use another unit",
  "Unused units do not roll over",
  "No automatic overages; AI pauses at the limit while the free classroom stays available",
] as const;

export default function PricingPage() {
  return (
    <main className="page-wrap pricing-page">
      <BrandBar label="Pricing" />

      <section className="pricing-hero">
        <div className="pricing-hero-copy">
          <p className="pill">Clear classroom pricing</p>
          <h1>Start free. Add AI when it saves you time.</h1>
          <p>
            Free includes the complete audio classroom and a lifetime allowance of 30 AI-assisted
            recordings. Teacher is $20 per month for 300 per Stripe billing period, with transcripts
            included, grading optional, and no automatic overages.
          </p>
          <div className="actions hero-actions">
            <Link className="btn btn-primary" href="/teacher/register">
              Start free
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="btn btn-ghost" href="/billing">
              View Teacher billing
            </Link>
          </div>
        </div>
        <div className="pricing-hero-signal" aria-hidden="true">
          <span className="pricing-signal-orbit pricing-signal-orbit-one" />
          <span className="pricing-signal-orbit pricing-signal-orbit-two" />
          <AudioLines size={78} strokeWidth={1.7} />
          <strong>$0 to start</strong>
          <small>30 lifetime AI-assisted recordings</small>
        </div>
      </section>

      <section
        className="pricing-cause-band section-gap"
        aria-labelledby="pricing-cause-heading"
      >
        <div className="pricing-cause-icon" aria-hidden="true">
          <Ribbon
            className="cancer-ribbon-icon"
            data-awareness-ribbon="peach"
            size={34}
          />
        </div>
        <div>
          <p className="pill pill-subtle">A price with a purpose</p>
          <h2 id="pricing-cause-heading">Built for teachers. Built for my mom.</h2>
          <p>
            I build and maintain TryHabla myself. Revenue from Teacher helps me operate the service,
            keep the core classroom free, and support my family while my mom fights endometrial
            cancer.
          </p>
        </div>
        <Link className="btn btn-ghost" href="/about">
          Read my story
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>

      <section
        className="pricing-calculator-section section-gap"
        aria-labelledby="paypal-donation-heading"
      >
        <div className="pricing-section-heading">
          <div>
            <p className="pill pill-subtle">Optional donations</p>
            <h2 id="paypal-donation-heading">Donate to support my family</h2>
          </div>
          <p>{PAYPAL_DONATION_DISCLOSURE}</p>
        </div>
        <PayPalDonationButton />
      </section>

      <section className="pricing-value-grid section-gap" aria-labelledby="pricing-model-heading">
        <h2 id="pricing-model-heading" className="sr-only">
          TryHabla pricing options
        </h2>

        <article className="pricing-value-card pricing-value-core">
          <div className="pricing-value-icon" aria-hidden="true">
            <AudioLines size={25} />
          </div>
          <p className="pill pill-subtle">Free</p>
          <h2>The complete audio classroom, plus a lifetime AI allowance</h2>
          <p className="pricing-value-price">$0</p>
          <p className="pricing-value-cadence">no card required</p>
          <ul>
            {FREE_FEATURES.map((feature) => (
              <li key={feature}>
                <Check size={17} aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="pricing-value-card pricing-value-ai">
          <div className="pricing-value-icon" aria-hidden="true">
            <BrainCircuit size={25} />
          </div>
          <p className="pill pill-subtle">Teacher</p>
          <h2>Transcripts and optional AI feedback for regular classroom use</h2>
          <p className="pricing-value-price">$20</p>
          <p className="pricing-value-cadence">per month</p>
          <div className="pricing-rate-grid" aria-label="Teacher plan classroom capacity">
            <div>
              <strong>300</strong>
              <span>AI-assisted recordings per Stripe billing period</span>
            </div>
            <div>
              <strong>10</strong>
              <span>full assignments for one class of 30 students</span>
            </div>
            <div>
              <strong>2 each</strong>
              <span>full assignments across five classes of 30 students</span>
            </div>
          </div>
          <ul>
            {TEACHER_RULES.map((rule) => (
              <li key={rule}>
                <Check size={17} aria-hidden="true" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
          <Link className="btn btn-primary pricing-billing-cta" href="/billing">
            Choose Teacher
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <p className="pricing-note">
            Need more AI-assisted recordings? Explore TryHabla for Schools.
          </p>
        </article>
      </section>

      <section
        id="ai-calculator"
        className="pricing-calculator-section section-gap"
        aria-labelledby="ai-calculator-heading"
      >
        <div className="pricing-section-heading">
          <div>
            <p className="pill pill-subtle">
              <Gauge size={15} aria-hidden="true" />
              Classroom capacity
            </p>
            <h2 id="ai-calculator-heading">See which option fits your classes</h2>
          </div>
          <p>
            Estimate how many recordings your classes would transcribe or grade with AI. This is a
            planning tool, not a usage charge or invoice.
          </p>
        </div>
        <PricingCalculator />
      </section>

      <section className="pricing-principles section-gap" aria-labelledby="pricing-principles-heading">
        <div className="pricing-section-heading">
          <div>
            <p className="pill pill-subtle">Simple guardrails</p>
            <h2 id="pricing-principles-heading">No surprise AI bill</h2>
          </div>
        </div>
        <div className="pricing-principle-grid">
          <article>
            <strong>Core never locks</strong>
            <p>Reaching an AI limit pauses AI only. Recording, teaching, and manual grading remain available.</p>
          </article>
          <article>
            <strong>One recording, one unit</strong>
            <p>
              A delivered transcript uses one unit. Optional grading for that same recording and
              assignment is included; failures and exact retries do not use another unit. Copying
              or downloading a saved transcript is always free.
            </p>
          </article>
          <article>
            <strong>One known monthly price</strong>
            <p>
              Teacher is $20 per Stripe billing period. There are no automatic usage charges or
              overages.
            </p>
          </article>
        </div>
      </section>

      <section className="pricing-district-band section-gap">
        <div className="pricing-district-icon" aria-hidden="true">
          <Building2 size={28} />
        </div>
        <div>
          <p className="pill pill-subtle">TryHabla for Schools - Contact us</p>
          <h2>Larger and custom school needs.</h2>
          <p>
            Contact David to discuss teacher cohort size, expected AI recording volume, onboarding,
            privacy review, and custom terms. TryHabla for Schools is a contact-based option; it
            does not currently imply a school admin console or district approval.
          </p>
        </div>
        <Link className="btn btn-ghost" href="/feedback?intent=schools">
          Contact us
        </Link>
      </section>

      <p className="pricing-rollout-note">
        Prices are in USD. Free includes a lifetime allowance of 30 AI-assisted recordings per
        teacher account. Teacher includes 300 per Stripe billing period for $20 per month. A
        successful transcript uses one unit, and optional grading for that same recording and
        assignment is included. Unused units do not roll over, and there are no automatic overages.
        Stripe shows the final amount before payment. PayPal donations are separate from TryHabla
        product billing and do not buy access or AI-assisted recording units. Larger and custom
        school terms are scoped directly.
      </p>
    </main>
  );
}

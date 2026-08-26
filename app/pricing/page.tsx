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
import StripeSupportButton from "@/app/pricing/StripeSupportButton";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "Pricing",
  description:
    "Start with TryHabla Free, add 300 successful AI reviews with Teacher, or ask about a founder-managed School Pilot.",
  path: "/pricing",
});

const FREE_FEATURES = [
  "30 successful AI reviews for the lifetime of your teacher account",
  "Classes, rosters, and speaking assignments",
  "Student audio recording and submissions",
  "Teacher playback, rubrics, grading, and feedback",
  "Roster tools and gradebook CSV export",
] as const;

const TEACHER_RULES = [
  "300 successful AI reviews in each Stripe billing period",
  "Recordings can be up to five minutes each",
  "Failures, unable-to-grade results, and exact retries do not use another review",
  "Unused reviews do not roll over",
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
            Free includes the complete audio classroom and a lifetime allowance of 30 successful AI
            reviews. Teacher is $20 per month for 300 reviews per Stripe billing period, with no
            automatic overages.
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
          <small>30 lifetime AI reviews</small>
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
            I build and maintain Habla myself. Revenue from Teacher helps me operate the service,
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
        aria-labelledby="support-habla-heading"
      >
        <div className="pricing-section-heading">
          <div>
            <p className="pill pill-subtle">PayPal available now</p>
            <h2 id="support-habla-heading">Support Habla now</h2>
          </div>
          <p>
            PayPal is a voluntary way to support TryHabla and my family. It does not purchase or
            activate AI access, does not auto-renew, and is not tax-deductible. Teacher billing is
            handled separately through Stripe when it is offered on the signed-in billing page.
          </p>
        </div>
        <StripeSupportButton />
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
          <h2>The complete audio classroom, plus a real AI trial</h2>
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
          <h2>AI feedback for regular classroom use</h2>
          <p className="pricing-value-price">$20</p>
          <p className="pricing-value-cadence">per month</p>
          <div className="pricing-rate-grid" aria-label="Teacher plan classroom capacity">
            <div>
              <strong>300</strong>
              <span>successful AI reviews per Stripe billing period</span>
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
            Need more AI reviews? Ask your school about a TryHabla School Pilot.
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
            Estimate how many successful AI reviews your classes would use. This is a planning tool,
            not a usage charge or invoice.
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
            <strong>Only successful reviews count</strong>
            <p>Failures, unable-to-grade results, and exact retries do not use another review.</p>
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
          <p className="pill pill-subtle">School Pilot - Contact us</p>
          <h2>A founder-managed, manually provisioned teacher cohort.</h2>
          <p>
            David scopes each School Pilot directly with the school, including the teacher cohort,
            expected review volume, onboarding, privacy review, and pilot terms. School Pilot is not
            a self-service plan and does not imply a school admin console or district approval.
          </p>
        </div>
        <Link className="btn btn-ghost" href="/feedback">
          Contact us
        </Link>
      </section>

      <p className="pricing-rollout-note">
        Prices are in USD. Free includes a lifetime allowance of 30 successful AI reviews per
        teacher account. Teacher includes 300 reviews per Stripe billing period for $20 per month;
        unused reviews do not roll over, and there are no automatic overages. Stripe shows the final
        amount before payment. PayPal support does not buy AI access. School Pilot terms are scoped
        manually.
      </p>
    </main>
  );
}

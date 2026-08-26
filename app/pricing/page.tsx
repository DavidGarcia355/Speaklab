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
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

export const metadata = createPublicMetadata({
  title: "Pricing",
  description:
    "Habla's core audio classroom is free during the current teacher pilot. Preview published optional AI rates.",
  path: "/pricing",
});

const CORE_FEATURES = [
  "Classes, rosters, and speaking assignments",
  "Student audio recording and submissions",
  "Teacher playback, rubrics, grading, and feedback",
  "Roster tools and gradebook CSV export",
] as const;

const AI_RULES = [
  "If offered, the monthly allowance is one fewer AI grade than your first 30 qualifying active classes (29 maximum)",
  "Each distinct recording is a separate result; exact retries for the same assignment are deduplicated",
  "The published AI grade rate includes feedback",
  "Failed attempts and exact duplicate delivery are excluded from the estimate",
  "Each estimated allowance covers one whole result and does not roll over",
] as const;

export default function PricingPage() {
  return (
    <main className="page-wrap pricing-page">
      <BrandBar label="Pricing" />

      <section className="pricing-hero">
        <div className="pricing-hero-copy">
          <p className="pill">Free audio classroom</p>
          <h1>Use the core classroom free during the teacher pilot.</h1>
          <p>
            Classes, rosters, assignments, recordings, and teacher grading stay free. Optional AI,
            when a signed-in account is explicitly offered access, uses published usage-based rates.
          </p>
          <div className="actions hero-actions">
            <a className="btn btn-primary" href="#support-habla">
              Support Habla now
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link className="btn btn-ghost" href="/teacher/register">
              Request teacher access
            </Link>
          </div>
        </div>
        <div className="pricing-hero-signal" aria-hidden="true">
          <span className="pricing-signal-orbit pricing-signal-orbit-one" />
          <span className="pricing-signal-orbit pricing-signal-orbit-two" />
          <AudioLines size={78} strokeWidth={1.7} />
          <strong>$0 core</strong>
          <small>AI flexes with you</small>
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
          <h2 id="pricing-cause-heading">
            All proceeds from Habla go toward my mom&apos;s fight against endometrial cancer.
          </h2>
          <p>
            I build and maintain Habla myself. Choosing optional AI helps support my family while I
            keep the current core audio pilot free for teachers and students.
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
            PayPal is a voluntary way to support Try Habla and my family. It does not purchase or
            activate AI access, does not auto-renew, and is not tax-deductible. The signed-in billing
            page will explicitly say when a self-service AI payment option is available.
          </p>
        </div>
        <StripeSupportButton />
      </section>

      <section className="pricing-value-grid section-gap" aria-labelledby="pricing-model-heading">
        <h2 id="pricing-model-heading" className="sr-only">
          Habla pricing model
        </h2>

        <article className="pricing-value-card pricing-value-core">
          <div className="pricing-value-icon" aria-hidden="true">
            <AudioLines size={25} />
          </div>
          <p className="pill pill-subtle">Habla core</p>
          <h2>Core audio is free in the current pilot</h2>
          <p className="pricing-value-price">$0</p>
          <p className="pricing-value-cadence">no core subscription during the pilot</p>
          <ul>
            {CORE_FEATURES.map((feature) => (
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
          <p className="pill pill-subtle">Published AI rates</p>
          <h2>Preview the optional AI pricing model</h2>
          <div className="pricing-rate-grid" aria-label="Published AI rates">
            <div>
              <strong>{TEACHER_AI_PRICE_BOOK.baseSuccessfulGradeUsd * 100}¢</strong>
              <span>per successful grade</span>
            </div>
            <div>
              <strong>{TEACHER_AI_PRICE_BOOK.audioMinuteUsd * 100}¢</strong>
              <span>per audio minute</span>
            </div>
            <div>
              <strong>Included</strong>
              <span>AI feedback with every grade</span>
            </div>
          </div>
          <ul>
            {AI_RULES.map((rule) => (
              <li key={rule}>
                <Check size={17} aria-hidden="true" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
          <Link className="btn btn-primary pricing-billing-cta" href="/billing">
            View AI access options
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
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
              Live classroom estimate
            </p>
            <h2 id="ai-calculator-heading">Preview the published AI rates</h2>
          </div>
          <p>
            Use the controls for an illustrative monthly estimate. It does not activate AI or create
            a charge; access exists only when the signed-in billing page explicitly offers it.
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
            <strong>One delivered result in the estimate</strong>
            <p>The published model counts each successful, unique result and excludes failures or duplicates.</p>
          </article>
          <article>
            <strong>Clear estimate units</strong>
            <p>
              The published model rounds each result&apos;s audio up to the next whole second and
              includes feedback with a successful grade.
            </p>
          </article>
        </div>
      </section>

      <section className="pricing-district-band section-gap">
        <div className="pricing-district-icon" aria-hidden="true">
          <Building2 size={28} />
        </div>
        <div>
          <p className="pill pill-subtle">Schools and districts</p>
          <h2>District pricing is completely separate.</h2>
          <p>
            Districts use a private agreement built around pooled usage, security review, retention,
            support, and local purchasing requirements. The teacher calculator does not quote a
            district rollout or imply district approval.
          </p>
        </div>
        <Link className="btn btn-ghost" href="/feedback">
          Contact Habla
        </Link>
      </section>

      <p className="pricing-rollout-note">
        Rates are in USD and the calculator estimates what a teacher would pay Habla; it is not a quote
        or invoice. PayPal support does not buy AI access. Stripe self-service is available only when
        the signed-in billing page explicitly offers it. Habla does not add or collect tax through
        this plan in the current release. District terms remain separate.
      </p>
    </main>
  );
}

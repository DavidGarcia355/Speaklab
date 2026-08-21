import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, AudioLines, BrainCircuit, Building2, Check, Gauge } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import PricingCalculator from "@/app/pricing/PricingCalculator";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

export const metadata: Metadata = {
  title: "Pricing - Habla",
  description:
    "Habla's core audio classroom is free forever. Estimate optional, usage-based AI grading by classroom volume, audio duration, and feedback detail.",
};

const CORE_FEATURES = [
  "Classes, rosters, and speaking assignments",
  "Student audio recording and submissions",
  "Teacher playback, rubrics, grading, and feedback",
  "Roster tools and gradebook CSV export",
] as const;

const AI_RULES = [
  "One fewer monthly AI credit than your number of qualifying active classes",
  "Metered only after a successful, unique AI result",
  "No second charge for cache hits, failures, retries, or model escalation",
  "A free credit covers the whole result and never rolls over",
] as const;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

export default function PricingPage() {
  return (
    <main className="page-wrap pricing-page">
      <BrandBar label="Pricing" />

      <section className="pricing-hero">
        <div className="pricing-hero-copy">
          <p className="pill">Free audio classroom</p>
          <h1>Use Habla forever. Add AI only when it earns its keep.</h1>
          <p>
            Classes, rosters, assignments, recordings, and teacher grading stay free. Optional AI is
            usage-based, so a small classroom pays for small usage and a busy classroom can see its
            estimate before turning AI on.
          </p>
          <div className="actions hero-actions">
            <Link className="btn btn-primary" href="/teacher/register">
              Get teacher access
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a className="btn btn-ghost" href="#ai-calculator">
              Estimate AI usage
            </a>
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

      <section className="pricing-value-grid section-gap" aria-labelledby="pricing-model-heading">
        <h2 id="pricing-model-heading" className="sr-only">
          Habla pricing model
        </h2>

        <article className="pricing-value-card pricing-value-core">
          <div className="pricing-value-icon" aria-hidden="true">
            <AudioLines size={25} />
          </div>
          <p className="pill pill-subtle">Habla core</p>
          <h2>Audio learning stays free</h2>
          <p className="pricing-value-price">$0</p>
          <p className="pricing-value-cadence">forever — no subscription</p>
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
          <p className="pill pill-subtle">Optional AI</p>
          <h2>Pay for the AI work you run</h2>
          <p className="pricing-rate-version">
            Launch rate card {TEACHER_AI_PRICE_BOOK.id} · effective {TEACHER_AI_PRICE_BOOK.effectiveAt}
          </p>
          <div className="pricing-rate-grid" aria-label="AI launch rates">
            <div>
              <strong>{usd.format(TEACHER_AI_PRICE_BOOK.baseSuccessfulGradeUsd)}</strong>
              <span>per successful grade</span>
            </div>
            <div>
              <strong>{usd.format(TEACHER_AI_PRICE_BOOK.audioMinuteUsd)}</strong>
              <span>per audio minute</span>
            </div>
            <div>
              <strong>{usd.format(TEACHER_AI_PRICE_BOOK.outputThousandTokensUsd)}</strong>
              <span>per 1,000 feedback tokens</span>
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
            Set up AI billing
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
            <h2 id="ai-calculator-heading">Shape AI around the way you teach</h2>
          </div>
          <p>
            Change every major cost driver. The estimate assumes AI runs on every configured
            submission; using AI less often costs less.
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
            <strong>One result, one charge</strong>
            <p>Provider retries and internal quality checks never turn one teacher action into multiple charges.</p>
          </article>
          <article>
            <strong>Actual usage, clear units</strong>
            <p>Audio is measured to the second and feedback uses the final selected model output, not retry traffic.</p>
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
        Rates are in USD and the calculator is an estimate, not a quote or invoice. Teacher AI billing
        is opening in stages; sign in to check availability. Taxes may apply. District terms remain separate.
      </p>
    </main>
  );
}

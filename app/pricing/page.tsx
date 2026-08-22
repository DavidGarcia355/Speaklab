import type { Metadata } from "next";
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
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

export const metadata: Metadata = {
  title: "Pricing - Habla",
  description:
    "Habla's core audio classroom is free forever. Estimate optional AI grading from your classes, roster size, assignments, and recording length.",
};

const CORE_FEATURES = [
  "Classes, rosters, and speaking assignments",
  "Student audio recording and submissions",
  "Teacher playback, rubrics, grading, and feedback",
  "Roster tools and gradebook CSV export",
] as const;

const AI_RULES = [
  "One fewer monthly AI credit than your number of qualifying active classes",
  "Charged only after a successful, unique AI grade",
  "AI feedback is included with every successful grade",
  "No charge for failed attempts or duplicate delivery of the same result",
  "A free credit covers the whole result and never rolls over",
] as const;

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
            <a className="btn btn-primary" href="#support-habla">
              Support Habla now
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link className="btn btn-ghost" href="/teacher/register">
              Get teacher access
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
            keep the core audio classroom free for teachers and students.
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
            <p className="pill pill-subtle">Secure Stripe checkout</p>
            <h2 id="support-habla-heading">Support Habla now</h2>
          </div>
          <p>
            Choose your amount and pay securely through Stripe. Contributions support Habla and my
            family and are not tax-deductible.
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
          <h2>Simple pricing that fits your classroom</h2>
          <div className="pricing-rate-grid" aria-label="AI launch rates">
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
            <h2 id="ai-calculator-heading">See what you would pay before turning AI on</h2>
          </div>
          <p>
            Use the controls to estimate what you would pay Habla each month. The estimate assumes AI
            runs on every configured submission; using AI less often costs less.
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
            <strong>One delivered result, one charge</strong>
            <p>You pay once for each successful, unique result; never for failed attempts or duplicate delivery.</p>
          </article>
          <article>
            <strong>Actual usage, clear units</strong>
            <p>Audio is measured to the second, and feedback is included with every successful grade.</p>
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
        or invoice. Teacher AI billing is opening in stages; sign in to check availability. Taxes may
        apply. District terms remain separate.
      </p>
    </main>
  );
}

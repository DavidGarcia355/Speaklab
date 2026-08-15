import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "Pricing - Habla",
  description: "Current access information and district review notes for Habla.",
};

const PLAN_CARDS = [
  {
    label: "Current access",
    title: "Limited pilot access while Habla prepares for district review",
    price: "No self-serve checkout",
    detail: "2026-2027 access terms are under review",
    description:
      "Habla is being prepared for the 2026-2027 school year and for school-district vendor review. New teacher access may require approval while privacy, retention, and district documentation are finalized.",
    bullets: [
      "Core class, assignment, recording, grading, and CSV workflows remain the focus",
      "District privacy and security review materials are being prepared",
      "No public billing or self-serve subscription flow is currently available",
      "Access decisions should be confirmed before classroom rollout",
    ],
    className: "pricing-card-beta",
  },
  {
    label: "Individual teacher",
    title: "Individual teacher access",
    price: "Decision required",
    detail: "pricing is not finalized in the product",
    description:
      "Habla does not currently include a public checkout flow. Individual teacher pricing and availability should be treated as a business decision to confirm before broad 2026-2027 use.",
    bullets: [
      "Unlimited classes",
      "Unlimited assignments",
      "Audio submissions, grading, feedback, and CSV export",
    ],
    className: "pricing-card-teacher",
  },
  {
    label: "Department plan",
    title: "Department coverage for multiple teachers",
    price: "Contact us",
    detail: "for district or department review",
    description:
      "Districts and departments can request current security, privacy, retention, and subprocessor documentation before deciding whether Habla fits their requirements.",
    bullets: [
      "Preliminary vendor-review documentation",
      "Discussion of district-required DPA and security questionnaire needs",
      "No claim of district approval until review is complete",
    ],
    className: "pricing-card-school",
  },
] as const;

export default function PricingPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="Pricing" />

      <section className="hero">
        <p className="pill">Access status</p>
        <h1>Access information for the 2026-2027 school year</h1>
        <p>
          Habla is preparing for renewed classroom use and potential district vendor review. Public
          pricing, district terms, and broader rollout timing are not finalized in the app.
        </p>
        <div className="actions hero-actions">
          <Link className="btn btn-primary" href="/teacher/register">
            Create your teacher account
          </Link>
          <Link className="btn btn-ghost" href="/feedback">
            Contact us
          </Link>
        </div>
      </section>

      <section className="grid cols-3 section-gap pricing-grid">
        {PLAN_CARDS.map((plan) => (
          <article key={plan.title} className={`card pricing-card ${plan.className}`}>
            <p className="pill pill-subtle">{plan.label}</p>
            <h2 className="surface-title">{plan.title}</h2>
            <p className="pricing-price">{plan.price}</p>
            <p className="pricing-price-detail">{plan.detail}</p>
            <p className="meta">{plan.description}</p>
            <ul className="pricing-list">
              {plan.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            {plan.label === "Department plan" ? (
              <div className="actions pricing-actions">
                <Link className="btn btn-ghost" href="/feedback">
                  Contact us
                </Link>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="card section-gap pricing-note">
        <p className="pill pill-subtle">What happens next</p>
        <h2 className="surface-title">Start now, then decide later</h2>
        <p className="meta">
          Habla is staying intentionally simple. There is no checkout flow on this page. The goal right
          now is to give teachers and school technology teams an accurate view of current access while
          privacy, retention, and district-review materials are completed.
        </p>
        <div className="actions pricing-actions">
          <Link className="btn btn-primary" href="/teacher/register">
            Create your teacher account
          </Link>
          <Link className="btn btn-ghost" href="/">
            Back home
          </Link>
        </div>
      </section>
    </main>
  );
}

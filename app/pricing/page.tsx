import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "Pricing - Habla",
  description: "Beta access, individual teacher pricing, and department coverage for Habla.",
};

const PLAN_CARDS = [
  {
    label: "Beta",
    title: "Free for the rest of this school year while Habla is in beta",
    price: "$0",
    detail: "free through June 2026",
    description:
      "Create your account, use Habla with real students, and give honest feedback while the product is still taking shape. You'll be notified before anything changes in August.",
    bullets: [
      "Free for all active beta teachers through June 2026",
      "Full classroom use during beta",
      "Direct feedback helps shape what ships next",
      "No interruption mid-semester",
    ],
    className: "pricing-card-beta",
  },
  {
    label: "Individual teacher",
    title: "Simple pricing for one teacher",
    price: "$4.99/month",
    detail: "or $39.95/year",
    description:
      "This is the low-friction path for individual teachers once the beta spots are filled. It stays simple, affordable, and teacher-friendly.",
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
    detail: "for departments that want to cover access for teachers",
    description:
      "Habla starts teacher-first, but departments can reach out if they want school-covered access for multiple teachers.",
    bullets: [
      "A department-friendly path instead of teachers paying out of pocket",
      "Support for multiple teachers using Habla together",
      "Direct rollout conversation and priority support",
    ],
    className: "pricing-card-school",
  },
] as const;

export default function PricingPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="Pricing" />

      <section className="hero">
        <p className="pill">Simple pricing</p>
        <h1>Teacher-friendly pricing while Habla is still in beta</h1>
        <p>
          Habla is free for all active beta teachers. After beta, individual teachers can use Habla for
          $4.99/month or $39.95/year, and departments can contact us about covering access for multiple teachers.
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
          Habla is staying intentionally simple. There is no checkout flow on this page yet. The goal right
          now is to help teachers understand the beta offer, the upcoming $4.99/month individual-teacher
          plan, and the department contact path.
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

import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "Pricing - Habla",
  description: "Beta access, teacher pricing, and upcoming school pricing for Habla.",
};

const PLAN_CARDS = [
  {
    label: "Beta",
    title: "First 20 world language teachers get Habla free forever",
    price: "$0",
    detail: "during beta, then free forever",
    description:
      "Create your account, use Habla with real students, and give honest feedback while the product is still taking shape.",
    bullets: [
      "Free forever for the first 20 teacher accounts",
      "Full classroom use during beta",
      "Direct feedback helps shape what ships next",
    ],
    className: "pricing-card-beta",
  },
  {
    label: "Teacher plan",
    title: "Simple pricing for one teacher",
    price: "$9/month",
    detail: "or $89/year",
    description:
      "This is the core Habla plan once the beta spots are filled. It stays low-friction and teacher-friendly.",
    bullets: [
      "Unlimited classes",
      "Unlimited assignments",
      "Audio submissions, grading, feedback, and CSV export",
    ],
    className: "pricing-card-teacher",
  },
  {
    label: "School plan",
    title: "Coming soon for schools",
    price: "Coming soon",
    detail: "contact us if your school is interested early",
    description:
      "Habla will start teacher-first. If a department or school wants to talk earlier, we can have that conversation now.",
    bullets: [
      "Multi-teacher access",
      "Admin visibility",
      "Priority support",
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
        <h1>Teacher-first pricing while Habla is still in beta</h1>
        <p>
          Start with the beta offer if you are one of the first 20 world language teachers. After that,
          Habla moves to a simple teacher plan with school pricing coming later.
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
            {plan.label === "School plan" ? (
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
          now is to help teachers understand the beta offer, the upcoming $9/month teacher plan, and the
          fact that school pricing is not the focus yet.
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

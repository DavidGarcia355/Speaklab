import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "Pricing - Habla",
  description: "Free launch-beta teacher access and district review notes for Habla.",
};

const PLAN_CARDS = [
  {
    label: "Launch beta",
    title: "Teacher accounts are free during the launch beta",
    price: "$0 today",
    detail: "No payment method or checkout required",
    description:
      "Any teacher can create an account now and use Habla's core classroom workflow. Future pricing is not finalized, and teachers will receive notice before access terms change.",
    bullets: [
      "Classes, assignments, audio submissions, grading, feedback, and CSV export",
      "No checkout or payment method during the launch beta",
      "Advance notice before future access terms change",
      "District privacy and security review materials are being prepared",
    ],
    className: "pricing-card-beta",
  },
  {
    label: "After the beta",
    title: "Individual teacher pricing",
    price: "Not finalized",
    detail: "Launch-beta access remains free",
    description:
      "Habla does not currently charge teachers. Future individual pricing and timing will be decided after the beta based on classroom use and support needs.",
    bullets: [
      "Unlimited classes",
      "Unlimited assignments",
      "Audio submissions, grading, feedback, and CSV export",
      "Notice before any future paid plan begins",
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
        <p className="pill">Launch beta</p>
        <h1>Free teacher access during the launch beta</h1>
        <p>
          Create a teacher account without a payment method or checkout. Future pricing is not
          finalized, and district-wide rollout still requires each district&apos;s own review.
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
        <h2 className="surface-title">Start free, then decide later</h2>
        <p className="meta">
          Habla is staying intentionally simple during the launch beta. Teachers can start without a
          checkout or payment method. Future pricing will be communicated before access terms change,
          while privacy, retention, and district-review materials continue to mature.
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

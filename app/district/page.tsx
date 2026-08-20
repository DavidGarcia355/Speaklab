import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BrainCircuit, ClipboardCheck, FileCheck2, LockKeyhole, School } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "Districts - Habla",
  description: "District review and demo information for Habla.",
};

const reviewItems = [
  {
    icon: LockKeyhole,
    title: "Privacy review",
    description: "Review student data handling, retention, subprocessors, and security posture before rollout.",
  },
  {
    icon: ClipboardCheck,
    title: "Pilot planning",
    description: "Start with a small group of teachers, confirm classroom fit, then decide on wider access.",
  },
  {
    icon: FileCheck2,
    title: "Documentation",
    description: "Request the current data inventory, subprocessor list, retention notes, and draft review materials.",
  },
  {
    icon: BrainCircuit,
    title: "AI controls",
    description: "Review provider use, teacher approval, rate limits, and data handling before AI touches student work.",
  },
] as const;

export default function DistrictPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="Districts" />

      <section className="audience-hero audience-hero-district">
        <p className="pill">District pathway</p>
        <h1>Evaluate Habla before it reaches every classroom.</h1>
        <p>
          Habla gives language programs one place for speaking assignments, audio submissions, grading,
          feedback, and CSV exports. District teams can begin with a controlled teacher pilot while
          privacy, storage, network, and vendor requirements are reviewed.
        </p>
        <div className="actions hero-actions">
          <Link className="btn btn-primary" href="/feedback">
            Request a pilot
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link className="btn btn-ghost" href="/pricing">
            View access notes
          </Link>
        </div>
      </section>

      <section className="grid cols-2 section-gap audience-card-grid">
        {reviewItems.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="card audience-info-card">
              <Icon size={22} aria-hidden="true" />
              <h2>{item.title}</h2>
              <p className="meta">{item.description}</p>
            </article>
          );
        })}
      </section>

      <section className="audience-band section-gap">
        <School size={24} aria-hidden="true" />
        <div>
          <h2>Built for school reality, not just a pretty demo.</h2>
          <p className="meta">
            Broad rollout should happen only after the deployment&apos;s private audio storage, data terms,
            network access, teacher onboarding, and support expectations are verified.
          </p>
        </div>
      </section>
    </main>
  );
}

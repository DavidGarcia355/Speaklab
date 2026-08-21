import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  Download,
  Mic2,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";

export const metadata: Metadata = {
  title: "Teachers - Habla",
  description: "Teacher benefits and classroom workflow for Habla.",
};

const teacherBenefits = [
  {
    icon: TimerReset,
    title: "Set up fast",
    description: "Create a class, write a speaking prompt, and share one student link.",
  },
  {
    icon: Mic2,
    title: "No app installs",
    description: "Students record directly in the browser from laptops, Chromebooks, phones, or tablets.",
  },
  {
    icon: BookOpenCheck,
    title: "Grade in one place",
    description: "Listen to submissions, enter scores, and keep feedback attached to each recording.",
  },
  {
    icon: BrainCircuit,
    title: "Grade with AI",
    description: "When enabled, save rubric-aligned scores and feedback automatically, then review or edit every result.",
  },
  {
    icon: Download,
    title: "Export cleanly",
    description: "Download grade data as CSV when it is time to move scores into your gradebook.",
  },
  {
    icon: ShieldCheck,
    title: "Guardrails by design",
    description: "AI access, daily budgets, cooldowns, and teacher approval keep experimentation inside visible limits.",
  },
] as const;

export default function TeachersPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="Teachers" />

      <section className="audience-hero audience-hero-teacher">
        <p className="pill">Teacher pathway</p>
        <h1>More student speaking. Less grading drag.</h1>
        <p>
          Habla helps language teachers assign prompts, collect recordings, grade responses, and keep
          every class organized. Optional AI can save rubric-aligned scores and feedback automatically,
          while the teacher can review and edit every result.
        </p>
        <div className="actions hero-actions">
          <Link className="btn btn-primary" href="/teacher/register">
            Try it with your class
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <GoogleSignInLink className="btn btn-ghost" callbackUrl="/teacher">
            Log in
          </GoogleSignInLink>
        </div>
      </section>

      <section className="grid section-gap audience-card-grid teacher-benefit-grid">
        {teacherBenefits.map((benefit) => {
          const Icon = benefit.icon;
          return (
            <article key={benefit.title} className="card audience-info-card">
              <Icon size={22} aria-hidden="true" />
              <h2>{benefit.title}</h2>
              <p className="meta">{benefit.description}</p>
            </article>
          );
        })}
      </section>

      <section className="audience-band section-gap">
        <div>
          <h2>585 recordings across 141 classes and counting.</h2>
          <p className="meta">
            Habla is already supporting real classroom activity. Start with one class, learn what saves
            time, and expand only when the workflow earns it.
          </p>
        </div>
        <GoogleSignInLink className="btn btn-primary" callbackUrl="/teacher">
          Open teacher dashboard
          <ArrowRight size={17} aria-hidden="true" />
        </GoogleSignInLink>
      </section>
    </main>
  );
}

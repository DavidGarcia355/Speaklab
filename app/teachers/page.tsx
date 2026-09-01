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
import AudienceHero from "@/app/components/AudienceHero";
import SignInLink from "@/app/components/SignInLink";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "For Teachers",
  description: "Teacher benefits and classroom workflow for TryHabla.",
  path: "/teachers",
});

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
    title: "Transcribe or grade with AI",
    description: "Generate a transcript to copy or download, then optionally add rubric-aligned scoring and editable feedback.",
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

      <AudienceHero
        tone="teacher"
        eyebrow="Teacher pathway"
        title="More student speaking. Less grading drag."
        description="TryHabla helps language teachers assign prompts, collect recordings, grade responses, and keep every class organized. Optional AI can generate a transcript without grading, or add rubric-aligned scores and feedback that the teacher can review and edit."
        artSrc="/mascot/hablaman-teacher-guide-v1.png"
        sticker="Assign / listen / coach"
        index="01"
        actions={
          <>
            <Link className="btn btn-primary" href="/teacher/register">
              Start free
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <SignInLink className="btn btn-ghost" callbackUrl="/teacher">
              Log in
            </SignInLink>
          </>
        }
      />

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
          <h2>Speaking practice already moving through real classrooms.</h2>
          <p className="meta">
            TryHabla is already supporting real classroom activity. Start with one class, learn what saves
            time, and expand only when the workflow earns it.
          </p>
        </div>
        <SignInLink className="btn btn-primary" callbackUrl="/teacher">
          Open teacher dashboard
          <ArrowRight size={17} aria-hidden="true" />
        </SignInLink>
      </section>
    </main>
  );
}

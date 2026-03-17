import type { Metadata } from "next";
import Link from "next/link";
import { Clock3, FileSpreadsheet, MicVocal, ShieldCheck } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import { APP_NAME, CONTACT_LINKS } from "@/app/constants";

export const metadata: Metadata = {
  title: "Habla",
  description: "Speaking assignments, simplified. Record, submit, grade — no downloads required.",
};

export default function Home() {
  return (
    <main className="page-wrap">
      <BrandBar label="For Language Teachers" />

      <section className="hero home-hero">
        <div className="hero-copy">
          <p className="pill">Speaking assignments, simplified</p>
          <h1>Record, submit, grade — no downloads required.</h1>
          <p>
            Build a class, share one student link, and move through speaking assessments
            with a workflow designed for real classrooms.
          </p>
          <div className="actions hero-actions">
            <Link className="btn btn-primary" href="/api/auth/signin/google?callbackUrl=/teacher">
              Sign in with Google
            </Link>
            <Link className="btn btn-ghost" href="/teacher">
              Open Teacher Studio
            </Link>
            <Link className="btn btn-ghost" href="/faq">
              FAQ
            </Link>
            <Link className="btn btn-ghost" href="/feedback">
              Send feedback
            </Link>
            <Link className="text-link" href="/teacher/class/new">
              Create first class
            </Link>
          </div>
        </div>
      </section>

      <section className="grid cols-2 section-gap">
        <article className="card home-feature">
          <h2 className="title-row">
            <span className="mini-icon" aria-hidden="true">
              <Clock3 size={13} />
            </span>
            Create and share quickly
          </h2>
          <p className="meta">
            Set up a class, write a prompt, and share one student link before class starts.
          </p>
        </article>
        <article className="card home-feature">
          <h2 className="title-row">
            <span className="mini-icon" aria-hidden="true">
              <MicVocal size={13} />
            </span>
            Collect recordings in-browser
          </h2>
          <p className="meta">
            Students sign in, record, and submit audio without extra apps or downloads.
          </p>
        </article>
        <article className="card home-feature">
          <h2 className="title-row">
            <span className="mini-icon" aria-hidden="true">
              <ShieldCheck size={13} />
            </span>
            Review and grade in one place
          </h2>
          <p className="meta">
            Listen back, score submissions, add feedback, and keep grading organized.
          </p>
        </article>
        <article className="card home-feature">
          <h2 className="title-row">
            <span className="mini-icon" aria-hidden="true">
              <FileSpreadsheet size={13} />
            </span>
            Gradebook ready
          </h2>
          <p className="meta">
            Export clean CSV data that is easy to move into school grading systems.
          </p>
        </article>
      </section>

      <section className="grid cols-2 section-gap">
        <article className="card home-feature">
          <h2 className="title-row">Pilot FAQ</h2>
          <p className="meta"><strong>Who is this for?</strong> Language teachers running speaking checks in class.</p>
          <p className="meta"><strong>How do students submit?</strong> Open one link, sign in, record, submit.</p>
          <p className="meta"><strong>How are grades exported?</strong> CSV export is available in the teacher class workspace.</p>
          <p className="meta"><strong>Can I test before rollout?</strong> Yes, sign in and create your first class.</p>
        </article>

        <article className="card home-feature">
          <h2 className="title-row">Get Started</h2>
          <p className="meta">Trying {APP_NAME} with your class? Sign in to open your teacher workspace, or contact us if you want help getting set up.</p>
          <div className="actions">
            <Link className="btn btn-primary" href="/api/auth/signin/google?callbackUrl=/teacher">
              Sign in with Google
            </Link>
            <Link className="btn btn-ghost" href="/faq">
              FAQ page
            </Link>
            <Link className="btn btn-ghost" href="/feedback">
              Contact us
            </Link>
            <a className="btn btn-ghost" href={CONTACT_LINKS.linkedin} target="_blank" rel="noreferrer">
              LinkedIn
            </a>
            <a className="btn btn-ghost" href={CONTACT_LINKS.email}>
              Email
            </a>
            <a className="btn btn-ghost" href={CONTACT_LINKS.github} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a className="btn btn-ghost" href={CONTACT_LINKS.phone}>
              Phone
            </a>
          </div>
        </article>
      </section>
    </main>
  );
}

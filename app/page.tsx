import Link from "next/link";
import { Clock3, FileSpreadsheet, MicVocal, ShieldCheck } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import { APP_NAME, CONTACT_LINKS } from "@/app/constants";

export default function Home() {
  return (
    <main className="page-wrap">
      <BrandBar label="Teacher Pilot" />

      <section className="hero home-hero">
        <div className="hero-copy">
          <p className="pill">Speaking assignments made practical</p>
          <h1>Run speaking checks faster with less classroom overhead.</h1>
          <p>
            Build a class, share one student link, and move through grading with a
            clean, reliable workflow designed for real periods.
          </p>
          <div className="actions hero-actions">
            <Link className="btn btn-primary" href="/teacher">
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
            Setup speed
          </h2>
          <p className="meta">
            Teachers can launch a speaking check quickly before class begins.
          </p>
        </article>
        <article className="card home-feature">
          <h2 className="title-row">
            <span className="mini-icon" aria-hidden="true">
              <MicVocal size={13} />
            </span>
            Submission reliability
          </h2>
          <p className="meta">
            Clear recording states reduce confusion for everyday students.
          </p>
        </article>
        <article className="card home-feature">
          <h2 className="title-row">
            <span className="mini-icon" aria-hidden="true">
              <ShieldCheck size={13} />
            </span>
            Grading confidence
          </h2>
          <p className="meta">
            Review audio, score quickly, and export gradebook CSV for PowerSchool.
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
          <p className="meta"><strong>Can I test before rollout?</strong> Yes, request pilot access below.</p>
        </article>

        <article className="card home-feature">
          <h2 className="title-row">Request Pilot Access</h2>
          <p className="meta">Trying {APP_NAME} with your class? Contact us and we&apos;ll help you get set up.</p>
          <div className="actions">
            <Link className="btn btn-primary" href="/feedback">
              Feedback form
            </Link>
            <Link className="btn btn-ghost" href="/faq">
              FAQ page
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

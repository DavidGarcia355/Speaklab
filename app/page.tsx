import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import SchoolNetworkNotice from "@/app/components/SchoolNetworkNotice";
import { APP_NAME } from "@/app/constants";

export const metadata: Metadata = {
  title: "Habla",
  description: "Create a class, share one link, and collect speaking assignments - all in one place.",
};

const featureCards = [
  {
    title: "Set up a class in under 60 seconds",
    description:
      "Create a class, write a prompt, and share one student link before class starts.",
  },
  {
    title: "Students record instantly - no apps, no downloads",
    description:
      "Students open a link, sign in, record, and submit audio directly in the browser.",
  },
  {
    title: "Listen, grade, and give feedback - fast",
    description:
      "Review submissions, score responses, and keep grading organized in one place.",
  },
  {
    title: "Export grades in one click",
    description:
      "Download clean CSV data that moves easily into school grading systems.",
  },
] as const;

const quickQuestions = [
  {
    question: "Do students need an account?",
    answer: "Students sign in with their school account before they submit, so you know whose recording you are hearing.",
  },
  {
    question: "What devices does it work on?",
    answer: "It works in modern browsers on laptops, Chromebooks, and most phones or tablets with a microphone.",
  },
  {
    question: "How do I get grades into my gradebook?",
    answer: "Each class has a CSV export so you can move scores into the system your school already uses.",
  },
  {
    question: "Is it really free?",
    answer: "Yes. Habla is free to use right now, and you can start with your first class today.",
  },
] as const;

export default function Home() {
  return (
    <main className="page-wrap">
      <BrandBar label="Habla - speaking made simple" />

      <section className="hero home-hero">
        <div className="home-hero-top">
          <p className="pill">For language teachers and students</p>
          <h1>Speaking assignments, finally simple.</h1>
          <p className="home-hero-lead">
            Create a class, share one link, and collect speaking assignments - all in one place.
          </p>
        </div>

        <div className="home-entry-paths">
          <div className="home-entry-card home-entry-teacher">
            <div className="home-entry-icon">T</div>
            <h2 className="home-entry-title">I&apos;m a teacher</h2>
            <p className="meta">Create classes, assign speaking prompts, and grade recordings.</p>
            <Link className="btn btn-primary home-entry-btn" href="/api/auth/signin?callbackUrl=/teacher">
              Sign in as teacher
            </Link>
            <Link className="home-entry-secondary" href="/teacher/register">
              New here? Set up your account
            </Link>
          </div>

          <div className="home-entry-card home-entry-student">
            <div className="home-entry-icon home-entry-icon-student">S</div>
            <h2 className="home-entry-title">I&apos;m a student</h2>
            <p className="meta">View your submitted recordings, grades, and teacher feedback.</p>
            <Link className="btn btn-ghost home-entry-btn" href="/api/auth/signin?callbackUrl=/student">
              Sign in as student
            </Link>
            <p className="home-entry-hint">Your teacher will share an assignment link with you.</p>
          </div>
        </div>

        <SchoolNetworkNotice
          className="home-network-notice"
          message="On a school network? Open this page on your phone, or ask your IT department to allowlist tryhabla.com"
          storageKey="habla-school-network-home-notice"
        />
      </section>

      <section className="card home-beta-banner section-gap">
        <div className="home-beta-copy">
          <p className="pill pill-subtle">Habla beta</p>
          <h2>First 20 world language teachers get Habla free forever</h2>
          <p className="meta">
            Create an account, try Habla with your students, and give honest feedback. Once those first
            20 teacher spots are filled, Habla will move to paid tiers.
          </p>
        </div>
        <div className="actions home-beta-actions">
          <Link className="btn btn-primary" href="/teacher/register">
            Claim a beta spot
          </Link>
          <Link className="btn btn-ghost" href="/feedback">
            Share feedback
          </Link>
        </div>
      </section>

      <section className="grid cols-2 section-gap home-feature-grid">
        {featureCards.map((feature) => (
          <article key={feature.title} className="card home-feature-card">
            <h2>{feature.title}</h2>
            <p className="meta">{feature.description}</p>
          </article>
        ))}
      </section>

      <section id="product-preview" className="section-gap home-section">
        <div className="home-section-head">
          <p className="pill pill-subtle">Product preview</p>
          <h2>A speaking workflow teachers can understand at a glance</h2>
          <p className="meta home-section-copy">
            Habla keeps the whole process in one place, so teachers spend less time managing links and
            more time listening to student language.
          </p>
        </div>

        <div className="card home-preview-shell">
          <div className="home-preview-browser">
            <span />
            <span />
            <span />
          </div>
          <div className="home-preview-grid">
            <aside className="home-preview-sidebar">
              <p className="home-panel-label">My classes</p>
              <div className="home-preview-class is-active">
                <strong>Spanish 3</strong>
                <span>2 assignments</span>
              </div>
              <div className="home-preview-class">
                <strong>AP Spanish</strong>
                <span>Oral practice</span>
              </div>
              <div className="home-preview-class">
                <strong>Spanish 1</strong>
                <span>Quick checks</span>
              </div>
            </aside>

            <div className="home-preview-main">
              <div className="home-preview-top">
                <div>
                  <p className="home-panel-label">Assignment</p>
                  <h3>Describe your weekend plans</h3>
                </div>
                <span className="pill">Student link ready</span>
              </div>

              <div className="home-preview-panels">
                <div className="home-preview-card">
                  <p className="home-panel-label">Student flow</p>
                  <ul className="home-preview-list">
                    <li>Open one link</li>
                    <li>Record in the browser</li>
                    <li>Submit in seconds</li>
                  </ul>
                </div>
                <div className="home-preview-card">
                  <p className="home-panel-label">Teacher grading</p>
                  <div className="home-preview-grade">
                    <strong>Lucia M.</strong>
                    <span>Score: 92/100</span>
                  </div>
                  <div className="home-preview-audio" aria-hidden="true">
                    <div className="home-preview-play" />
                    <div className="home-preview-wave" />
                  </div>
                  <p className="meta">Feedback: Strong detail, good pacing, clear pronunciation.</p>
                </div>
              </div>

              <div className="home-preview-footer">
                <span className="home-preview-badge">CSV export ready</span>
                <span className="home-preview-badge">No downloads required</span>
                <span className="home-preview-badge">Organized by class</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-gap home-section">
        <article className="card home-story">
          <p className="pill pill-subtle">Why {APP_NAME} exists</p>
          <p className="home-story-copy">
            {APP_NAME} was built to make speaking practice feel manageable again for language teachers.
            Instead of stitching together forms, recordings, and gradebook notes, teachers get one focused
            workflow that does the job cleanly. It is free right now, easy to start, and designed for real
            classroom use.
          </p>
        </article>
      </section>

      <section className="section-gap home-section">
        <div className="home-section-head">
          <p className="pill pill-subtle">Quick questions</p>
          <h2>What teachers usually ask before they try it</h2>
        </div>
        <div className="grid cols-2 home-faq-grid">
          {quickQuestions.map((item) => (
            <article key={item.question} className="card home-faq-item">
              <h3>{item.question}</h3>
              <p className="meta">{item.answer}</p>
            </article>
          ))}
        </div>
        <div className="actions home-links">
          <Link className="btn btn-ghost" href="/faq">
            More answers in the FAQ
          </Link>
          <Link className="btn btn-ghost" href="/feedback">
            Contact us
          </Link>
        </div>
      </section>

      <section className="card home-cta section-gap">
        <div>
          <p className="home-cta-copy">Built for language teachers. Free to use.</p>
          <p className="meta">Start today, run your first speaking assignment, and keep the workflow simple.</p>
        </div>
        <div className="actions home-cta-actions">
          <Link className="btn btn-primary" href="/api/auth/signin?callbackUrl=/teacher">
            Sign in as teacher
          </Link>
          <Link className="btn btn-ghost" href="/feedback">
            Request help
          </Link>
        </div>
      </section>
    </main>
  );
}

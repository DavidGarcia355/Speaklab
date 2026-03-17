import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import { APP_NAME } from "@/app/constants";

export const metadata: Metadata = {
  title: "Habla",
  description: "Speaking assignments, simplified. Record, submit, grade - no downloads required.",
};

export default function Home() {
  return (
    <main className="page-wrap">
      <BrandBar label="For Language Teachers" />

      <section className="hero home-hero">
        <div className="home-hero-copy">
          <p className="pill">Built for speaking practice</p>
          <h1>Speaking assignments for language teachers, without the classroom chaos.</h1>
          <p className="home-hero-lead">
            Create a prompt, share one link, and let students record right in the browser. You listen
            back, grade, and move on. No downloads. No extra apps. No setup drama.
          </p>
          <div className="actions hero-actions">
            <Link className="btn btn-primary" href="/api/auth/signin/google?callbackUrl=/teacher">
              Start for free - sign in with Google
            </Link>
            <Link className="text-link" href="/faq">
              How does it work?
            </Link>
          </div>
        </div>
      </section>

      <section className="section-gap home-section">
        <div className="home-section-head">
          <p className="pill pill-subtle">How it works</p>
          <h2>Record. Submit. Grade. That&apos;s it.</h2>
        </div>
        <div className="grid cols-3 home-steps">
          <article className="card home-step">
            <div className="home-step-number">1</div>
            <h3>Create</h3>
            <p className="meta">
              Set up a class, write a speaking prompt, and generate a student link in a minute or two.
            </p>
          </article>
          <article className="card home-step">
            <div className="home-step-number">2</div>
            <h3>Submit</h3>
            <p className="meta">
              Students open the link, record in the browser, and turn in their response without
              downloading anything.
            </p>
          </article>
          <article className="card home-step">
            <div className="home-step-number">3</div>
            <h3>Grade</h3>
            <p className="meta">
              Listen back, add a score and feedback, then export a clean CSV for your gradebook.
            </p>
          </article>
        </div>
      </section>

      <section className="section-gap home-section">
        <article className="card home-story">
          <p className="pill pill-subtle">Why {APP_NAME} exists</p>
          <p className="home-story-copy">
            {APP_NAME} was built for language teachers who are tired of making speaking practice fit
            into tools that were never designed for it. It&apos;s a focused, teacher-first workflow made
            to help you hear more student language with less tech friction. It&apos;s free right now, and
            you can start using it today.
          </p>
        </article>
      </section>

      <section className="section-gap home-section">
        <div className="home-section-head">
          <p className="pill pill-subtle">Quick questions</p>
          <h2>What teachers usually want to know first</h2>
        </div>
        <div className="grid cols-2 home-faq-grid">
          <article className="card home-faq-item">
            <h3>Do students need an account?</h3>
            <p className="meta">
              Students sign in with Google before they submit, so you know whose recording you&apos;re
              hearing.
            </p>
          </article>
          <article className="card home-faq-item">
            <h3>What devices does it work on?</h3>
            <p className="meta">
              It works in modern browsers on laptops, Chromebooks, and most phones or tablets with a
              microphone.
            </p>
          </article>
          <article className="card home-faq-item">
            <h3>How do I get grades into my gradebook?</h3>
            <p className="meta">
              Each class has a CSV export so you can move scores into the system your school already
              uses.
            </p>
          </article>
          <article className="card home-faq-item">
            <h3>Is it really free?</h3>
            <p className="meta">
              Yes. It&apos;s free to use right now, and you can create your first class as soon as you
              sign in.
            </p>
          </article>
        </div>
        <div className="actions home-links">
          <Link className="text-link" href="/faq">
            More answers in the FAQ
          </Link>
          <Link className="text-link" href="/feedback">
            Questions? Contact us
          </Link>
        </div>
      </section>

      <section className="card home-cta section-gap">
        <p className="home-cta-copy">Built for language teachers. Free to use.</p>
        <Link className="btn btn-primary" href="/api/auth/signin/google?callbackUrl=/teacher">
          Start for free - sign in with Google
        </Link>
      </section>
    </main>
  );
}

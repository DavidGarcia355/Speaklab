import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  BookOpenCheck,
  ChartNoAxesCombined,
  Download,
  GraduationCap,
  Languages,
  Mic2,
  Sparkles,
  Volume2,
} from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";
import SchoolNetworkNotice from "@/app/components/SchoolNetworkNotice";
import ExternalBrowserNotice from "@/app/components/ExternalBrowserNotice";
import { APP_NAME } from "@/app/constants";

export const metadata: Metadata = {
  title: "Habla",
  description: "Create a class, share one link, and collect speaking assignments - all in one place.",
};

const featureCards = [
  {
    icon: BookOpenCheck,
    title: "Set up a class in under 60 seconds",
    description:
      "Create a class, write a prompt, and share one student link before class starts.",
  },
  {
    icon: Mic2,
    title: "Students record instantly - no apps, no downloads",
    description:
      "Students open a link, sign in, record, and submit audio directly in the browser.",
  },
  {
    icon: AudioLines,
    title: "Listen, grade, and give feedback - fast",
    description:
      "Review submissions, score responses, and keep grading organized in one place.",
  },
  {
    icon: Download,
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
    answer:
      "Habla does not currently have a public checkout flow. Access terms for the 2026-2027 school year are being reviewed, especially for schools that require vendor privacy or DPA review.",
  },
] as const;

export default function Home() {
  return (
    <main className="page-wrap">
      <BrandBar label="Habla - speaking made simple" />
      <ExternalBrowserNotice className="home-external-browser-notice" />

      <section className="home-hero">
        <div className="home-hero-layout">
          <div className="home-hero-copy">
            <p className="pill home-hero-eyebrow">
              <Sparkles size={15} aria-hidden="true" />
              Built for every language classroom
            </p>
            <h1>Speaking practice made simple.</h1>
            <p className="home-hero-lead">
              Create a class, share one link, and collect speaking assignments in a space that feels
              welcoming to every voice.
            </p>
            <div className="actions home-hero-actions">
              <Link className="btn btn-primary" href="/teacher/register">
                Start teaching
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link className="btn btn-ghost" href="#choose-your-path">
                Choose your path
              </Link>
            </div>
            <div className="home-language-strip" aria-label="Built for multilingual learning">
              <span>Hola</span>
              <span>Bonjour</span>
              <span>Hallo</span>
              <span>Ciao</span>
              <span>Oi</span>
            </div>
          </div>

          <div className="home-mascot-stage" aria-label="Habla multilingual speaking mascot">
            <span className="home-mascot-note home-mascot-note-top">Listen</span>
            <Image
              className="home-mascot"
              src="/images/habla-mascot.png"
              alt="A cheerful globe-shaped speech mascot wearing a headset"
              width={560}
              height={560}
              priority
            />
            <span className="home-mascot-note home-mascot-note-bottom">Speak</span>
          </div>
        </div>
      </section>

      <section id="choose-your-path" className="home-entry-section section-gap">
        <div className="home-section-head home-section-head-centered">
          <p className="pill pill-subtle">Choose your space</p>
          <h2>Where are you headed today?</h2>
        </div>

        <div className="home-entry-paths">
          <div className="home-entry-card home-entry-teacher">
            <div className="home-entry-icon">
              <GraduationCap size={25} aria-hidden="true" />
            </div>
            <h2 className="home-entry-title">I&apos;m a teacher</h2>
            <p className="meta">Create classes, assign speaking prompts, and grade recordings.</p>
            <GoogleSignInLink
              className="btn btn-primary home-entry-btn"
              callbackUrl="/teacher"
              wrapperClassName="auth-webview-guard-full"
            >
              Sign in as teacher
              <ArrowRight size={17} aria-hidden="true" />
            </GoogleSignInLink>
            <Link className="home-entry-secondary" href="/teacher/register">
              New here? Set up your account
            </Link>
          </div>

          <div className="home-entry-card home-entry-student">
            <div className="home-entry-icon home-entry-icon-student">
              <Languages size={25} aria-hidden="true" />
            </div>
            <h2 className="home-entry-title">I&apos;m a student</h2>
            <p className="meta">View your submitted recordings, grades, and teacher feedback.</p>
            <GoogleSignInLink
              className="btn btn-ghost home-entry-btn"
              callbackUrl="/student"
              wrapperClassName="auth-webview-guard-full"
            >
              Sign in as student
              <ArrowRight size={17} aria-hidden="true" />
            </GoogleSignInLink>
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
          <p className="pill pill-subtle">2026-2027 readiness</p>
          <h2>Preparing Habla for renewed classroom use and district review</h2>
          <p className="meta">
            Habla is focused on the core speaking-assignment workflow while privacy, retention, and district-review
            documentation are tightened. Public pricing and broad rollout terms are not finalized in the app.
          </p>
        </div>
        <div className="actions home-beta-actions">
          <Link className="btn btn-primary" href="/teacher/register">
            Create your account
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link className="btn btn-ghost" href="/pricing">
            View pricing
          </Link>
        </div>
      </section>

      <section className="grid cols-2 section-gap home-feature-grid">
        {featureCards.map((feature, index) => {
          const FeatureIcon = feature.icon;
          return (
            <article key={feature.title} className={`card home-feature-card home-feature-card-${index + 1}`}>
              <span className="home-feature-icon">
                <FeatureIcon size={22} aria-hidden="true" />
              </span>
              <div>
                <h2>{feature.title}</h2>
                <p className="meta">{feature.description}</p>
              </div>
            </article>
          );
        })}
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
                    <div className="home-preview-play">
                      <Volume2 size={15} />
                    </div>
                    <div className="home-preview-wave" />
                  </div>
                  <p className="meta">Feedback: Strong detail, good pacing, clear pronunciation.</p>
                </div>
              </div>

              <div className="home-preview-footer">
                <span className="home-preview-badge"><Download size={13} /> CSV export ready</span>
                <span className="home-preview-badge"><Mic2 size={13} /> No downloads required</span>
                <span className="home-preview-badge"><ChartNoAxesCombined size={13} /> Organized by class</span>
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
            workflow that does the job cleanly. It is being prepared for the 2026-2027 school year and
            designed for real classroom use.
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
          <p className="home-cta-copy">Preparing for the 2026-2027 school year.</p>
          <p className="meta">
            Create your account, run your first speaking assignment, and review the current access notes for
            teacher and district use.
          </p>
        </div>
        <div className="actions home-cta-actions">
          <GoogleSignInLink className="btn btn-primary" callbackUrl="/teacher">
            Sign in as teacher
            <ArrowRight size={17} aria-hidden="true" />
          </GoogleSignInLink>
          <Link className="btn btn-ghost" href="/pricing">
            View pricing
          </Link>
        </div>
      </section>
    </main>
  );
}

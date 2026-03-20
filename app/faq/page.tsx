import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "FAQ - Habla",
  description: "Common questions about Habla — how it works, what it costs, and how to get started.",
};

const FAQ_SECTIONS = [
  {
    heading: "Getting started",
    items: [
      {
        question: "What is Habla?",
        answer:
          "Habla is a simple tool that lets language teachers assign, collect, and grade student speaking recordings — all from one link, during a normal class period.",
      },
      {
        question: "Who is Habla for?",
        answer:
          "World language teachers (Spanish, French, etc.) who want a fast, low-tech way to hear every student speak without scheduling one-on-one time.",
      },
      {
        question: "Do I need to install anything?",
        answer:
          "No. Habla is web-based. Teachers create assignments from any browser, and students record from any device with a microphone — phone, Chromebook, or laptop.",
      },
    ],
  },
  {
    heading: "How it works",
    items: [
      {
        question: "How do students submit a recording?",
        answer:
          "You share one assignment link. Students open it, sign in with their school Google account, record their audio, listen back, and hit submit. That's it.",
      },
      {
        question: "How do I grade recordings?",
        answer:
          "Open the grading workspace for any assignment. You'll see every submission in one panel — play the audio, enter a score, add optional written feedback, and move on.",
      },
      {
        question: "Can I export grades?",
        answer:
          "Yes. Every class has a CSV export button. Download grades and drop them into PowerSchool, Canvas, or whatever your school uses.",
      },
      {
        question: "Can I add rubrics to assignments?",
        answer:
          "Yes. When creating an assignment you can build a rubric with custom criteria and point values. Students see the rubric before recording, and you grade against it.",
      },
    ],
  },
  {
    heading: "Privacy and security",
    items: [
      {
        question: "Is student data protected?",
        answer:
          "Yes. Students sign in with their school Google account. Audio files are stored securely, teacher routes are protected, and only the assigning teacher can access submissions.",
      },
      {
        question: "Can other students hear each other's recordings?",
        answer:
          "No. Submissions are private to the student and their teacher.",
      },
    ],
  },
  {
    heading: "Pricing and beta",
    items: [
      {
        question: "Is Habla free?",
        answer:
          "The first 20 world language teachers get Habla free forever. After that, individual teachers pay $4.99/month or $39.95/year.",
      },
      {
        question: "What does the paid plan include?",
        answer:
          "Everything — unlimited classes, unlimited assignments, audio submissions, grading, feedback, rubrics, and CSV export. There is one plan, and it includes all features.",
      },
      {
        question: "What if my department wants to cover the cost?",
        answer:
          "Departments can contact us to set up coverage so teachers don't pay out of pocket. We'll work out the details directly.",
      },
      {
        question: "Can I try it before paying?",
        answer:
          "Yes. Beta spots are still open. Create an account and start using Habla with real students — no credit card needed.",
      },
    ],
  },
] as const;

export default function FaqPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="FAQ" />
      <section className="hero">
        <p className="pill">FAQ</p>
        <h1>Everything teachers ask about Habla</h1>
        <p>
          How it works, what it costs, and how to get started with speaking assignments in your classroom.
        </p>
      </section>

      {FAQ_SECTIONS.map((section) => (
        <section key={section.heading} className="section-gap">
          <h2 className="faq-section-heading">{section.heading}</h2>
          <div className="grid faq-grid">
            {section.items.map((item) => (
              <details key={item.question} className="card faq-card">
                <summary className="faq-summary">{item.question}</summary>
                <p className="meta faq-answer">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      ))}

      <section className="card section-gap">
        <h2 className="surface-title">Still have a question?</h2>
        <p className="meta">
          We&apos;re a small team and we actually read every message. Ask us anything.
        </p>
        <div className="actions form-actions">
          <Link className="btn btn-primary" href="/feedback">
            Contact us
          </Link>
          <Link className="btn btn-ghost" href="/pricing">
            View pricing
          </Link>
        </div>
      </section>
    </main>
  );
}

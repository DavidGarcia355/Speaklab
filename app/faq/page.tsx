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
        question: "How do I create my first assignment?",
        answer:
          "Sign in, go to your teacher dashboard, and create a class. Inside the class, click \"New assignment,\" write your prompt, set the point value, and save. Habla generates a student link instantly. Copy it and share it however you share links with your class — Google Classroom, email, or projected on the board.",
      },
      {
        question: "How do I share the assignment link with students?",
        answer:
          "Every assignment has a \"Copy link\" button. Paste it into Google Classroom, email, your LMS, or just project it. Students click the link — no account setup required on their end before they get there.",
      },
      {
        question: "Do I need to install anything?",
        answer:
          "No. Habla runs entirely in the browser. Teachers and students don't install anything.",
      },
    ],
  },
  {
    heading: "Students and submissions",
    items: [
      {
        question: "Do students need an account?",
        answer:
          "Yes — students sign in with their school Google account before submitting. This is how Habla knows whose recording it is. Students who don't have a school Google account can't submit. If your school uses Microsoft instead of Google, contact us.",
      },
      {
        question: "How do students submit a recording?",
        answer:
          "Students open the assignment link, sign in with their school Google account, enter their name, hit \"Start recording,\" speak, stop, play it back, and hit \"Submit.\" The whole thing takes under two minutes.",
      },
      {
        question: "What devices and browsers work?",
        answer:
          "Chrome and Edge on laptops and Chromebooks work best. Safari on iPhone and iPad works (iOS 14.3 or newer required). Firefox works on desktop. Students should not use the built-in browser inside Google Classroom or other apps — if the mic button is grayed out, have them open the link in Chrome or Safari directly.",
      },
      {
        question: "What if the microphone doesn't work?",
        answer:
          "First: make sure the student opened the link in Chrome or Safari, not inside another app. Second: the browser will ask for microphone permission — they must click Allow, not Block. Third: if permission was previously blocked, they need to go to browser site settings and reset it. On a Chromebook, check that the school hasn't blocked microphone access in device settings. If none of that works, have the student try on their phone with mobile data instead of the school Wi-Fi.",
      },
      {
        question: "What information does Habla store about students?",
        answer:
          "Habla stores the student's name (as they enter it), their school email address, and their audio recording. No other personal information is collected. Only their teacher can access their submissions.",
      },
    ],
  },
  {
    heading: "Roster",
    items: [
      {
        question: "How do I add students to my class roster?",
        answer:
          "Students are added to your roster automatically the first time they submit an assignment. You can also add them manually from the Roster section inside your class — just enter a name and email. If your school uses a student information system, you can export a CSV and upload it directly to Habla.",
      },
      {
        question: "How does CSV roster import work?",
        answer:
          "In your class, scroll to the Roster section and click \"Upload CSV.\" Your file should have a name column and an email column — either as \"name, email\" or \"first name, last name, email\" with a header row. Habla will tell you how many students were added and how many were already on the roster. PowerSchool, Infinite Campus, and Google Classroom exports work.",
      },
    ],
  },
  {
    heading: "Grading and export",
    items: [
      {
        question: "How do I grade recordings?",
        answer:
          "Open a class, then open an assignment. You'll see all submissions in one panel. Click a submission to play the audio, enter a score, add optional written feedback, and save. If you set up a rubric, you'll grade each criterion separately and Habla totals the score.",
      },
      {
        question: "Can I export grades?",
        answer:
          "Yes. Inside any class, there's a \"Download gradebook\" button. It exports a CSV with student names, emails, assignment titles, scores, feedback, and submission timestamps. Drop it into PowerSchool, Canvas, Schoology, or your school's gradebook.",
      },
      {
        question: "Can I add rubrics to assignments?",
        answer:
          "Yes. When creating an assignment, click \"Add rubric\" and define your criteria with point values. Students see the rubric before recording. You grade each criterion when reviewing submissions.",
      },
    ],
  },
  {
    heading: "Troubleshooting",
    items: [
      {
        question: "What should I do if something goes wrong during class?",
        answer:
          "Stay calm — here's the order to try: (1) Have the student reload the page and try again. (2) Have them open the link in a different browser (Chrome is the most reliable). (3) If they're on school Wi-Fi and getting errors, have them switch to their phone's mobile data. (4) If you're seeing an error across multiple students, contact us immediately at the feedback form — include your class name and what you're seeing. Everything is recoverable.",
      },
      {
        question: "A student submitted but I can't see their recording.",
        answer:
          "Refresh the assignment page. If it still doesn't appear, check that the student signed in with the correct school account before submitting — submissions are attached to the email they used. If they submitted as a guest or with the wrong account, they'll need to submit again.",
      },
      {
        question: "The student link isn't working.",
        answer:
          "Make sure the link was copied in full and wasn't truncated when pasting into email or a chat. Test it yourself in an incognito window. If the page shows \"Assignment unavailable,\" the assignment may have been deleted — check your class dashboard.",
      },
    ],
  },
  {
    heading: "Privacy and security",
    items: [
      {
        question: "Is student data protected?",
        answer:
          "Yes. Students sign in with their school Google account. Audio files are stored securely and are not public. Only the assigning teacher can access submissions — other teachers, students, and outside parties cannot.",
      },
      {
        question: "Can other students hear each other's recordings?",
        answer:
          "No. Every submission is private to the student and their teacher.",
      },
    ],
  },
  {
    heading: "Pricing",
    items: [
      {
        question: "Is Habla free?",
        answer:
          "Habla is currently in beta and free for all active beta teachers. Individual teacher pricing is $4.99/month or $39.95/year when beta ends. If you signed up during beta, we'll be in touch before anything changes.",
      },
      {
        question: "What does the plan include?",
        answer:
          "Everything — unlimited classes, unlimited assignments, audio submissions, grading, rubrics, feedback, roster management, and CSV export. One plan, all features.",
      },
      {
        question: "What if my department wants to cover the cost?",
        answer:
          "Contact us and we'll set up department coverage so teachers don't pay out of pocket.",
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
        <h1>Questions about Habla</h1>
        <p>
          Setup, student submissions, microphone troubleshooting, roster management, grading, and export — answered for teachers.
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
        <h2 className="surface-title">Still stuck?</h2>
        <p className="meta">
          We read every message and respond fast — especially on school days. Describe what you&apos;re seeing and we&apos;ll get back to you quickly.
        </p>
        <div className="actions form-actions">
          <Link className="btn btn-primary" href="/feedback">
            Contact us
          </Link>
        </div>
      </section>
    </main>
  );
}

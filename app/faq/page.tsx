import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "FAQ",
  description: "Common questions about TryHabla, classroom workflows, access, and privacy review.",
  path: "/faq",
});

const FAQ_SECTIONS = [
  {
    heading: "Getting started",
    items: [
      {
        question: "What is TryHabla?",
        answer:
          "TryHabla is a simple tool that lets language teachers assign, collect, and grade student speaking recordings from one link during a normal class period.",
      },
      {
        question: "How do I create my first assignment?",
        answer:
          "Sign in, go to your teacher dashboard, and create a class. Inside the class, click \"New assignment,\" write your prompt, set the point value, and save. TryHabla generates a student link instantly. Copy it and share it however you share links with your class: Google Classroom, email, your LMS, or projected on the board.",
      },
      {
        question: "How do I share the assignment link with students?",
        answer:
          "Every assignment has a \"Copy link\" button. Paste it into Google Classroom, email, your LMS, or just project it. Students click the link and sign in before submitting.",
      },
      {
        question: "Do I need to install anything?",
        answer:
          "No. TryHabla runs entirely in the browser. Teachers and students do not install anything.",
      },
    ],
  },
  {
    heading: "Students and submissions",
    items: [
      {
        question: "Do students need an account?",
        answer:
          "Yes. Students sign in before submitting so TryHabla can attach the recording to the account email. TryHabla supports Google school accounts and can also support Microsoft 365 school accounts when Microsoft sign-in is enabled. Students should use the exact school email their teacher added to the roster.",
      },
      {
        question: "How do students submit a recording?",
        answer:
          "Students open the assignment link, sign in, enter their name, hit \"Start recording,\" speak, stop, play it back, and hit \"Submit.\" The whole thing takes under two minutes.",
      },
      {
        question: "What devices and browsers work?",
        answer:
          "TryHabla supports current versions of Chrome, Edge, Firefox, and Safari on laptops, Chromebooks, phones, and tablets. Students should not use the embedded browser inside Google Classroom, social apps, or messaging apps; open the link in a standalone browser instead.",
      },
      {
        question: "What if the microphone does not work?",
        answer:
          "First, make sure the student opened the link in a current standalone version of Chrome, Edge, Firefox, or Safari, not inside another app. Second, the browser will ask for microphone permission and the student must allow it. Third, if permission was previously blocked, they need to reset it in browser site settings. On a Chromebook, check that the school has not blocked microphone access in device settings.",
      },
      {
        question: "What information does TryHabla store about students?",
        answer:
          "TryHabla stores the student's name as entered, account email address, audio recording, submission timestamps, and any grade or feedback added by the teacher. Only the assigning teacher can access submissions through the app.",
      },
    ],
  },
  {
    heading: "Roster",
    items: [
      {
        question: "How do I add students to my class roster?",
        answer:
          "Students are added to your roster automatically the first time they submit an assignment. You can also add them manually from the Roster section inside your class by entering a name and email.",
      },
      {
        question: "How does CSV roster import work?",
        answer:
          "In your class, scroll to the Roster section and click \"Upload CSV.\" Your file should have a name column and an email column, either as \"name, email\" or \"first name, last name, email\" with a header row. TryHabla will tell you how many students were added and how many were already on the roster.",
      },
    ],
  },
  {
    heading: "Grading and export",
    items: [
      {
        question: "How do I grade recordings?",
        answer:
          "Open a class, then open an assignment. You will see submissions in one panel. Play the audio, enter a score, add optional written feedback, and save. If you set up a rubric, you grade each criterion separately and TryHabla totals the score.",
      },
      {
        question: "Can I export grades?",
        answer:
          "Yes. Inside any class, there is an export button. It exports a CSV with student names, emails, assignment titles, scores, feedback, and submission timestamps for import into a school gradebook.",
      },
      {
        question: "Can I add rubrics to assignments?",
        answer:
          "Yes. When creating an assignment, enable the rubric builder and define criteria with point values. Students see assignment instructions before recording, and teachers grade each criterion when reviewing submissions.",
      },
    ],
  },
  {
    heading: "Troubleshooting",
    items: [
      {
        question: "What should I do if something goes wrong during class?",
        answer:
          "Have the student reload the page and try again. If that fails, have them open the link in a different browser. If they are on school Wi-Fi and getting upload errors, try another network and contact support with the class name and a short description of what happened.",
      },
      {
        question: "A student submitted but I cannot see their recording.",
        answer:
          "Refresh the assignment page. If it still does not appear, check that the student signed in with the correct school account before submitting. Submissions are attached to the email they used.",
      },
      {
        question: "The student link is not working.",
        answer:
          "Make sure the link was copied in full and was not truncated when pasted into email or chat. Test it yourself in an incognito window. If the page shows \"Assignment unavailable,\" the assignment may have been deleted.",
      },
    ],
  },
  {
    heading: "Privacy and security",
    items: [
      {
        question: "Is student data protected?",
        answer:
          "TryHabla uses sign-in, teacher role checks, and class ownership checks to limit access. Student recordings should be stored in private or access-controlled storage; production storage settings must be verified before district rollout.",
      },
      {
        question: "Can other students hear each other's recordings?",
        answer:
          "No. The app does not provide a student-to-student recording sharing feature. Teacher playback routes check the teacher's access to the class before returning audio.",
      },
    ],
  },
  {
    heading: "Access and district review",
    items: [
      {
        question: "Is TryHabla free?",
        answer:
          "Yes. Free includes classes, rosters, speaking assignments, student recordings, teacher grading, feedback, CSV export, and a lifetime allowance of 30 AI-assisted recordings per teacher account. After those 30 recordings, the non-AI classroom remains available at no charge.",
      },
      {
        question: "How does optional AI pricing work?",
        answer:
          "Teacher is $20 per month and includes 300 AI-assisted recordings in each Stripe billing period. One unit delivers a transcript, and optional grading for that same recording and assignment is included. Copying or downloading a saved transcript never uses another unit. Recordings can be up to five minutes. Provider failures, empty or unusable transcripts, and exact retries do not use another unit. Unused units do not roll over, and there are no automatic overages; reaching the limit pauses AI while recording, playback, downloads, and manual grading remain available.",
      },
      {
        question: "Does AI save the grade automatically?",
        answer:
          "A teacher can generate, copy, or download a transcript without requesting an AI grade, generate missing transcripts in a confirmed batch, or opt a specific assignment into automatic transcription for future submissions. Students see when automatic transcription is on. If the teacher chooses grading, a successful run saves a whole-point score, rubric breakdown when applicable, and feedback onto an ungraded submission. The result is visible to that student immediately. The teacher can review the transcript and evidence, edit the grade, or replace the feedback. If the AI cannot produce a valid grade, TryHabla saves no score.",
      },
      {
        question: "What does the current workflow include?",
        answer:
          "The current classroom workflow includes classes, assignments, student audio submissions, teacher grading, rubrics, feedback, roster management, and CSV export.",
      },
      {
        question: "What if my department or district needs a review?",
        answer:
          "Contact TryHabla for Schools. It is the larger and custom path for schools that need cohort planning, expected review volume, onboarding, privacy review, or custom terms. It does not currently include a school admin console or imply district approval. Contact us for privacy, retention, security, subprocessor, and DPA-review materials.",
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
        <h1>Questions about TryHabla</h1>
        <p>
          Setup, student submissions, microphone troubleshooting, roster management, grading, export,
          and district review - answered for teachers.
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
          We read every message and respond fast, especially on school days. Describe what you are
          seeing and we will get back to you quickly.
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

import type { Metadata } from "next";
import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "FAQ - Habla",
};

const FAQ_ITEMS = [
  {
    question: "Who should use Habla?",
    answer:
      "Habla is built for language teachers who need quick speaking checks during normal class periods.",
  },
  {
    question: "How do students submit recordings?",
    answer:
      "Students open one assignment link, sign in with their school account, record audio, and submit.",
  },
  {
    question: "Can teachers control grading?",
    answer:
      "Yes. Teachers grade manually, add optional feedback, and export CSV for systems like PowerSchool.",
  },
  {
    question: "Is student data protected?",
    answer:
      "Yes. Teacher routes are protected, sign-in is required for submissions, and audio access is restricted.",
  },
  {
    question: "Can I pilot this before schoolwide rollout?",
    answer:
      "Yes. Habla is in beta now, and the first 20 world language teachers get free access forever.",
  },
  {
    question: "What does Habla cost after beta?",
    answer:
      "Individual teachers will be able to use Habla for $4.99/month or $39.95/year. Departments can contact us if they want school-covered access for multiple teachers.",
  },
] as const;

export default function FaqPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="FAQ" />
      <section className="hero">
        <p className="pill">Frequently asked questions</p>
        <h1>Habla FAQ</h1>
        <p>Answers for teachers evaluating Habla, beta access, and simple teacher-friendly pricing.</p>
      </section>

      <section className="grid section-gap">
        {FAQ_ITEMS.map((item) => (
          <article key={item.question} className="card">
            <h2 className="surface-title">{item.question}</h2>
            <p className="meta">{item.answer}</p>
          </article>
        ))}
      </section>

      <section className="card section-gap">
        <h2 className="surface-title">Still have questions?</h2>
        <p className="meta">See the current beta offer, individual teacher pricing, or reach out about department coverage.</p>
        <div className="actions form-actions">
          <Link className="btn btn-primary" href="/pricing">
            View pricing
          </Link>
          <Link className="btn btn-ghost" href="/feedback">
            Contact us
          </Link>
        </div>
      </section>
    </main>
  );
}

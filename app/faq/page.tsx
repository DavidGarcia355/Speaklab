import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";

const FAQ_ITEMS = [
  {
    question: "Who should use Habla?",
    answer:
      "Habla is built for language teachers who need quick speaking checks during normal class periods.",
  },
  {
    question: "How do students submit recordings?",
    answer:
      "Students open one assignment link, sign in with their school Google account, record audio, and submit.",
  },
  {
    question: "Can teachers control grading?",
    answer:
      "Yes. Teachers grade manually, add optional feedback, and export CSV for systems like PowerSchool.",
  },
  {
    question: "Is student data protected?",
    answer:
      "Yes. Teacher routes are protected, school-domain auth is enforced for submissions, and audio access is restricted.",
  },
  {
    question: "Can I pilot this before schoolwide rollout?",
    answer:
      "Yes. Use the feedback form to request pilot access and include your school and department details.",
  },
] as const;

export default function FaqPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="FAQ" />
      <section className="hero">
        <p className="pill">Frequently asked questions</p>
        <h1>Habla FAQ</h1>
        <p>Answers for teachers evaluating Habla for speaking assessments.</p>
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
        <p className="meta">Send your details and we can help with setup for your classes.</p>
        <div className="actions form-actions">
          <Link className="btn btn-primary" href="/feedback">
            Request Pilot Access
          </Link>
          <Link className="btn btn-ghost" href="/">
            Back Home
          </Link>
        </div>
      </section>
    </main>
  );
}

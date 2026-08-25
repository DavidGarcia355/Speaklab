import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CircleCheck,
  MessageCircle,
  Mic2,
  Sparkles,
} from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "For Students",
  description: "A clear speaking-practice workspace for Habla students.",
  path: "/students",
});

const studentFeatures = [
  {
    icon: BookOpenCheck,
    title: "Your classes",
    description: "See rostered classes and speaking assignments from one student dashboard.",
  },
  {
    icon: Mic2,
    title: "Browser recording",
    description:
      "Record and submit from a modern laptop, Chromebook, phone, or tablet without installing an app.",
  },
  {
    icon: CircleCheck,
    title: "Clear status",
    description: "Know which assignments are ready to record and which already have a submission.",
  },
  {
    icon: MessageCircle,
    title: "Teacher feedback",
    description: "Return to submitted recordings to see grades and written feedback from your teacher.",
  },
] as const;

export default function StudentsPage() {
  return (
    <main className="page-wrap">
      <BrandBar label="Students" />

      <section className="student-public-hero">
        <div className="student-public-copy">
          <p className="pill">
            <Sparkles size={14} aria-hidden="true" />
            Student speaking space
          </p>
          <h1>Your speaking work, all in one place.</h1>
          <p>
            Open the assignment your teacher shared, record directly in your browser, and come back
            for grades and feedback. Habla keeps the steps clear so you can focus on speaking.
          </p>
          <div className="student-primary-action">
            <GoogleSignInLink className="btn btn-primary" callbackUrl="/student">
              Log in as student
              <ArrowRight size={17} aria-hidden="true" />
            </GoogleSignInLink>
            <Link className="student-text-link" href="/">
              Back home
            </Link>
          </div>
        </div>
        <div className="student-public-mascot" aria-label="Habla Man mascot preview">
          <span className="student-public-pop student-public-pop-top">
            <Mic2 size={14} aria-hidden="true" />
            record here
          </span>
          <Image
            src="/mascot/habla-man.webp"
            alt="Habla Man, Habla's superhero mascot"
            width={420}
            height={417}
            priority
          />
          <span className="student-public-pop student-public-pop-bottom">
            <MessageCircle size={14} aria-hidden="true" />
            feedback ready
          </span>
        </div>
      </section>

      <section
        className="student-reward-strip student-reward-marquee section-gap"
        aria-label="Student workflow"
      >
        <span>Open assignment</span>
        <span>Record in browser</span>
        <span>Submit recording</span>
        <span>Review feedback</span>
      </section>

      <section className="grid cols-2 section-gap audience-card-grid">
        {studentFeatures.map((feature) => {
          const Icon = feature.icon;
          return (
            <article key={feature.title} className="card audience-info-card student-info-card">
              <Icon size={22} aria-hidden="true" />
              <h2>{feature.title}</h2>
              <p className="meta">{feature.description}</p>
            </article>
          );
        })}
      </section>
    </main>
  );
}

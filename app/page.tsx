import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Building2,
  GraduationCap,
  Mic2,
  Ribbon,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import ExternalBrowserNotice from "@/app/components/ExternalBrowserNotice";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";
import SchoolNetworkNotice from "@/app/components/SchoolNetworkNotice";
import ThemeToggle from "@/app/components/ThemeToggle";
import { APP_NAME } from "@/app/constants";

export const metadata: Metadata = {
  title: "Habla",
  description: "AI-assisted speaking assignments for language teachers, students, and schools.",
};

const audienceCards = [
  {
    href: "/district",
    icon: Building2,
    label: "District",
    title: "Bring speaking practice to every classroom",
    description: "Preview privacy, rollout, and demo options for school and district teams.",
    action: "Explore district fit",
    className: "home-audience-district",
  },
  {
    href: "/teachers",
    icon: GraduationCap,
    label: "Teacher",
    title: "Assign, listen, grade, and move on",
    description: "See how Habla helps teachers run speaking assignments without juggling tools.",
    action: "See teacher benefits",
    className: "home-audience-teacher",
  },
  {
    href: "/students",
    icon: Mic2,
    label: "Student",
    title: "Record, review feedback, and keep improving",
    description: "Open assignments, record in your browser, and see grades and teacher feedback in one place.",
    action: "Enter student space",
    className: "home-audience-student",
  },
] as const;

export default function Home() {
  return (
    <main className="page-wrap">
      <header className="home-top-tools" aria-label="Homepage tools">
        <Link className="btn btn-ghost btn-sm" href="/about">
          About me
        </Link>
        <ThemeToggle />
      </header>
      <ExternalBrowserNotice className="home-external-browser-notice" />

      <section className="home-choice-hero">
        <div className="home-choice-copy">
          <GoogleSignInLink className="home-hero-brand" callbackUrl="/teacher">
            <span className="home-hero-brand-mark" aria-hidden="true">
              H
            </span>
            <span>{APP_NAME}</span>
          </GoogleSignInLink>
          <p className="pill home-hero-eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            Built for speaking classrooms
          </p>
          <h1>Speaking practice made simple.</h1>
          <p>
            One focused workflow for assigning speaking practice, recording in the browser, and
            turning student voice into useful teacher feedback.
          </p>
        </div>
        <div className="home-choice-mascot" aria-hidden="true">
          <Image
            src="/mascot/habla-man.webp"
            alt=""
            width={520}
            height={516}
            priority
          />
        </div>
      </section>

      <section className="pricing-cause-band home-cause-band" aria-labelledby="home-cause-heading">
        <div className="pricing-cause-icon" aria-hidden="true">
          <Ribbon className="cancer-ribbon-icon" data-awareness-ribbon="peach" size={34} />
        </div>
        <div>
          <p className="pill pill-subtle">Why Habla matters to me</p>
          <h2 id="home-cause-heading">Built for my mom. Supporting her fight now.</h2>
          <p>
            My mom is a Spanish teacher fighting recurrent endometrial cancer. After the August
            storms left our Portage, Indiana home without power or air conditioning, that purpose
            became even more urgent. Habla&apos;s core stays free, and all proceeds from optional AI
            help support her care and our family.
          </p>
        </div>
        <div className="actions home-cause-actions">
          <Link className="btn btn-primary" href="/about">
            Read our story
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <a
            className="btn btn-ghost"
            href="https://paypal.me/DavidGarcia355"
            target="_blank"
            rel="noreferrer"
          >
            Support my mom
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="home-audience-grid" aria-label="Choose your Habla role">
        {audienceCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href} className={`home-audience-card ${card.className}`}>
              <span className="home-audience-label">
                <Icon size={22} aria-hidden="true" />
                {card.label}
              </span>
              <strong>{card.title}</strong>
              <span>{card.description}</span>
              <span className="home-audience-action">
                {card.action}
                <ArrowRight size={17} aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </section>

      <section className="home-district-note section-gap">
        <div>
          <p className="pill pill-subtle">
            <ShieldCheck size={14} aria-hidden="true" />
            Open for teacher pilots while district review continues
          </p>
          <h2>Start with one class. Prove the workflow before a wider rollout.</h2>
          <p className="meta">
            Habla&apos;s core audio classroom is free forever. Optional AI is usage-based, while district
            rollout and purchasing remain a separate review process.
          </p>
        </div>
        <div className="actions home-district-actions">
          <Link className="btn btn-primary" href="/teachers">
            Start a teacher pilot
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link className="btn btn-ghost" href="/district">
            District review
          </Link>
          <Link className="btn btn-ghost" href="/pricing">
            See pricing
          </Link>
        </div>
      </section>

      <section className="home-quick-preview section-gap">
        <article>
          <UsersRound size={20} aria-hidden="true" />
          <h2>Already moving through real classrooms</h2>
          <p className="meta">
            Aggregate Habla activity as of August 2026. No student names or classroom details are shown.
          </p>
          <div className="home-proof-grid" aria-label="Habla pilot activity">
            <span className="home-proof-stat"><strong>37</strong><span>teachers publishing</span></span>
            <span className="home-proof-stat"><strong>141</strong><span>classes created</span></span>
            <span className="home-proof-stat"><strong>585</strong><span>recordings submitted</span></span>
          </div>
        </article>
        <article>
          <BrainCircuit size={20} aria-hidden="true" />
          <h2>AI grades. Teachers stay in control.</h2>
          <p className="meta">
            When enabled, Habla saves a whole-point score, rubric breakdown, and feedback after a
            successful AI review. Teachers can inspect the evidence and edit the grade anytime.
          </p>
          <Link className="student-text-link" href="/teachers">
            See the teacher workflow
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </article>
      </section>

      <SchoolNetworkNotice
        className="home-network-notice"
        message="On a school network? Open this page on your phone, or ask your IT department to allowlist tryhabla.com"
        storageKey="habla-school-network-home-notice"
      />
    </main>
  );
}

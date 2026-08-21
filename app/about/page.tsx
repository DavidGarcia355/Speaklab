import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Mic2, Ribbon } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "About David - Habla",
  description: "Meet David, the college student building and maintaining Habla.",
};

export default function AboutPage() {
  return (
    <main className="page-wrap about-page">
      <BrandBar label="About me" />

      <section className="hero about-hero">
        <p className="pill">
          <Mic2 size={14} aria-hidden="true" />
          The person behind Habla
        </p>
        <h1>Hi, I&apos;m David.</h1>
        <p>
          I&apos;m a college student building Habla to make speaking assignments simpler for teachers
          and give every student more chances to use their voice.
        </p>
      </section>

      <section className="about-story-grid section-gap" aria-label="David's story">
        <article className="card about-story-card">
          <p className="pill pill-subtle">Why I built it</p>
          <h2 className="surface-title">A small project with a human purpose.</h2>
          <p className="meta">
            I build and maintain Habla myself. Its core audio classroom will stay free because useful
            speaking practice should be accessible without adding another burden for teachers.
          </p>
        </article>

        <article className="card about-family-card">
          <Ribbon
            className="cancer-ribbon-icon"
            data-awareness-ribbon="peach"
            size={28}
            aria-hidden="true"
          />
          <h2 className="surface-title">My mom is fighting cancer.</h2>
          <p className="meta">
            While I keep Habla running, my family is standing beside her. If Habla has helped you and
            you would like to support us, I&apos;m deeply grateful.
          </p>
          <div className="actions">
            <a
              className="btn btn-primary"
              href="https://paypal.me/DavidGarcia355"
              target="_blank"
              rel="noreferrer"
            >
              Help my mom&apos;s fight against cancer
              <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            <Link className="btn btn-ghost" href="/">
              <ArrowLeft size={17} aria-hidden="true" />
              Back to Habla
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}

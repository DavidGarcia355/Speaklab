import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Mic2, Ribbon } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";

export const metadata: Metadata = {
  title: "About David - Habla",
  description: "Why David built Habla for his mom, a Spanish teacher fighting recurrent endometrial cancer.",
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
          I&apos;m a college student who built Habla for my mom, a Spanish teacher who needed a simple
          way to run speaking assignments. Now I&apos;m building it for teachers everywhere—and for her.
        </p>
      </section>

      <section className="about-story-grid section-gap" aria-label="David's story">
        <article className="card about-story-card">
          <p className="pill pill-subtle">Why I built it</p>
          <h2 className="surface-title">A small project with a human purpose.</h2>
          <p className="meta">
            Habla started as a practical answer to a problem my mom faced in her own classroom. I
            build and maintain it myself, and its core audio classroom will stay free because useful
            speaking practice should not become another burden for teachers.
          </p>
        </article>

        <article className="card about-family-card">
          <Ribbon
            className="cancer-ribbon-icon"
            data-awareness-ribbon="peach"
            size={28}
            aria-hidden="true"
          />
          <h2 className="surface-title">My mom is fighting recurrent endometrial cancer.</h2>
          <p className="meta">
            In August 2026, severe storms devastated Northwest Indiana and left our home in Portage
            without power or air conditioning while she was seriously ill at home. We are trying to
            keep her safe, comfortable, and supported while she continues treatment.
          </p>
          <p className="meta">
            This is my why: Habla should genuinely help teachers, and if it succeeds, it can help me
            care for the teacher who inspired it. The core classroom remains free. All proceeds from
            optional AI go toward my mom&apos;s fight and our family&apos;s immediate needs.
          </p>
          <div className="actions">
            <a
              className="btn btn-primary"
              href="https://paypal.me/DavidGarcia355"
              target="_blank"
              rel="noreferrer"
            >
              Help my mom&apos;s fight against endometrial cancer
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

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Mic2, Ribbon } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "About David",
  description: "Why David built Habla for his mom, a Spanish teacher fighting recurrent endometrial cancer.",
  path: "/about",
});

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
            build and maintain it myself, and the core audio classroom is free during the current
            teacher pilot so useful speaking practice does not begin with another burden.
          </p>
        </article>

        <article className="card about-family-card">
          <Ribbon
            className="cancer-ribbon-icon"
            data-awareness-ribbon="peach"
            size={28}
            aria-hidden="true"
          />
          <h2 className="surface-title">My mom is why Habla exists.</h2>
          <p className="meta">
            She is a Spanish teacher fighting recurrent endometrial cancer. I originally built Habla
            to solve a real problem in her classroom. Today, every part of this company is tied to
            the same goal: build something genuinely useful for teachers and use its success to
            support her as much as I can.
          </p>
          <p className="meta">
            The current core pilot is free. Proceeds from any optional AI plan that is later offered
            will go toward my mom&apos;s fight. If Habla helps your classroom, supporting her directly
            helps me keep building while standing beside her.
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

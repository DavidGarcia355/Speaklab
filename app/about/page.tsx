import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Mic2, Ribbon } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import { PAYPAL_DONATION_DISCLOSURE, PAYPAL_DONATION_URL } from "@/app/constants";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "About David",
  description: "Why David built TryHabla for his mom, a Spanish teacher fighting recurrent endometrial cancer.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className="page-wrap about-page">
      <BrandBar label="About me" />

      <section className="hero about-hero">
        <p className="pill">
          <Mic2 size={14} aria-hidden="true" />
          The person behind TryHabla
        </p>
        <h1>Hi, I&apos;m David.</h1>
        <p>
          I&apos;m a college student who built TryHabla for my mom, a Spanish teacher who needed a simple
          way to run speaking assignments. Now I&apos;m building it for teachers everywhere—and for her.
        </p>
      </section>

      <section className="about-story-grid section-gap" aria-label="David's story">
        <article className="card about-story-card">
          <p className="pill pill-subtle">Why I built it</p>
          <h2 className="surface-title">A small project with a human purpose.</h2>
          <p className="meta">
            TryHabla started as a practical answer to a problem my mom faced in her own classroom. I
            build and maintain it myself, and the core audio classroom is free forever so useful
            speaking practice does not begin with another burden.
          </p>
        </article>

        <article className="card about-family-card">
          <Ribbon
            className="cancer-ribbon-icon"
            data-awareness-ribbon="peach"
            size={28}
            aria-hidden="true"
          />
          <h2 className="surface-title">My mom is why TryHabla exists.</h2>
          <p className="meta">
            She is a Spanish teacher fighting recurrent endometrial cancer. I originally built
            TryHabla to solve a real problem in her classroom. Today, every part of this company is tied to
            the same goal: build something genuinely useful for teachers and use its success to
            support her as much as I can.
          </p>
          <p className="meta">
            The core classroom is free. Revenue from Teacher helps me operate TryHabla, keep
            building, and support my family while my mom fights cancer. If TryHabla helps your classroom,
            supporting her directly also helps me keep building while standing beside her.
          </p>
          <p className="meta">{PAYPAL_DONATION_DISCLOSURE}</p>
          <div className="actions">
            <a
              className="btn btn-primary"
              href={PAYPAL_DONATION_URL}
              target="_blank"
              rel="noreferrer"
            >
              Donate to support my mom via PayPal
              <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            <Link className="btn btn-ghost" href="/">
              <ArrowLeft size={17} aria-hidden="true" />
              Back to TryHabla
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}

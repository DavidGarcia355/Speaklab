import {
  ArrowUpRight,
  Building2,
  Facebook,
  Github,
  Linkedin,
  Mail,
  Ribbon,
} from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import {
  CONTACT_LINKS,
  PAYPAL_DONATION_DISCLOSURE,
  PAYPAL_DONATION_URL,
  TRYHABLA_SOCIAL_LINKS,
} from "@/app/constants";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "About David & TryHabla",
  description:
    "Meet founder David Garcia and learn why TryHabla was built for language teachers and their classrooms.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className="page-wrap about-page about-company-page about-simple-page">
      <BrandBar label="About TryHabla" />

      <section className="about-founder-section" aria-labelledby="about-founder-heading">
        <div className="about-founder-identity">
          <div className="about-founder-avatar" aria-hidden="true">DG</div>
          <div>
            <p className="teacher-section-label">Founder</p>
            <h1 id="about-founder-heading">Hi, I&apos;m David Garcia.</h1>
            <p>Founder and builder of TryHabla</p>
          </div>
        </div>

        <div className="about-founder-story">
          <p>
            I&apos;m a college student who built TryHabla for my mom, a Spanish teacher who needed a
            simpler way to run speaking assignments. I design, build, and maintain the product while
            learning directly from the teachers using it.
          </p>
          <p>
            What began as a small classroom project is becoming a focused company for language
            teachers, students, and schools. My goal is simple: build dependable tools that respect
            teachers&apos; time and make speaking practice easier.
          </p>

          <div className="about-founder-links" aria-label="David Garcia links">
            <a href={CONTACT_LINKS.linkedin} target="_blank" rel="noreferrer">
              <Linkedin size={17} aria-hidden="true" /> Personal LinkedIn <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <a href={CONTACT_LINKS.email}>
              <Mail size={17} aria-hidden="true" /> davidsgarcia325@gmail.com
            </a>
            <a href={CONTACT_LINKS.github} target="_blank" rel="noreferrer">
              <Github size={17} aria-hidden="true" /> GitHub <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>

          <div className="about-company-links" aria-label="Official TryHabla links">
            <span>TryHabla online</span>
            <a href="https://tryhabla.com" target="_blank" rel="noreferrer">
              <Building2 size={15} aria-hidden="true" /> Website
            </a>
            <a href={TRYHABLA_SOCIAL_LINKS.linkedin} target="_blank" rel="noreferrer">
              <Linkedin size={15} aria-hidden="true" /> LinkedIn
            </a>
            <a href={TRYHABLA_SOCIAL_LINKS.facebook} target="_blank" rel="noreferrer">
              <Facebook size={15} aria-hidden="true" /> Facebook
            </a>
          </div>
        </div>
      </section>

      <section className="about-family-section" aria-labelledby="about-family-heading">
        <div className="about-family-icon">
          <Ribbon
            className="cancer-ribbon-icon"
            data-awareness-ribbon="peach"
            size={30}
            aria-hidden="true"
          />
        </div>
        <div className="about-family-copy">
          <p className="teacher-section-label">The personal story</p>
          <h2 id="about-family-heading">My mom is why TryHabla exists.</h2>
          <p>
            She is a Spanish teacher fighting recurrent endometrial cancer. TryHabla began by solving
            a real problem in her classroom, and building something genuinely useful for teachers is
            one way I continue to stand beside her.
          </p>
          <details className="about-donation-details">
            <summary>Donation details</summary>
            <p>{PAYPAL_DONATION_DISCLOSURE}</p>
          </details>
        </div>
        <a className="btn btn-ghost about-donation-action" href={PAYPAL_DONATION_URL} target="_blank" rel="noreferrer">
          Support her fight <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </section>
    </main>
  );
}

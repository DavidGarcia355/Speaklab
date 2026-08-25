import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import { CONTACT_LINKS, OPERATOR_NAME } from "@/app/constants";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "Pilot Terms of Use",
  description: "Interim terms for teachers, students, and schools using the Habla teacher pilot.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <main className="page-wrap legal-page">
      <BrandBar label="Terms" />

      <header className="hero legal-hero">
        <p className="pill">Pilot terms</p>
        <h1>Terms for using Habla</h1>
        <p>
          These interim terms cover the current teacher pilot. They are not a statement that any
          school or district has approved Habla. A signed agreement with a school or district will
          control if it conflicts with these terms.
        </p>
        <p className="meta">Last updated: August 25, 2026</p>
      </header>

      <article className="card legal-document">
        <section className="legal-section" aria-labelledby="terms-acceptance">
          <h2 id="terms-acceptance">Using the pilot</h2>
          <p>
            Adult users accept these terms by creating an account or using Habla. Students use
            Habla at the direction of a teacher or school. If you act for a school, you confirm that
            you have authority to use the pilot for that school and to give the instructions you
            provide to Habla.
          </p>
          <p>Habla is operated by {OPERATOR_NAME}.</p>
          <p>
            Do not use Habla with student information unless the responsible teacher or school has
            decided the use is appropriate and obtained any authorization or consent required by
            its policies and applicable law. Habla is not offered to children for independent
            personal use. School authorization does not waive Habla&apos;s responsibilities for its
            own processing, notices, or required responses to verified data requests.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-service">
          <h2 id="terms-service">What Habla provides</h2>
          <p>
            Habla provides a browser-based workflow for speaking assignments, recordings, rosters,
            teacher review, grading, feedback, and exports. Some deployments may also offer optional
            AI grading and billing. Pilot features can change, be limited, or be temporarily
            unavailable while the service is tested and improved.
          </p>
          <p>
            Habla is not an emergency service, an official student information system, or a
            substitute for a school&apos;s required records. Teachers and schools should keep any
            records their own policies require.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-accounts">
          <h2 id="terms-accounts">Accounts and classroom responsibility</h2>
          <ul>
            <li>Use accurate account information and protect access to the sign-in account.</li>
            <li>Teachers are responsible for their classes, assignments, rosters, and grading.</li>
            <li>
              Students should submit only their own response and use the school account their
              teacher directs them to use.
            </li>
            <li>
              Tell Habla promptly through the <Link href="/feedback">contact form</Link> if you
              believe an account or class has been accessed without permission.
            </li>
          </ul>
        </section>

        <section className="legal-section" aria-labelledby="terms-content">
          <h2 id="terms-content">Your content</h2>
          <p>
            Teachers, students, and schools keep their rights in the content they submit. They give
            Habla permission to host, copy, transmit, process, display, and delete that content only
            as needed to provide, secure, support, and maintain the service, follow their authorized
            instructions, and meet valid legal requirements.
          </p>
          <p>
            Only upload recordings, attachments, instructions, and other content you are authorized
            to use. Do not place payment credentials, medical details, government identifiers, or
            other information unrelated to the speaking assignment in Habla.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-ai">
          <h2 id="terms-ai">Optional AI results</h2>
          <p>
            When AI grading is enabled, configured providers may process a recorded answer,
            transcript, assignment instructions, and rubric and may produce a score, rubric details,
            feedback, and evidence. AI results can be incomplete, inaccurate, or inappropriate for
            a particular classroom. AI-generated results are labeled, and a teacher can review,
            edit, or replace them.
          </p>
          <p>
            Teachers remain responsible for grading decisions and should not rely on an AI result
            as the only basis for a decision that materially affects a student. A teacher or school
            must decide whether AI is authorized before enabling it for student work.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-payments">
          <h2 id="terms-payments">Optional paid features</h2>
          <p>
            Paid functionality is available only when it is enabled and presented to the account.
            The applicable price and usage basis are shown in Habla before payment. A configured
            payment provider handles the payment flow under its own terms and privacy notice; Habla
            does not ask users to put card or bank details in the contact form. Contact Habla about
            a billing error before making another payment.
          </p>
          <p>
            A separate PayPal support link may be available. That link is voluntary support for
            Habla and does not purchase AI access, create a prepaid balance, or start a subscription.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-conduct">
          <h2 id="terms-conduct">Acceptable use</h2>
          <p>You may not:</p>
          <ul>
            <li>Use Habla unlawfully or to harass, exploit, or harm another person.</li>
            <li>Upload content or personal information you are not authorized to provide.</li>
            <li>Try to access another user&apos;s account, class, submission, or private file.</li>
            <li>Probe, bypass, or interfere with security, rate limits, or service availability.</li>
            <li>Use automated traffic that creates an unreasonable load on the pilot.</li>
          </ul>
        </section>

        <section className="legal-section" aria-labelledby="terms-privacy">
          <h2 id="terms-privacy">Privacy and deletion</h2>
          <p>
            The <Link href="/privacy">Pilot Privacy Notice</Link> explains the information Habla
            handles, optional AI processing, current retention behavior, and how to make a request.
            Deleting classroom content begins the current recovery-and-cleanup process described in
            that notice; deleting an account is not yet a self-service feature.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-suspension">
          <h2 id="terms-suspension">Suspension and ending use</h2>
          <p>
            Habla may limit or suspend access when reasonably needed to protect users, investigate
            misuse, comply with legal requirements, or keep the pilot operating. A teacher can stop
            using the service and delete classroom content available through the product. For
            account or school-level closure, contact Habla before the pilot ends so data handling
            instructions can be confirmed.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-reliability">
          <h2 id="terms-reliability">Pilot reliability</h2>
          <p>
            Habla is an early-stage pilot and may contain errors or experience interruptions. No
            online service or AI output is guaranteed to be secure, uninterrupted, or error-free.
            Report problems promptly and keep an independent copy of any school record that must be
            preserved.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-updates">
          <h2 id="terms-updates">Changes and contact</h2>
          <p>
            These terms may be updated as the pilot changes. The latest version and update date will
            remain on this page. Questions, billing concerns, or notices can be sent to{" "}
            <a href={CONTACT_LINKS.email}>davidsgarcia325@gmail.com</a> or through the{" "}
            <Link href="/feedback">Habla contact form</Link>.
          </p>
        </section>
      </article>
    </main>
  );
}

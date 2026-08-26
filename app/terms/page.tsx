import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import { CONTACT_LINKS, OPERATOR_NAME } from "@/app/constants";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "Terms of Use",
  description: "Interim terms for teachers, students, and schools using the TryHabla service.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <main className="page-wrap legal-page">
      <BrandBar label="Terms" />

      <header className="hero legal-hero">
        <p className="pill">Terms of Use</p>
        <h1>Terms for using TryHabla</h1>
        <p>
          These interim terms cover the current TryHabla service. They are not a statement that any
          school or district has approved TryHabla. A signed agreement with a school or district will
          control if it conflicts with these terms.
        </p>
        <p className="meta">Last updated: August 26, 2026</p>
      </header>

      <article className="card legal-document">
        <section className="legal-section" aria-labelledby="terms-acceptance">
          <h2 id="terms-acceptance">Using TryHabla</h2>
          <p>
            Adult users accept these terms by creating an account or using TryHabla. Students use
            TryHabla at the direction of a teacher or school. If you act for a school, you confirm
            that you have authority to use the service for that school and to give the instructions
            you provide to TryHabla.
          </p>
          <p>TryHabla is operated by {OPERATOR_NAME}.</p>
          <p>
            Do not use TryHabla with student information unless the responsible teacher or school has
            decided the use is appropriate and obtained any authorization or consent required by
            its policies and applicable law. TryHabla is not offered to children for independent
            personal use. School authorization does not waive TryHabla&apos;s responsibilities for its
            own processing, notices, or required responses to verified data requests.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-service">
          <h2 id="terms-service">What TryHabla provides</h2>
          <p>
            TryHabla provides a browser-based workflow for speaking assignments, recordings, rosters,
            teacher review, grading, feedback, and exports. Some deployments may also offer optional
            AI transcription, AI grading, and billing. Service features can change, be limited, or
            be temporarily unavailable while the service is tested and improved.
          </p>
          <p>
            TryHabla is not an emergency service, an official student information system, or a
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
              Tell TryHabla promptly through the <Link href="/feedback">contact form</Link> if you
              believe an account or class has been accessed without permission.
            </li>
          </ul>
        </section>

        <section className="legal-section" aria-labelledby="terms-content">
          <h2 id="terms-content">Your content</h2>
          <p>
            Teachers, students, and schools keep their rights in the content they submit. They give
            TryHabla permission to host, copy, transmit, process, display, and delete that content only
            as needed to provide, secure, support, and maintain the service, follow their authorized
            instructions, and meet valid legal requirements.
          </p>
          <p>
            Only upload recordings, attachments, instructions, and other content you are authorized
            to use. Do not place payment credentials, medical details, government identifiers, or
            other information unrelated to the speaking assignment in TryHabla.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-ai">
          <h2 id="terms-ai">Optional AI transcription and results</h2>
          <p>
            When AI transcription or grading is enabled, configured providers may process a recorded
            answer and generate a transcript. A teacher may request transcription individually or in
            a batch, or enable automatic transcription for future submissions to an assignment;
            students are shown when that assignment setting is on. Transcription can be used without AI grading. If a
            teacher requests grading, providers may also process the transcript, assignment
            instructions, and rubric and may produce a score, rubric details, feedback, and evidence.
            Transcripts and AI results can be incomplete, inaccurate, or inappropriate for a
            particular classroom. AI-generated grades and feedback are labeled, and a teacher can
            review, edit, or replace them.
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
            The applicable price and usage basis are shown in TryHabla before payment. Stripe is the
            only product-payment method and handles product checkout under its own terms and privacy
            notice; TryHabla does not ask users to put card or bank details in the contact form.
            Contact TryHabla about a billing error before making another payment.
          </p>
          <p>
            Free includes one lifetime allowance of 30 AI-assisted recordings per teacher account.
            Teacher costs $20 per month and includes 300 AI-assisted recordings in each Stripe
            billing period. One allowance unit is used when TryHabla successfully generates and
            delivers a transcript for a distinct submitted recording. Optional AI grading for that
            same recording and assignment is included and does not use another unit. Provider
            failures, empty or unusable transcripts, and exact retries of the same recording for the
            same assignment do not use another unit. Recordings processed by AI can be up to five
            minutes. Unused units do not roll over, and neither option has automatic overages.
            Reaching an allowance pauses AI transcription and grading while recording, playback,
            downloads, and manual grading remain available.
          </p>
          <p>
            Teachers can review invoices, update payment details, or request cancellation through
            Manage billing. Canceling Teacher stops the next renewal, and access continues through
            the end of the already-paid Stripe billing period. Stripe shows the effective
            cancellation date before confirmation. If Stripe confirmation or access appears
            delayed, contact TryHabla before starting another checkout.
          </p>
          <p>
            TryHabla for Schools is a contact-based option for larger or custom teacher cohorts,
            with scope, review volume, onboarding, and terms agreed directly with the school. It is
            not a self-service plan and does not promise a school administrator console,
            consolidated school billing, or district approval.
          </p>
          <p>
            A separate PayPal link may be available for voluntary, non-tax-deductible donations
            only. A PayPal donation does not purchase TryHabla, activate AI access, start or extend
            a subscription, add AI-assisted recording units, or provide any other product or service.
            TryHabla product billing is handled only through Stripe.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-drive">
          <h2 id="terms-drive">Optional Google Drive export</h2>
          <p>
            When enabled, a teacher can direct TryHabla to export a selected transcript or original
            recording to a TryHabla folder in the teacher&apos;s or school&apos;s Google Drive. This feature
            uses the limited <code>drive.file</code> permission and does not authorize TryHabla to
            read the user&apos;s entire Drive. A short-lived access token is held only in browser memory;
            TryHabla does not store a Google Drive refresh token.
          </p>
          <p>
            The teacher or school controls exported copies under its Google account and policies.
            Those copies remain independently in Google Drive until an authorized user deletes them,
            and deleting content from TryHabla does not remove a previously exported copy. TryHabla
            does not promise permanent storage, so teachers and schools remain responsible for any
            records their own policies require.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-conduct">
          <h2 id="terms-conduct">Acceptable use</h2>
          <p>You may not:</p>
          <ul>
            <li>Use TryHabla unlawfully or to harass, exploit, or harm another person.</li>
            <li>Upload content or personal information you are not authorized to provide.</li>
            <li>Try to access another user&apos;s account, class, submission, or private file.</li>
            <li>Probe, bypass, or interfere with security, rate limits, or service availability.</li>
            <li>Use automated traffic that creates an unreasonable load on the service.</li>
          </ul>
        </section>

        <section className="legal-section" aria-labelledby="terms-privacy">
          <h2 id="terms-privacy">Privacy and deletion</h2>
          <p>
            The <Link href="/privacy">Privacy Notice</Link> explains the information TryHabla
            handles, optional AI processing, current retention behavior, and how to make a request.
            Deleting classroom content begins the current recovery-and-cleanup process described in
            that notice; deleting an account is not yet a self-service feature.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-suspension">
          <h2 id="terms-suspension">Suspension and ending use</h2>
          <p>
            TryHabla may limit or suspend access when reasonably needed to protect users, investigate
            misuse, comply with legal requirements, or keep the service operating. A teacher can stop
            using the service and delete classroom content available through the product. For
            account or school-level closure, contact TryHabla before ending use so data handling
            instructions can be confirmed.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-reliability">
          <h2 id="terms-reliability">Service reliability</h2>
          <p>
            TryHabla is an early-stage service and may contain errors or experience interruptions. No
            online service or AI output is guaranteed to be secure, uninterrupted, or error-free.
            Report problems promptly and keep an independent copy of any school record that must be
            preserved.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="terms-updates">
          <h2 id="terms-updates">Changes and contact</h2>
          <p>
            These terms may be updated as the service changes. The latest version and update date will
            remain on this page. Questions, billing concerns, or notices can be sent to{" "}
            <a href={CONTACT_LINKS.email}>davidsgarcia325@gmail.com</a> or through the{" "}
            <Link href="/feedback">TryHabla contact form</Link>.
          </p>
        </section>
      </article>
    </main>
  );
}

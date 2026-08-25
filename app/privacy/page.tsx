import Link from "next/link";
import BrandBar from "@/app/components/BrandBar";
import { CONTACT_LINKS } from "@/app/constants";
import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "Pilot Privacy Notice",
  description:
    "How Habla collects, uses, shares, retains, and handles information during its teacher pilot.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <main className="page-wrap legal-page">
      <BrandBar label="Privacy" />

      <header className="hero legal-hero">
        <p className="pill">Pilot notice</p>
        <h1>Privacy at Habla</h1>
        <p>
          This plain-language notice describes the current Habla teacher pilot. It is not a claim
          that a school or district has approved Habla, and a signed school or district agreement
          may add different instructions.
        </p>
        <p className="meta">Last updated: August 25, 2026</p>
      </header>

      <article className="card legal-document">
        <section className="legal-section" aria-labelledby="privacy-scope">
          <h2 id="privacy-scope">Who this notice covers</h2>
          <p>
            This notice applies to teachers, students, and other people who use Habla or contact us.
            Habla is designed for teacher-directed speaking assignments. It is not offered to
            children for independent personal use.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="privacy-data">
          <h2 id="privacy-data">Information Habla handles</h2>
          <p>The information depends on how the pilot is used and can include:</p>
          <ul>
            <li>
              <strong>Account information:</strong> name, email address, sign-in provider profile,
              role, and authentication/session information.
            </li>
            <li>
              <strong>Classroom information:</strong> class and roster membership, assignment
              titles, instructions, rubrics, target language, and teacher-uploaded attachments.
            </li>
            <li>
              <strong>Submission information:</strong> a student-entered name, account email,
              audio recording, submission time, grade, rubric score, and teacher feedback.
            </li>
            <li>
              <strong>Support and operations information:</strong> contact-form messages, basic
              activity events, request information used for security and rate limiting, and local
              browser settings such as theme or dismissed notices.
            </li>
            <li>
              <strong>Billing information, only when paid features are used:</strong> billing
              status, usage totals, and identifiers returned by the configured payment provider.
              Payment providers handle payment credentials on their own sites or checkout pages.
            </li>
          </ul>
        </section>

        <section className="legal-section" aria-labelledby="privacy-ai">
          <h2 id="privacy-ai">Optional AI grading</h2>
          <p>
            AI grading is optional and controlled by deployment settings and teacher actions. When it is
            enabled for an assignment, a student&apos;s recorded answer, transcript, assignment
            instructions, and rubric may be processed by the AI service provider or providers
            configured for that Habla deployment. Habla may store the transcript, AI-generated
            score, rubric details, feedback, evidence excerpts, provider and model identifiers,
            usage details, and attempt status with the submission.
          </p>
          <p>
            AI-generated results are labeled and may be shown to the student before a teacher
            reviews them. Teachers can review, edit, or replace a result. Habla does not promise
            that an AI result is accurate, and teachers remain responsible for classroom grading
            decisions. The teacher or school is responsible for deciding whether AI is authorized
            for the activity. That decision does not remove Habla&apos;s responsibility for its own
            processing and notices.
          </p>
          <p>
            As of this notice&apos;s update date, the production pilot identifies OpenAI as its
            transcription and grading provider, with requests potentially routed through Vercel AI
            Gateway. Habla does not promise a particular provider retention mode; schools can ask
            for the current configuration and provider-control status before authorizing AI use.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="privacy-use">
          <h2 id="privacy-use">Why Habla uses information</h2>
          <ul>
            <li>Authenticate users and provide the teacher and student classroom workflows.</li>
            <li>Store, play back, grade, and display speaking submissions.</li>
            <li>Operate optional AI grading and metering when those features are enabled.</li>
            <li>Prevent abuse, enforce limits, troubleshoot problems, and secure the service.</li>
            <li>Respond to support messages and understand basic pilot activity.</li>
          </ul>
        </section>

        <section className="legal-section" aria-labelledby="privacy-sharing">
          <h2 id="privacy-sharing">Who information may be shared with</h2>
          <p>
            The application uses service providers to operate. Depending on deployment settings,
            these can include Google or Microsoft for sign-in; Vercel for hosting and file storage;
            Turso for the application database; Upstash for rate limiting; Resend or an operational
            notification service for messages; Stripe or PayPal for optional payments; and
            configured AI infrastructure and model providers when AI is enabled.
          </p>
          <p>
            Classroom information is made available in the application to the student who owns a
            submission and the teacher who owns the class, as appropriate. The Habla operator and
            service providers may also handle information where needed to operate, secure, support,
            or comply with valid legal requirements. Habla does not provide a student-to-student
            recording-sharing feature.
          </p>
          <p>
            Which optional providers are active, their processing locations, and their own log or
            backup schedules depend on the production configuration. A school can{" "}
            <Link href="/feedback">ask for the current deployment details</Link> before approving a
            pilot.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="privacy-retention">
          <h2 id="privacy-retention">Retention and deletion</h2>
          <p>
            Active classes, assignments, submissions, recordings, grades, and feedback remain while
            they are needed for the classroom workflow. When an authorized user deletes a class,
            assignment, or submission, Habla currently keeps the soft-deleted record for a 30-day
            recovery period. After that, the scheduled cleanup hard-deletes the database record and
            attempts to delete associated media.
          </p>
          <p>
            AI attempt records follow the related submission. Contact messages remain until an
            administrator deletes them. Account records and basic activity events do not yet have
            an automatic deletion schedule. Service-provider logs and backups may follow separate
            schedules that are still being verified for district use.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="privacy-choices">
          <h2 id="privacy-choices">Access, correction, and deletion requests</h2>
          <p>
            Teachers can delete the classes, assignments, and submissions they control. Students
            can delete their own submissions from the student dashboard. For an account, roster,
            support-message, access, correction, export, or other deletion request, email{" "}
            <a href={CONTACT_LINKS.email}>davidsgarcia325@gmail.com</a>. We may need to verify the
            requester and coordinate requests about school-managed student data with the school.
            Parents and guardians should normally begin with the student&apos;s school.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="privacy-minors">
          <h2 id="privacy-minors">Students and school authorization</h2>
          <p>
            Students, including minors, should use Habla only for a teacher- or school-directed
            activity. The teacher or school must decide whether the service and any optional AI use
            are appropriate and obtain any authorization or consent its policies and applicable law
            require. Habla remains responsible for its own legal obligations and for responding to
            verified requests it is required to handle. A public Habla page does not establish
            district approval.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="privacy-security">
          <h2 id="privacy-security">Security and updates</h2>
          <p>
            Habla uses measures such as authenticated sessions, role and class-ownership checks,
            input validation, access-controlled media routes, rate limiting when configured, and
            scheduled deletion. No online service can guarantee absolute security. Pilot controls,
            providers, and this notice may change; material updates will be posted here with a new
            date.
          </p>
        </section>

        <section className="legal-section legal-contact" aria-labelledby="privacy-contact">
          <h2 id="privacy-contact">Contact</h2>
          <p>
            Questions about this notice or a data request can be sent to{" "}
            <a href={CONTACT_LINKS.email}>davidsgarcia325@gmail.com</a> or through the{" "}
            <Link href="/feedback">Habla contact form</Link>.
          </p>
        </section>
      </article>
    </main>
  );
}

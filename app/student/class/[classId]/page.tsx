import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, MessageSquareText, Mic2 } from "lucide-react";
import { authOptions } from "@/auth";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import { listEnrolledClassesWithAssignmentsByEmail, listSubmissionsByStudentEmail } from "@/lib/db";

type StudentClassPageProps = {
  params: Promise<{ classId: string }>;
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function StudentClassPage({ params }: StudentClassPageProps) {
  const { classId } = await params;
  const session = await getServerSession(authOptions);
  const localAuthBypassEnabled =
    process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true";
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const email = sessionEmail || (localAuthBypassEnabled ? "dev-student@gmail.com" : "");

  if (!email) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/student/class/${classId}`)}`);

  const [enrolledRows, submissions] = await Promise.all([
    listEnrolledClassesWithAssignmentsByEmail(email),
    listSubmissionsByStudentEmail(email),
  ]);
  const classRows = enrolledRows.filter((row) => row.classId === classId);
  if (classRows.length === 0) notFound();

  const assignmentIds = new Set(
    classRows.flatMap((row) => (row.assignmentId ? [row.assignmentId] : [])),
  );
  const latestSubmissionByAssignment = new Map<string, (typeof submissions)[number]>();
  for (const submission of submissions) {
    if (assignmentIds.has(submission.assignmentId) && !latestSubmissionByAssignment.has(submission.assignmentId)) {
      latestSubmissionByAssignment.set(submission.assignmentId, submission);
    }
  }

  const assignments = classRows.flatMap((row) =>
    row.assignmentId && row.assignmentTitle
      ? [{
          id: row.assignmentId,
          title: row.assignmentTitle,
          maxPoints: row.maxPoints,
          submissionCount: row.submissionCount,
          latestSubmission: latestSubmissionByAssignment.get(row.assignmentId) ?? null,
        }]
      : [],
  );
  const className = classRows[0].className;
  const submittedCount = assignments.filter((assignment) => assignment.submissionCount > 0).length;

  return (
    <main className="page-wrap student-class-wrap">
      <PageTitle title={className} />
      <BrandBar label="Student" />

      <section className="student-class-header">
        <span className="student-header-echo" aria-hidden="true">Assignments</span>
        <div>
          <Link className="student-back-link" href="/student/dashboard">
            <ArrowLeft size={16} aria-hidden="true" />
            My Classes
          </Link>
          <h1>{className}</h1>
          <p className="meta">
            {assignments.length} {assignments.length === 1 ? "assignment" : "assignments"} · {submittedCount} submitted
          </p>
        </div>
        <Image
          className="student-class-mascot"
          src="/mascot/hablaman-student-class-guide-v1.png"
          alt=""
          width={1254}
          height={1254}
          priority
        />
      </section>

      {assignments.length === 0 ? (
        <section className="student-class-empty">
          <h2>No assignments yet</h2>
          <p className="meta">No assignments have been posted to this class yet.</p>
        </section>
      ) : (
        <section className="student-assignment-list" aria-label={`${className} assignments`}>
          {assignments.map((assignment, index) => {
            const submission = assignment.latestSubmission;
            const submitted = assignment.submissionCount > 0;
            return (
              <article className={`student-assignment-row ${submitted ? "is-submitted" : "is-ready"}`} key={assignment.id}>
                <div className="student-assignment-row-main">
                  <span className="student-assignment-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="student-assignment-row-icon" aria-hidden="true">
                    {submitted ? <CheckCircle2 size={20} /> : <Mic2 size={20} />}
                  </span>
                  <div>
                    <p className="student-assignment-row-status">
                      {submitted ? "Submitted" : "Ready to record"}
                    </p>
                    <h2>{assignment.title}</h2>
                    <p className="meta">
                      {assignment.maxPoints} points
                      {submission ? ` · Last submitted ${formatDate(submission.submittedAt)}` : ""}
                    </p>
                  </div>
                </div>

                {submission?.grade !== null && submission?.grade !== undefined ? (
                  <span className="student-grade-chip">{submission.grade}/{assignment.maxPoints}</span>
                ) : submitted ? (
                  <span className="pill pill-warning"><Clock3 size={14} aria-hidden="true" /> Awaiting review</span>
                ) : null}

                {submission?.feedback ? (
                  <div className="student-feedback-preview">
                    <MessageSquareText size={17} aria-hidden="true" />
                    <p><strong>Feedback:</strong> {submission.feedback}</p>
                  </div>
                ) : null}

                <Link
                  className="btn btn-ghost btn-sm student-assignment-open"
                  href={`/a/${assignment.id}`}
                  aria-label={`${submitted ? "Open" : "Start"} ${assignment.title}`}
                >
                  {submitted ? "Open" : "Start"}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}

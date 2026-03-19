import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import BrandBar from "@/app/components/BrandBar";
import PageTitle from "@/app/components/PageTitle";
import { listSubmissionsByStudentEmail } from "@/lib/db";

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function gradeDisplay(grade: number | null, maxPoints: number) {
  if (grade === null) return { text: "Pending", tone: "pill-warning" };
  return { text: `${grade}/${maxPoints}`, tone: "pill-success" };
}

export default async function StudentDashboardPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) {
    return (
      <main className="page-wrap">
        <PageTitle title="My submissions" />
        <BrandBar label="Student" />
        <section className="hero">
          <h1>Sign in to view your submissions</h1>
          <p>After you sign in, you can see all your recordings, grades, and feedback in one place.</p>
          <div className="actions hero-actions">
            <Link className="btn btn-primary" href="/api/auth/signin?callbackUrl=/student">
              Sign in
            </Link>
            <Link className="btn btn-ghost" href="/">
              Back home
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const submissions = await listSubmissionsByStudentEmail(email);
  const name = session?.user?.name || email.split("@")[0];
  const gradedCount = submissions.filter((s) => s.grade !== null).length;
  const pendingCount = submissions.length - gradedCount;

  return (
    <main className="page-wrap">
      <PageTitle title="My submissions" />
      <BrandBar label="Student" />

      <section className="student-dash-header">
        <div>
          <h1 className="student-dash-headline">Hi, {name}</h1>
          <p className="meta">Signed in as {email}</p>
        </div>
        <div className="actions">
          <Link className="btn btn-ghost" href="/">Back home</Link>
          <Link className="btn btn-ghost" href="/api/auth/signout?callbackUrl=/">Sign out</Link>
        </div>
      </section>

      <section className="grid cols-3 section-gap">
        <article className="card kpi-card">
          <p className="meta stat-label">Submitted</p>
          <p className="stat-value">{submissions.length}</p>
          <p className="meta kpi-note">Total recordings</p>
        </article>
        <article className="card kpi-card kpi-success">
          <p className="meta stat-label">Graded</p>
          <p className="stat-value">{gradedCount}</p>
          <p className="meta kpi-note">Scores available</p>
        </article>
        <article className="card kpi-card kpi-warning">
          <p className="meta stat-label">Pending</p>
          <p className="stat-value">{pendingCount}</p>
          <p className="meta kpi-note">Awaiting review</p>
        </article>
      </section>

      {submissions.length === 0 ? (
        <section className="card section-gap">
          <h2 className="surface-title">No submissions yet</h2>
          <p className="empty">
            When your teacher shares an assignment link, open it to record and submit your response.
            Your submissions will appear here.
          </p>
        </section>
      ) : (
        <section className="section-gap">
          <h2 className="surface-title" style={{ marginBottom: "0.6rem" }}>Your submissions</h2>
          <div className="grid student-submission-list">
            {submissions.map((sub) => {
              const grade = gradeDisplay(sub.grade, sub.maxPoints);
              return (
                <article key={sub.id} className="card student-submission-card">
                  <div className="student-sub-top">
                    <div className="student-sub-info">
                      <p className="student-sub-title">{sub.assignmentTitle}</p>
                      <p className="meta">{sub.className}</p>
                    </div>
                    <span className={`pill ${grade.tone}`}>{grade.text}</span>
                  </div>
                  <div className="student-sub-details">
                    <p className="meta">Submitted {formatDate(sub.submittedAt)}</p>
                    {sub.feedback ? (
                      <div className="student-sub-feedback">
                        <p className="label" style={{ marginBottom: "0.2rem", fontSize: "0.84rem" }}>
                          Teacher feedback
                        </p>
                        <p className="meta">{sub.feedback}</p>
                      </div>
                    ) : sub.grade !== null ? (
                      <p className="meta" style={{ fontStyle: "italic" }}>No written feedback</p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

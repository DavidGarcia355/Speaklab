import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import BrandBar from "@/app/components/BrandBar";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";
import PageTitle from "@/app/components/PageTitle";
import { listEnrolledClassesWithAssignmentsByEmail, type StudentEnrolledRow } from "@/lib/db";

type EnrolledClass = {
  classId: string;
  className: string;
  assignments: {
    assignmentId: string;
    assignmentTitle: string;
    maxPoints: number;
    submissionCount: number;
  }[];
};

function groupEnrolledRows(rows: StudentEnrolledRow[]): EnrolledClass[] {
  const classMap = new Map<string, EnrolledClass>();
  const classOrder: string[] = [];

  for (const row of rows) {
    if (!classMap.has(row.classId)) {
      classMap.set(row.classId, {
        classId: row.classId,
        className: row.className,
        assignments: [],
      });
      classOrder.push(row.classId);
    }
    if (row.assignmentId !== null && row.assignmentTitle !== null) {
      classMap.get(row.classId)!.assignments.push({
        assignmentId: row.assignmentId,
        assignmentTitle: row.assignmentTitle,
        maxPoints: row.maxPoints,
        submissionCount: row.submissionCount,
      });
    }
  }

  return classOrder.map((id) => classMap.get(id)!);
}

export default async function StudentDashboardPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase() ?? "";
  const name = session?.user?.name?.trim() ?? email.split("@")[0] ?? "";

  if (!email) {
    return (
      <main className="page-wrap">
        <PageTitle title="My Classes" />
        <BrandBar label="Student" />
        <section className="hero">
          <h1>Sign in to see your classes</h1>
          <p>
            Once your teacher adds you to a class roster, sign in to see your assignments and
            submit recordings without needing a direct link.
          </p>
          <div className="actions hero-actions">
            <GoogleSignInLink className="btn btn-primary" callbackUrl="/student/dashboard">
              Sign in
            </GoogleSignInLink>
            <Link className="btn btn-ghost" href="/">
              Back home
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const rows = await listEnrolledClassesWithAssignmentsByEmail(email);
  const classes = groupEnrolledRows(rows);

  const totalAssignments = classes.reduce((sum, c) => sum + c.assignments.length, 0);
  const submittedCount = classes.reduce(
    (sum, c) => sum + c.assignments.filter((a) => a.submissionCount > 0).length,
    0
  );
  const pendingCount = totalAssignments - submittedCount;

  return (
    <main className="page-wrap">
      <PageTitle title="My Classes" />
      <BrandBar label="Student" />

      <section className="student-dash-header">
        <div>
          <h1 className="student-dash-headline">Hi, {name}</h1>
          <p className="meta">Signed in as {email}</p>
        </div>
        <div className="actions">
          <Link className="btn btn-ghost" href="/student">My submissions</Link>
          <Link className="btn btn-ghost" href="/api/auth/signout?callbackUrl=/">Sign out</Link>
        </div>
      </section>

      {classes.length > 0 ? (
        <section className="grid cols-3 section-gap">
          <article className="card kpi-card">
            <p className="meta stat-label">Classes</p>
            <p className="stat-value">{classes.length}</p>
            <p className="meta kpi-note">Enrolled</p>
          </article>
          <article className="card kpi-card kpi-warning">
            <p className="meta stat-label">Pending</p>
            <p className="stat-value">{pendingCount}</p>
            <p className="meta kpi-note">Not yet submitted</p>
          </article>
          <article className="card kpi-card kpi-success">
            <p className="meta stat-label">Submitted</p>
            <p className="stat-value">{submittedCount}</p>
            <p className="meta kpi-note">Recordings turned in</p>
          </article>
        </section>
      ) : null}

      {classes.length === 0 ? (
        <section className="card section-gap">
          <h2 className="surface-title">No classes yet</h2>
          <p className="empty">
            You&apos;re not on any class rosters yet. Ask your teacher to add{" "}
            <strong>{email}</strong> to their class, or open the assignment link they shared
            with you directly.
          </p>
          <div className="actions">
            <Link className="btn btn-ghost" href="/student">View my submissions</Link>
            <Link className="btn btn-ghost" href="/">Back home</Link>
          </div>
        </section>
      ) : (
        classes.map((cls) => (
          <section key={cls.classId} className="section-gap">
            <h2 className="student-class-heading">{cls.className}</h2>
            {cls.assignments.length === 0 ? (
              <div className="card">
                <p className="empty">No assignments yet. Check back after your teacher posts one.</p>
              </div>
            ) : (
              cls.assignments.map((asg) => (
                <div key={asg.assignmentId} className="student-assignment-group">
                  <div className="student-assignment-header">
                    <div>
                      <h3 className="student-assignment-title">{asg.assignmentTitle}</h3>
                      <p className="meta">{asg.maxPoints} points</p>
                    </div>
                    <div className="actions">
                      {asg.submissionCount > 0 ? (
                        <span className="pill pill-success">Submitted</span>
                      ) : (
                        <span className="pill pill-neutral">Not submitted</span>
                      )}
                      <Link className="btn btn-ghost btn-sm" href={`/a/${asg.assignmentId}`}>
                        {asg.submissionCount > 0 ? "Reopen" : "Start recording"}
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>
        ))
      )}
    </main>
  );
}

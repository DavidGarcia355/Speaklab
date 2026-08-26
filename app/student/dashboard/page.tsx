import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Image from "next/image";
import { ArrowRight, BookOpenCheck, CircleCheck, Clock3, School, Sparkles } from "lucide-react";
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
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (email && role === "teacher") {
    redirect("/teacher");
  }

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
    <main className="page-wrap student-game-wrap">
      <PageTitle title="My Classes" />
      <BrandBar label="Student" />

      <section className="student-game-hero">
        <div className="student-game-copy">
          <p className="pill student-game-pill">
            <Sparkles size={14} aria-hidden="true" />
            Student workspace
          </p>
          <h1>Hi, {name}. Your speaking assignments are here.</h1>
          <p>
            Open work from every class, record in the browser, and see what you have already
            submitted without hunting through old links.
          </p>
          <div className="student-game-actions">
            <Link className="btn btn-primary" href="/student">
              Open vault
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="student-text-link" href="/api/auth/signout?callbackUrl=/">Sign out</Link>
          </div>
        </div>
        <div className="student-hablaman-card" aria-label="TryHabla mascot status">
          <span className="student-hablaman-burst">H</span>
          <Image
            className="student-hablaman"
            src="/mascot/habla-man.webp"
            alt="TryHabla superhero mascot"
            width={330}
            height={328}
            priority
          />
          <div className="student-hablaman-speech">
            <strong>{submittedCount}/{totalAssignments} submitted</strong>
            <span>{pendingCount > 0 ? `${pendingCount} ready to record` : "All caught up"}</span>
          </div>
        </div>
      </section>

      {classes.length > 0 ? (
        <section className="student-reward-console section-gap" aria-label="Assignment progress">
          <article className="student-level-card">
            <div>
              <p className="student-console-label">
                <School size={14} aria-hidden="true" />
                Classes
              </p>
              <p className="student-level-value">{classes.length}</p>
              <p className="meta">Rostered classrooms</p>
            </div>
          </article>
          <article className="student-console-card">
            <p className="student-console-label">
              <CircleCheck size={14} aria-hidden="true" />
              Submitted
            </p>
            <p className="student-console-value">{submittedCount}</p>
            <p className="meta">Assignments with a recording</p>
          </article>
          <article className="student-console-card student-console-fire">
            <p className="student-console-label">
              <Clock3 size={14} aria-hidden="true" />
              To record
            </p>
            <p className="student-console-value">{pendingCount}</p>
            <p className="meta">{pendingCount > 0 ? "Assignments ready to open" : "All caught up"}</p>
          </article>
        </section>
      ) : null}

      {classes.length === 0 ? (
        <section className="student-empty-quest section-gap">
          <Image
            src="/mascot/habla-man.webp"
            alt="TryHabla mascot waiting for your first class"
            width={190}
            height={188}
          />
          <div>
            <p className="pill pill-subtle">Class list empty</p>
            <h2 className="surface-title">No classes yet</h2>
          </div>
          <p className="empty">
            You&apos;re not on any class rosters yet. Ask your teacher to add{" "}
            <strong>{email}</strong> to their class, or open the assignment link they shared
            with you directly.
          </p>
          <div className="student-inline-links">
            <Link className="student-text-link" href="/student">View submissions</Link>
            <Link className="student-text-link" href="/">Back home</Link>
          </div>
        </section>
      ) : (
        classes.map((cls) => (
          <section key={cls.classId} className="student-quest-section section-gap">
            <h2 className="student-class-heading">{cls.className}</h2>
            {cls.assignments.length === 0 ? (
              <div className="student-quest-card is-empty">
                <p className="empty">No assignments yet. Check back after your teacher posts one.</p>
              </div>
            ) : (
              cls.assignments.map((asg) => (
                <div key={asg.assignmentId} className={`student-assignment-group student-quest-card ${asg.submissionCount > 0 ? "is-complete" : "is-live"}`}>
                  <div className="student-assignment-header">
                    <div>
                      <p className="student-quest-label">{asg.submissionCount > 0 ? "Submitted" : "Ready to record"}</p>
                      <h3 className="student-assignment-title">{asg.assignmentTitle}</h3>
                      <p className="meta">{asg.maxPoints} points possible</p>
                    </div>
                    <div className="student-quest-actions">
                      {asg.submissionCount > 0 ? (
                        <span className="pill pill-success">
                          <BookOpenCheck size={14} aria-hidden="true" />
                          Submitted
                        </span>
                      ) : (
                        <span className="pill pill-neutral">Ready</span>
                      )}
                      <Link className="btn btn-ghost btn-sm" href={`/a/${asg.assignmentId}`}>
                        {asg.submissionCount > 0 ? "View assignment" : "Start recording"}
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

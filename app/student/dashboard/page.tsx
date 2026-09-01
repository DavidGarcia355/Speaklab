import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Image from "next/image";
import { ArrowRight, BookOpen, CircleCheck, Sparkles } from "lucide-react";
import { authOptions } from "@/auth";
import BrandBar from "@/app/components/BrandBar";
import SignInLink from "@/app/components/SignInLink";
import PageTitle from "@/app/components/PageTitle";
import { listEnrolledClassesWithAssignmentsByEmail, type StudentEnrolledRow } from "@/lib/db";
import hubStyles from "../student-hubs.module.css";

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
  const localAuthBypassEnabled =
    process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true";
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const email = sessionEmail || (localAuthBypassEnabled ? "dev-student@gmail.com" : "");
  const name =
    session?.user?.name?.trim() ||
    (sessionEmail ? sessionEmail.split("@")[0] : localAuthBypassEnabled ? "dev-student" : "");
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
            <SignInLink className="btn btn-primary" callbackUrl="/student/dashboard">
              Sign in
            </SignInLink>
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

  return (
    <main className="page-wrap student-home-wrap">
      <PageTitle title="My Classes" />
      <BrandBar label="Student" />

      <section className={`student-home-header ${hubStyles.classesHero}`}>
        <span className="student-header-echo" aria-hidden="true">Classes</span>
        <div>
          <p className="pill student-game-pill">
            <Sparkles size={14} aria-hidden="true" />
            Student workspace
          </p>
          <h1>My Classes</h1>
          <p className="meta">Hi, {name}. Pick a class to see its assignments and feedback.</p>
        </div>
        <div className={`student-home-actions ${hubStyles.classesVisual}`}>
          <div className={`student-home-links ${hubStyles.hubLinks}`}>
            <Link className="student-text-link" href="/student">My Recordings</Link>
            <Link className="student-text-link" href="/api/auth/signout?callbackUrl=/">Sign out</Link>
          </div>
          <Image
            className={hubStyles.oceanMascot}
            src="/mascot/hablaman-student-classes-eren-v1.png"
            alt=""
            width={1672}
            height={941}
            sizes="(max-width: 520px) 225px, (max-width: 720px) 265px, 500px"
            priority
          />
        </div>
      </section>

      {classes.length === 0 ? (
        <section className="student-empty-quest student-home-empty section-gap">
          <div className="student-empty-mark" aria-hidden="true">
            <BookOpen size={34} />
          </div>
          <div className="student-empty-copy">
            <div>
              <p className="pill pill-subtle">Class list empty</p>
              <h2 className="surface-title">No classes yet</h2>
            </div>
            <p className="empty">
              No class rosters include this account yet. Ask a teacher to add{" "}
              <strong>{email}</strong> to a class, or open a shared assignment link directly.
            </p>
            <div className="student-inline-links">
              <Link className="student-text-link" href="/student">My Recordings</Link>
              <Link className="student-text-link" href="/">Back home</Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="student-class-list section-gap" aria-label="My Classes">
          {classes.map((cls, index) => {
            const completed = cls.assignments.filter((assignment) => assignment.submissionCount > 0).length;
            return (
              <Link className="student-class-row" href={`/student/class/${cls.classId}`} key={cls.classId}>
                <span className="student-class-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="student-class-row-icon" aria-hidden="true"><BookOpen size={21} /></span>
                <span className="student-class-row-copy">
                  <strong>{cls.className}</strong>
                  <span>
                    {cls.assignments.length} {cls.assignments.length === 1 ? "assignment" : "assignments"}
                    {cls.assignments.length > 0 ? ` · ${completed} submitted` : ""}
                  </span>
                </span>
                {completed === cls.assignments.length && cls.assignments.length > 0 ? (
                  <span className="pill pill-success"><CircleCheck size={14} aria-hidden="true" /> Complete</span>
                ) : null}
                <ArrowRight size={20} aria-hidden="true" />
              </Link>
            );
          })}
          <p className="student-home-summary meta">
            {classes.length} {classes.length === 1 ? "class" : "classes"} · {submittedCount}/{totalAssignments} assignments submitted
          </p>
        </section>
      )}
    </main>
  );
}

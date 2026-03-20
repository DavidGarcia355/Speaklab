"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import ConfirmModal from "@/app/components/ConfirmModal";
import GoogleSignInLink from "@/app/components/GoogleSignInLink";
import PageTitle from "@/app/components/PageTitle";

type StudentSubmission = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  maxPoints: number;
  studentName: string;
  submittedAt: number;
  feedback: string;
  grade: number | null;
};

type StudentAssignmentHistory = {
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  maxPoints: number;
};

type SessionResponse = {
  user?: {
    name?: string | null;
    email?: string | null;
  };
};

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

type GroupedClass = {
  className: string;
  assignments: {
    assignmentId: string;
    assignmentTitle: string;
    maxPoints: number;
    submissions: StudentSubmission[];
  }[];
};

function groupByClass(
  assignments: StudentAssignmentHistory[],
  submissions: StudentSubmission[]
): GroupedClass[] {
  const classMap = new Map<
    string,
    Map<string, { assignmentId: string; assignmentTitle: string; maxPoints: number; submissions: StudentSubmission[] }>
  >();
  const classOrder: string[] = [];
  const assignmentOrder = new Map<string, string[]>();

  function ensureAssignment(
    className: string,
    assignmentId: string,
    assignmentTitle: string,
    maxPoints: number
  ) {
    if (!classMap.has(className)) {
      classMap.set(className, new Map());
      classOrder.push(className);
      assignmentOrder.set(className, []);
    }

    const aMap = classMap.get(className)!;
    if (!aMap.has(assignmentId)) {
      aMap.set(assignmentId, {
        assignmentId,
        assignmentTitle,
        maxPoints,
        submissions: [],
      });
      assignmentOrder.get(className)!.push(assignmentId);
    }
  }

  for (const assignment of assignments) {
    ensureAssignment(
      assignment.className,
      assignment.assignmentId,
      assignment.assignmentTitle,
      assignment.maxPoints
    );
  }

  for (const sub of submissions) {
    ensureAssignment(sub.className, sub.assignmentId, sub.assignmentTitle, sub.maxPoints);
    classMap.get(sub.className)!.get(sub.assignmentId)!.submissions.push(sub);
  }

  return classOrder.map((className) => {
    const aMap = classMap.get(className)!;
    const aOrder = assignmentOrder.get(className)!;
    return {
      className,
      assignments: aOrder.map((assignmentId) => aMap.get(assignmentId)!),
    };
  });
}

export default function StudentDashboardPage() {
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [assignmentHistory, setAssignmentHistory] = useState<StudentAssignmentHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<StudentSubmission | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function loadSession() {
      setAuthLoading(true);
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as SessionResponse | null;
        const userEmail = data?.user?.email?.trim().toLowerCase() ?? "";
        const userName = data?.user?.name?.trim() ?? "";
        setEmail(userEmail);
        setName(userName || (userEmail ? userEmail.split("@")[0] : ""));
      } catch {
        setEmail("");
      } finally {
        setAuthLoading(false);
      }
    }
    void loadSession();
  }, []);

  useEffect(() => {
    if (!email) {
      setLoading(false);
      return;
    }
    async function loadSubmissions() {
      setLoading(true);
      try {
        const response = await fetch("/api/student/submissions", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as {
          items: StudentSubmission[];
          assignments: StudentAssignmentHistory[];
        };
        setSubmissions(data.items);
        setAssignmentHistory(data.assignments);
      } catch {
        setErrorMsg("Unable to load submissions.");
      } finally {
        setLoading(false);
      }
    }
    void loadSubmissions();
  }, [email]);

  async function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      const response = await fetch(`/api/student/submissions/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to delete submission.");
      }
      setSubmissions((prev) => prev.filter((s) => s.id !== id));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Unable to delete submission.");
    }
  }

  if (authLoading) {
    return (
      <main className="page-wrap">
        <PageTitle title="My submissions" />
        <BrandBar label="Student" />
        <p className="meta">Loading...</p>
      </main>
    );
  }

  if (!email) {
    return (
      <main className="page-wrap">
        <PageTitle title="My submissions" />
        <BrandBar label="Student" />
        <section className="hero">
          <h1>Sign in to view your submissions</h1>
          <p>After you sign in, you can see all your recordings, grades, and feedback in one place.</p>
          <div className="actions hero-actions">
            <GoogleSignInLink className="btn btn-primary" callbackUrl="/student">
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

  const gradedCount = submissions.filter((s) => s.grade !== null).length;
  const pendingCount = submissions.length - gradedCount;
  const grouped = groupByClass(assignmentHistory, submissions);

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

      {errorMsg ? <p className="notice danger">{errorMsg}</p> : null}

      {loading ? (
        <p className="meta">Loading submissions...</p>
      ) : grouped.length === 0 ? (
        <section className="card section-gap">
          <h2 className="surface-title">No submissions yet</h2>
          <p className="empty">
            When your teacher shares an assignment link, open it to record and submit your response.
            Your submissions will appear here.
          </p>
        </section>
      ) : (
        grouped.map((group) => (
          <section key={group.className} className="section-gap">
            <h2 className="student-class-heading">{group.className}</h2>
            {group.assignments.map((asg) => (
              <div key={asg.assignmentId} className="student-assignment-group">
                <div className="student-assignment-header">
                  <h3 className="student-assignment-title">{asg.assignmentTitle}</h3>
                  <Link className="btn btn-ghost btn-sm" href={`/a/${asg.assignmentId}`}>
                    Open assignment
                  </Link>
                </div>
                {asg.submissions.length === 0 ? (
                  <article className="card student-assignment-empty">
                    <p className="meta">No submissions saved right now.</p>
                    <p className="empty">This assignment stays here so you can reopen it and submit again if needed.</p>
                  </article>
                ) : (
                  <div className="grid student-submission-list">
                    {asg.submissions.map((sub) => {
                      const grade = gradeDisplay(sub.grade, sub.maxPoints);
                      return (
                        <article key={sub.id} className="card student-submission-card">
                          <div className="student-sub-top">
                            <div className="student-sub-info">
                              <p className="meta">Submitted {formatDate(sub.submittedAt)}</p>
                            </div>
                            <div className="student-sub-actions">
                              <span className={`pill ${grade.tone}`}>{grade.text}</span>
                              {sub.grade === null ? (
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-danger"
                                  title="Delete submission"
                                  onClick={() => setDeleteTarget(sub)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : null}
                            </div>
                          </div>
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
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </section>
        ))
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete submission?"
        description="This will permanently remove this submission. If the assignment allows resubmission, you can record and submit again."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </main>
  );
}

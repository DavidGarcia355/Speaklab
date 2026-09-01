"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { CircleCheck, Clock3, Mic2, Sparkles, Trash2 } from "lucide-react";
import AudioPlayer from "@/app/components/AudioPlayer";
import BrandBar from "@/app/components/BrandBar";
import ConfirmModal from "@/app/components/ConfirmModal";
import SignInLink from "@/app/components/SignInLink";
import PageTitle from "@/app/components/PageTitle";
import { buildSubmissionDownloadFilenameBase } from "@/app/components/submission-download-filenames";
import {
  studentGradeProvenance,
  type StudentGradeSource,
} from "@/lib/ai/student-provenance";
import {
  groupStudentRecordingsByClass,
  type StudentRecordingAssignment,
} from "@/lib/student-recording-groups";
import hubStyles from "./student-hubs.module.css";

type StudentSubmission = StudentRecordingAssignment & {
  id: string;
  studentName: string;
  audioData: string;
  submittedAt: number;
  feedback: string;
  grade: number | null;
  gradeSource: StudentGradeSource;
};

type StudentAssignmentHistory = StudentRecordingAssignment;

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

export default function StudentDashboardPage() {
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [assignmentHistory, setAssignmentHistory] = useState<StudentAssignmentHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<StudentSubmission | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [localAuthBypassEnabled, setLocalAuthBypassEnabled] = useState(false);

  useEffect(() => {
    async function loadSession() {
      setAuthLoading(true);
      try {
        const [sessionRes, featuresRes] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store" }),
          fetch("/api/features", { cache: "no-store" }),
        ]);
        const data = sessionRes.ok ? ((await sessionRes.json()) as SessionResponse | null) : null;
        const userEmail = data?.user?.email?.trim().toLowerCase() ?? "";
        const userName = data?.user?.name?.trim() ?? "";
        const bypass = featuresRes.ok
          ? ((await featuresRes.json()) as { localAuthBypassEnabled?: boolean }).localAuthBypassEnabled === true
          : false;
        setLocalAuthBypassEnabled(bypass);
        setEmail(userEmail || (bypass ? "dev-student@gmail.com" : ""));
        setName(userName || (userEmail ? userEmail.split("@")[0] : bypass ? "dev-student" : ""));
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
      <main className="page-wrap student-auth-loading" aria-busy="true">
        <PageTitle title="My Recordings" />
        <BrandBar label="Student" />
        <section className="student-loading-shell" aria-label="Loading student workspace">
          <span className="student-loading-pulse" aria-hidden="true" />
          <span className="student-loading-line" aria-hidden="true" />
          <span className="student-loading-line is-short" aria-hidden="true" />
        </section>
      </main>
    );
  }

  if (!email) {
    return (
      <main className="page-wrap">
        <PageTitle title="My Recordings" />
        <BrandBar label="Student" />
        <section className="hero">
          <h1>Sign in to view your submissions</h1>
          <p>After you sign in, you can see all your recordings, grades, and feedback in one place.</p>
          <div className="actions hero-actions">
            <SignInLink className="btn btn-primary" callbackUrl="/student">
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

  const gradedCount = submissions.filter((s) => s.grade !== null).length;
  const pendingCount = submissions.length - gradedCount;
  const grouped = groupStudentRecordingsByClass(assignmentHistory, submissions);

  return (
    <main className={`page-wrap student-game-wrap student-home-wrap ${hubStyles.recordingsWrap}`}>
      <PageTitle title="My Recordings" />
      <BrandBar label="Student" />

      <section className={`student-home-header ${hubStyles.recordingsHero}`}>
        <span className="student-header-echo" aria-hidden="true">Recordings</span>
        <div>
          <p className="pill student-game-pill">
            <Mic2 size={14} aria-hidden="true" />
            Submission history
          </p>
          <h1>My Recordings</h1>
          <p className="meta">
            Hi, {name}. {localAuthBypassEnabled ? "Local dev auth bypass - viewing as" : "Signed in as"} {email}
          </p>
        </div>
        <div className={`student-home-actions ${hubStyles.recordingsVisual}`}>
          <div className={`student-home-links ${hubStyles.hubLinks}`}>
            <Link className="student-text-link" href="/student/dashboard">My Classes</Link>
            <Link className="student-text-link" href="/">Home</Link>
            <Link className="student-text-link" href="/api/auth/signout?callbackUrl=/">Sign out</Link>
          </div>
          <Image
            className={hubStyles.recordingsMascot}
            src="/mascot/hablaman-transition-record-v1.webp"
            alt=""
            width={768}
            height={768}
            sizes="(max-width: 520px) 125px, (max-width: 720px) 150px, 300px"
            priority
            unoptimized
          />
          <span className={hubStyles.recordingsBadge} aria-hidden="true">{gradedCount} graded</span>
        </div>
      </section>

      <section className={`student-reward-console section-gap ${hubStyles.recordingStats}`}>
        <article className="student-console-card">
          <p className="student-console-label">
            <Sparkles size={14} aria-hidden="true" />
            Submitted
          </p>
          <p className="student-console-value">{submissions.length}</p>
          <p className="meta kpi-note">Total recordings</p>
        </article>
        <article className="student-console-card student-console-gem">
          <p className="student-console-label">
            <CircleCheck size={14} aria-hidden="true" />
            Graded
          </p>
          <p className="student-console-value">{gradedCount}</p>
          <p className="meta kpi-note">Teacher-reviewed scores</p>
        </article>
        <article className="student-console-card student-console-fire">
          <p className="student-console-label">
            <Clock3 size={14} aria-hidden="true" />
            Awaiting review
          </p>
          <p className="student-console-value">{pendingCount}</p>
          <p className="meta kpi-note">{pendingCount > 0 ? `${pendingCount} awaiting review` : "All caught up"}</p>
        </article>
      </section>

      {errorMsg ? <p className="notice danger">{errorMsg}</p> : null}

      {loading ? (
        <p className="meta">Loading submissions...</p>
      ) : grouped.length === 0 ? (
        <section className="student-empty-quest section-gap">
          <div className="student-empty-mark" aria-hidden="true">
            <Mic2 size={34} />
          </div>
          <div className="student-empty-copy">
            <h2 className="surface-title">No submissions yet</h2>
            <p className="empty">
              Open an assignment link from a teacher to record and submit a response. New
              submissions will appear here.
            </p>
          </div>
        </section>
      ) : (
        grouped.map((group) => (
          <section key={group.classId} className="student-quest-section section-gap">
            <h2 className="student-class-heading">{group.className}</h2>
            {group.assignments.map((asg) => (
              <div key={asg.assignmentId} className="student-assignment-group student-quest-card">
                <div className="student-assignment-header">
                  <h3 className="student-assignment-title">{asg.assignmentTitle}</h3>
                  <Link
                    className="btn btn-ghost btn-sm"
                    href={`/a/${asg.assignmentId}`}
                    aria-label={`Open ${asg.assignmentTitle}`}
                  >
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
                      const provenance = studentGradeProvenance(sub.gradeSource);
                      return (
                        <article key={sub.id} className="student-submission-card student-quest-card is-complete">
                          <div className="student-sub-top">
                            <div className="student-sub-info">
                              <p className="meta">Submitted {formatDate(sub.submittedAt)}</p>
                            </div>
                            <div className="student-sub-actions">
                              <span className={`pill ${grade.tone}`}>{grade.text}</span>
                              {sub.grade !== null && provenance.badge ? (
                                <span className="pill pill-subtle">{provenance.badge}</span>
                              ) : null}
                              {sub.grade === null ? (
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  onClick={() => setDeleteTarget(sub)}
                                >
                                  <Trash2 size={14} aria-hidden="true" />
                                  Delete submission
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="student-sub-details">
                            <p className="label">Recording</p>
                            <AudioPlayer
                              src={sub.audioData}
                              variant="compact"
                              downloadFilename={buildSubmissionDownloadFilenameBase({
                                studentName: sub.studentName,
                                assignmentTitle: sub.assignmentTitle,
                                submittedAt: sub.submittedAt,
                                submissionId: sub.id,
                              })}
                            />
                          </div>
                          {sub.feedback ? (
                            <div className="student-sub-feedback">
                              <p className="label" style={{ marginBottom: "0.2rem", fontSize: "0.84rem" }}>
                                {provenance.feedbackLabel}
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

"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users2,
  X,
} from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import ConfirmModal from "@/app/components/ConfirmModal";
import PageTitle from "@/app/components/PageTitle";
import UndoToast from "@/app/components/UndoToast";
import WorkspaceLoading from "@/app/components/WorkspaceLoading";
import mascotStyles from "@/app/components/OriginalMascotSlots.module.css";

type ClassSummary = {
  id: string;
  name: string;
  createdAt: number;
  assignmentCount: number;
  submissionCount: number;
};

type ClassStatus = {
  pending: number;
  graded: number;
  tone: "warning" | "success" | "neutral";
  label: string;
};

type ClassDetailPayload = {
  submissions: Array<{ grade: number | null }>;
};

type UndoState = {
  message: string;
  expiresAt: number;
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pluralize(count: number, singular: string, plural?: string) {
  if (count === 1) return `${count} ${singular}`;
  return `${count} ${plural ?? `${singular}s`}`;
}

const CHANGELOG_SEEN_KEY = "tryhabla-changelog-seen-2026-08-26";

export default function TeacherPage() {
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [classStatus, setClassStatus] = useState<Record<string, ClassStatus>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [needsTeacherAccess, setNeedsTeacherAccess] = useState(false);

  const [showChangelogBanner, setShowChangelogBanner] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(CHANGELOG_SEEN_KEY)) setShowChangelogBanner(true);
  }, []);

  function dismissChangelogBanner() {
    localStorage.setItem(CHANGELOG_SEEN_KEY, "1");
    setShowChangelogBanner(false);
  }

  const [editingClassId, setEditingClassId] = useState("");
  const [editingClassName, setEditingClassName] = useState("");
  const [classErrors, setClassErrors] = useState<Record<string, string>>({});
  const [savingClassId, setSavingClassId] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ClassSummary | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const pendingDeleteRef = useRef<{
    classId: string;
    rollback: () => void;
    commit: () => Promise<void>;
    timerId: number;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setNeedsTeacherAccess(false);
      try {
        const response = await fetch("/api/classes", { cache: "no-store" });
        if (!response.ok) {
          if (response.status === 403) {
            if (!active) return;
            setClasses([]);
            setClassStatus({});
            setNeedsTeacherAccess(true);
            return;
          }
          throw new Error("Failed to load classes.");
        }
        const data = (await response.json()) as { items: ClassSummary[] };
        if (!active) return;
        setClasses(data.items);

        const detailResults = await Promise.all(
          data.items.map(async (item) => {
            try {
              const detailResponse = await fetch(`/api/classes/${item.id}`, { cache: "no-store" });
              if (!detailResponse.ok) throw new Error("detail-failed");
              const detail = (await detailResponse.json()) as ClassDetailPayload;
              const pending = detail.submissions.filter((submission) => submission.grade === null).length;
              const graded = detail.submissions.length - pending;
              let tone: ClassStatus["tone"] = "neutral";
              let label = "No submissions";
              if (detail.submissions.length > 0 && pending > 0) {
                tone = "warning";
                label = "Needs grading";
              } else if (detail.submissions.length > 0 && pending === 0) {
                tone = "success";
                label = "Grading complete";
              }
              return { id: item.id, pending, graded, tone, label };
            } catch {
              return {
                id: item.id,
                pending: 0,
                graded: 0,
                tone: "neutral" as const,
                label: "Status unavailable",
              };
            }
          })
        );

        if (!active) return;
        const nextStatus: Record<string, ClassStatus> = {};
        for (const item of detailResults) {
          nextStatus[item.id] = {
            pending: item.pending,
            graded: item.graded,
            tone: item.tone,
            label: item.label,
          };
        }
        setClassStatus(nextStatus);
      } catch {
        if (!active) return;
        setErrorMsg("Could not load classes.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
    };
  }, []);

  useEffect(() => {
    return () => {
      const pending = pendingDeleteRef.current;
      if (!pending) return;
      window.clearTimeout(pending.timerId);
      pendingDeleteRef.current = null;
      void pending.commit().catch(() => undefined);
    };
  }, []);

  const totals = useMemo(() => {
    const classCount = classes.length;
    const assignmentCount = classes.reduce((sum, item) => sum + item.assignmentCount, 0);
    const pendingCount = Object.values(classStatus).reduce((sum, item) => sum + item.pending, 0);
    return { classCount, assignmentCount, pendingCount };
  }, [classStatus, classes]);

  function clearClassError(classId: string) {
    setClassErrors((prev) => {
      if (!prev[classId]) return prev;
      const next = { ...prev };
      delete next[classId];
      return next;
    });
  }

  function startInlineEdit(item: ClassSummary) {
    setEditingClassId(item.id);
    setEditingClassName(item.name);
    clearClassError(item.id);
  }

  function cancelInlineEdit() {
    setEditingClassId("");
    setEditingClassName("");
  }

  async function saveInlineEdit(item: ClassSummary) {
    const name = editingClassName.trim();
    if (!name) {
      setClassErrors((prev) => ({ ...prev, [item.id]: "Class name is required." }));
      return;
    }

    const previousName = item.name;
    setSavingClassId(item.id);
    setClasses((prev) => prev.map((row) => (row.id === item.id ? { ...row, name } : row)));
    setEditingClassId("");
    setEditingClassName("");
    clearClassError(item.id);

    try {
      const response = await fetch(`/api/classes/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to update class.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update class.";
      setClasses((prev) => prev.map((row) => (row.id === item.id ? { ...row, name: previousName } : row)));
      setClassErrors((prev) => ({ ...prev, [item.id]: message }));
    } finally {
      setSavingClassId("");
    }
  }

  function dismissUndoToast() {
    setUndoState(null);
  }

  function undoDelete() {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    pending.rollback();
    pendingDeleteRef.current = null;
    setUndoState(null);
  }

  function scheduleClassDelete(item: ClassSummary) {
    const snapshotStatus = classStatus[item.id];
    if (pendingDeleteRef.current) {
      const pending = pendingDeleteRef.current;
      window.clearTimeout(pending.timerId);
      pendingDeleteRef.current = null;
      void pending.commit().catch((error) => {
        pending.rollback();
        const message = error instanceof Error ? error.message : "Unable to delete class.";
        setClassErrors((prev) => ({ ...prev, [pending.classId]: message }));
      });
    }

    const rollback = () => {
      setClasses((prev) => {
        const next = [...prev, item];
        next.sort((a, b) => b.createdAt - a.createdAt);
        return next;
      });
      if (snapshotStatus) {
        setClassStatus((prev) => ({ ...prev, [item.id]: snapshotStatus }));
      }
    };

    const commit = async () => {
      const response = await fetch(`/api/classes/${item.id}`, {
        method: "DELETE",
        keepalive: true,
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to delete class.");
      }
    };

    setClasses((prev) => prev.filter((row) => row.id !== item.id));
    setClassStatus((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    clearClassError(item.id);

    const timerId = window.setTimeout(async () => {
      const pending = pendingDeleteRef.current;
      if (!pending || pending.classId !== item.id) return;
      pendingDeleteRef.current = null;
      setUndoState(null);
      try {
        await pending.commit();
      } catch (error) {
        pending.rollback();
        const message = error instanceof Error ? error.message : "Unable to delete class.";
        setClassErrors((prev) => ({ ...prev, [item.id]: message }));
      }
    }, 5000);

    pendingDeleteRef.current = {
      classId: item.id,
      rollback,
      commit,
      timerId,
    };

    setUndoState({
      message: `Class "${item.name}" removed.`,
      expiresAt: Date.now() + 5000,
    });
  }

  return (
    <main className="page-wrap">
      <PageTitle title="Teacher Studio" />
      <BrandBar label="Teacher Studio" />

      {showChangelogBanner ? (
        <div className="notice info" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.85rem" }}>
          <span>
            <strong>What&apos;s new:</strong> Batch and automatic transcripts, recording downloads, and student oral portfolios.{" "}
            <Link className="teacher-access-link" href="/changelog">See patch notes</Link>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismissChangelogBanner}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className={`teacher-hero ${mascotStyles.teacherHero}`}>
        <div className="teacher-hero-copy">
          <p className="pill teacher-hero-pill">
            <Sparkles size={14} aria-hidden="true" />
            Teacher workspace
          </p>
          <h1>My speaking classroom, all in one place.</h1>
          <p>
            Create assignments, share student links, and move through grading without losing the thread.
          </p>
          <div className="actions teacher-hero-actions">
            <Link className="btn btn-primary" href="/teacher/class/new">
              <Plus size={17} aria-hidden="true" />
              Create class
            </Link>
            <Link className="btn btn-ghost" href="#teacher-classes">
              View classes
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="btn btn-ghost" href="/teacher/rosters">
              View rosters
              <Users2 size={17} aria-hidden="true" />
            </Link>
            <Link className="btn btn-ghost" href="/billing">
              AI billing
            </Link>
          </div>
        </div>
        <div className="teacher-hero-art" aria-hidden="true">
          <span className="teacher-hero-sticker">Ready to speak</span>
          <Image
            className={`teacher-hero-mascot ${mascotStyles.teacherMascot}`}
            src="/mascot/hablaman-teacher-guide-v1.png"
            alt=""
            width={1254}
            height={1254}
            sizes="(max-width: 620px) 214px, 250px"
            priority
          />
        </div>
      </section>

      <section className="grid cols-3 section-gap teacher-kpi-grid" aria-label="Classroom summary">
        <article className="card kpi-card teacher-kpi teacher-kpi-classes">
          <p className="meta stat-label">
            <Users2 size={14} aria-hidden="true" /> Classes
          </p>
          <p className="stat-value">{totals.classCount}</p>
          <p className="meta kpi-note">Active teaching groups</p>
        </article>
        <article className="card kpi-card kpi-success teacher-kpi teacher-kpi-assignments">
          <p className="meta stat-label">
            <BookOpen size={14} aria-hidden="true" /> Assignments
          </p>
          <p className="stat-value">{totals.assignmentCount}</p>
          <p className="meta kpi-note">Published speaking tasks</p>
        </article>
        <article className="card kpi-card kpi-warning teacher-kpi teacher-kpi-grading">
          <p className="meta stat-label">
            <Clock3 size={14} aria-hidden="true" /> Needs grading
          </p>
          <p className="stat-value">{totals.pendingCount}</p>
          <p className="meta kpi-note">
            <CheckCircle2 size={13} aria-hidden="true" /> Ungraded submissions
          </p>
        </article>
      </section>

      <section id="teacher-classes" className="teacher-class-section section-gap">
        <div className="teacher-section-head">
          <div>
            <p className="teacher-section-label">Classroom hub</p>
            <h2 className="surface-title">My classes</h2>
          </div>
          <Link className="btn btn-primary btn-sm" href="/teacher/class/new">
            <Plus size={16} aria-hidden="true" />
            New class
          </Link>
        </div>
        {loading ? <WorkspaceLoading compact label="Loading my classes" /> : null}
        {errorMsg ? <p className="status-danger">{errorMsg}</p> : null}
        {!loading && needsTeacherAccess ? (
          <div className="grid">
            <h3 className="surface-title">Set up my teacher account</h3>
            <p className="empty">
              You&apos;re signed in, but teacher tools are only available after a one-click setup.
            </p>
            <div className="actions">
              <Link className="btn btn-primary" href="/teacher/register">
                Become a teacher
              </Link>
              <Link className="btn btn-ghost" href="/">
                Back home
              </Link>
            </div>
          </div>
        ) : null}
        {!loading && !errorMsg && !needsTeacherAccess && classes.length === 0 ? (
          <div className="grid onboarding-empty-state">
            <div>
              <h3 className="surface-title">Create my first class</h3>
              <p className="empty">Get started in three steps:</p>
            </div>
            <ul className="flow-list">
              <li>Create a class for the course or section you teach.</li>
              <li>Make a speaking assignment and copy the student link.</li>
              <li>Share the link, collect recordings, and hear them back in one place.</li>
            </ul>
            <div className="actions">
              <Link className="btn btn-primary" href="/teacher/class/new">
                Create class
              </Link>
              <Link className="btn btn-ghost" href="/faq">
                View teacher FAQ
              </Link>
            </div>
          </div>
        ) : null}
        {!loading && !errorMsg && !needsTeacherAccess && classes.length > 0 ? (
          <div className="grid class-list">
            {classes.map((item) => {
              const status = classStatus[item.id] ?? {
                pending: 0,
                graded: 0,
                tone: "neutral" as const,
                label: "No submissions",
              };
              const statusCountLabel =
                item.submissionCount === 0
                  ? "No student activity yet"
                  : status.pending > 0
                    ? pluralize(status.pending, "ungraded")
                    : `${pluralize(status.graded, "graded")}`;

              const isEditing = editingClassId === item.id;

              return (
                <article key={item.id} className={`card class-link class-link-${status.tone}`}>
                  <div className="class-link-row">
                    <div className="class-title-wrap">
                      {isEditing ? (
                        <div className="inline-edit-row">
                          <input
                            className="input inline-edit-input"
                            value={editingClassName}
                            onChange={(event) => setEditingClassName(event.target.value)}
                            maxLength={100}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => void saveInlineEdit(item)}
                            disabled={savingClassId === item.id}
                          >
                            <Check size={15} aria-hidden="true" />
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={cancelInlineEdit}
                          >
                            <X size={15} aria-hidden="true" />
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <h3>{item.name}</h3>
                      )}
                      <p className="meta class-link-meta">Created {formatDate(item.createdAt)}</p>
                    </div>

                    <div className="class-actions">
                      <span className={`status-badge status-${status.tone}`}>{status.label}</span>
                      <div className="actions">
                        <Link className="btn btn-ghost" href={`/teacher/class/${item.id}`} aria-label={`Open ${item.name}`}>
                          Open class
                          <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                        {!isEditing ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => startInlineEdit(item)}
                            aria-label={`Rename ${item.name}`}
                          >
                            <Pencil size={15} aria-hidden="true" />
                            Rename
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeleteTarget(item)}
                          aria-label={`Delete ${item.name}`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="class-link-pills">
                    <span className="pill pill-subtle">{pluralize(item.assignmentCount, "assignment")}</span>
                    <span className="pill pill-subtle">{pluralize(item.submissionCount, "submission")}</span>
                    <span
                      className={`pill ${
                        item.submissionCount === 0
                          ? "pill-neutral"
                          : status.pending > 0
                            ? "pill-warning"
                            : "pill-success"
                      }`}
                    >
                      {statusCountLabel}
                    </span>
                  </div>

                  {classErrors[item.id] ? (
                    <p className="card-inline-error">{classErrors[item.id]}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete class?"
        description="This will permanently remove the class, all assignments, and all submissions."
        confirmLabel="Delete class"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            scheduleClassDelete(deleteTarget);
          }
          setDeleteTarget(null);
        }}
      />

      {undoState ? (
        <UndoToast
          message={undoState.message}
          expiresAt={undoState.expiresAt}
          onUndo={undoDelete}
          onDismiss={dismissUndoToast}
        />
      ) : null}
    </main>
  );
}

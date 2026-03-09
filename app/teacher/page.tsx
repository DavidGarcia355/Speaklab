"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  Pencil,
  Trash2,
  Users2,
  X,
} from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import ConfirmModal from "@/app/components/ConfirmModal";
import UndoToast from "@/app/components/UndoToast";

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

export default function TeacherPage() {
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [classStatus, setClassStatus] = useState<Record<string, ClassStatus>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

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
      try {
        const response = await fetch("/api/classes", { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load classes.");
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
      if (pendingDeleteRef.current) {
        window.clearTimeout(pendingDeleteRef.current.timerId);
      }
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
      window.clearTimeout(pendingDeleteRef.current.timerId);
      void pendingDeleteRef.current.commit();
      pendingDeleteRef.current = null;
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
      const response = await fetch(`/api/classes/${item.id}`, { method: "DELETE" });
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
      <BrandBar label="Teacher Studio" />
      <p className="meta page-intent">
        Daily classroom workspace for assignment setup, grading triage, and export.
      </p>

      <section className="hero">
        <p className="pill">Teacher workspace</p>
        <h1>Manage classes, assignments, and grading in one place</h1>
        <p>
          Set up quickly before class, share links with students, and keep grading organized.
        </p>
        <div className="actions hero-actions">
          <Link className="btn btn-primary" href="/teacher/class/new">
            Create class
          </Link>
          <Link className="btn btn-ghost" href="/">
            Back home
          </Link>
        </div>
      </section>

      <section className="grid cols-3 section-gap">
        <article className="card kpi-card">
          <p className="meta stat-label">
            <Users2 size={14} aria-hidden="true" /> Classes
          </p>
          <p className="stat-value">{totals.classCount}</p>
          <p className="meta kpi-note">Active teaching groups</p>
        </article>
        <article className="card kpi-card kpi-success">
          <p className="meta stat-label">
            <BookOpen size={14} aria-hidden="true" /> Assignments
          </p>
          <p className="stat-value">{totals.assignmentCount}</p>
          <p className="meta kpi-note">Published speaking tasks</p>
        </article>
        <article className="card kpi-card kpi-warning">
          <p className="meta stat-label">
            <Clock3 size={14} aria-hidden="true" /> Needs grading
          </p>
          <p className="stat-value">{totals.pendingCount}</p>
          <p className="meta kpi-note">
            <CheckCircle2 size={13} aria-hidden="true" /> Ungraded submissions
          </p>
        </article>
      </section>

      <section className="card section-gap">
        <h2 className="surface-title">Your classes</h2>
        {loading ? <p className="meta">Loading classes...</p> : null}
        {errorMsg ? <p className="status-danger">{errorMsg}</p> : null}
        {!loading && !errorMsg && classes.length === 0 ? (
          <div className="grid">
            <p className="empty">No classes yet. Start by creating your first class.</p>
            <div className="actions">
              <Link className="btn btn-primary" href="/teacher/class/new">
                Create class
              </Link>
            </div>
          </div>
        ) : null}
        {!loading && !errorMsg && classes.length > 0 ? (
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
                            maxLength={120}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="icon-btn icon-btn-confirm"
                            onClick={() => void saveInlineEdit(item)}
                            disabled={savingClassId === item.id}
                            aria-label="Save class name"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={cancelInlineEdit}
                            aria-label="Cancel class edit"
                          >
                            <X size={15} />
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
                        <Link className="btn btn-ghost" href={`/teacher/class/${item.id}`}>
                          Open class
                        </Link>
                        {!isEditing ? (
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => startInlineEdit(item)}
                            aria-label="Edit class name"
                          >
                            <Pencil size={15} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          onClick={() => setDeleteTarget(item)}
                          aria-label="Delete class"
                        >
                          <Trash2 size={15} />
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

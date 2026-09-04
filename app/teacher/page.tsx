"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CreditCard,
  Pencil,
  Plus,
  Trash2,
  Users2,
  X,
} from "lucide-react";
import BrandBar from "@/app/components/BrandBar";
import ConfirmModal from "@/app/components/ConfirmModal";
import PageTitle from "@/app/components/PageTitle";
import UndoToast from "@/app/components/UndoToast";
import WorkspaceLoading from "@/app/components/WorkspaceLoading";
import styles from "./TeacherWorkspace.module.css";

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
  const [openManageMenuId, setOpenManageMenuId] = useState("");

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
    let firstLoad = true;

    async function load() {
      if (firstLoad) setLoading(true);
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
        setClassStatus((previous) => {
          const next: Record<string, ClassStatus> = {};
          for (const item of data.items) {
            if (previous[item.id]) next[item.id] = previous[item.id];
          }
          return next;
        });
        setLoading(false);
        firstLoad = false;

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
        if (active && firstLoad) {
          setLoading(false);
          firstLoad = false;
        }
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

  useEffect(() => {
    if (!openManageMenuId) return;

    const menuRootId = `class-manage-root-${openManageMenuId}`;
    const triggerId = `class-manage-trigger-${openManageMenuId}`;
    const menuId = `class-manage-menu-${openManageMenuId}`;

    function closeMenu(returnFocus = false) {
      setOpenManageMenuId("");
      if (returnFocus) {
        window.requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const menuRoot = document.getElementById(menuRootId);
      if (!menuRoot?.contains(event.target as Node)) closeMenu();
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu(true);
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const firstItem = document
        .getElementById(menuId)
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]');
      firstItem?.focus();
    });

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openManageMenuId]);

  const totals = useMemo(() => {
    const classCount = classes.length;
    const assignmentCount = classes.reduce((sum, item) => sum + item.assignmentCount, 0);
    const pendingCount = Object.values(classStatus).reduce((sum, item) => sum + item.pending, 0);
    return { classCount, assignmentCount, pendingCount };
  }, [classStatus, classes]);

  const sortedClasses = useMemo(() => {
    return [...classes].sort((first, second) => {
      const pendingDifference = (classStatus[second.id]?.pending ?? 0) - (classStatus[first.id]?.pending ?? 0);
      return pendingDifference || second.createdAt - first.createdAt;
    });
  }, [classStatus, classes]);

  const gradingStatusLoading = classes.some((item) => !classStatus[item.id]);
  const gradingStatusUnavailable = classes.some(
    (item) => classStatus[item.id]?.label === "Status unavailable",
  );

  function clearClassError(classId: string) {
    setClassErrors((prev) => {
      if (!prev[classId]) return prev;
      const next = { ...prev };
      delete next[classId];
      return next;
    });
  }

  function startInlineEdit(item: ClassSummary) {
    setOpenManageMenuId("");
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
    setOpenManageMenuId("");
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

  function handleManageMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      setOpenManageMenuId("");
      return;
    }

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    items[nextIndex]?.focus();
  }

  return (
    <main className="page-wrap">
      <PageTitle title="Teacher Studio" />
      <BrandBar label="Teacher Studio" />

      <section className={styles.workspaceHeader} aria-labelledby="teacher-workspace-title">
        <span className={styles.ghostWord} aria-hidden="true">CLASSES</span>
        <div className={styles.headerCopy}>
          <h1 id="teacher-workspace-title">My classes</h1>
          <p className={styles.summary} aria-live="polite">
            {loading ? (
              <span className={styles.summaryLoading}>Loading classes...</span>
            ) : (
              <>
                <span>{pluralize(totals.classCount, "class", "classes")}</span>
                <span aria-hidden="true">&middot;</span>
                <span>{pluralize(totals.assignmentCount, "assignment")}</span>
                <span aria-hidden="true">&middot;</span>
                {gradingStatusLoading ? (
                  <span className={styles.summaryLoading}>Checking grading...</span>
                ) : gradingStatusUnavailable ? (
                  <span className={styles.summaryLoading}>Some grading unavailable</span>
                ) : totals.pendingCount > 0 ? (
                  <strong className={styles.summaryAttention}>{totals.pendingCount} to grade</strong>
                ) : (
                  <strong className={styles.summaryClear}>All caught up</strong>
                )}
              </>
            )}
          </p>
          <nav className={styles.quickActions} aria-label="Teacher workspace shortcuts">
            <Link className="btn btn-primary" href="/teacher/class/new">
              <Plus size={17} aria-hidden="true" />
              New class
            </Link>
            <Link className="btn btn-ghost" href="/teacher/rosters">
              <Users2 size={17} aria-hidden="true" />
              Rosters
            </Link>
            <Link className="btn btn-ghost" href="/billing">
              <CreditCard size={17} aria-hidden="true" />
              AI billing
            </Link>
          </nav>
        </div>
        <div className={styles.headerArt} aria-hidden="true">
          <Image
            className={styles.headerMascot}
            src="/mascot/hablaman-teacher-guide-v1.png"
            alt=""
            width={1254}
            height={1254}
            sizes="(max-width: 620px) 150px, 300px"
            priority
          />
        </div>
      </section>

      <section className={styles.classSection} aria-label="Classes">
        {loading ? <WorkspaceLoading compact label="Loading my classes" /> : null}
        {errorMsg ? <p className="status-danger">{errorMsg}</p> : null}
        {!loading && needsTeacherAccess ? (
          <div className={styles.emptyState}>
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
          <div className={styles.emptyState}>
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
              <Link className="btn btn-ghost" href="/faq">
                View teacher FAQ
              </Link>
            </div>
          </div>
        ) : null}
        {!loading && !errorMsg && !needsTeacherAccess && classes.length > 0 ? (
          <div className={styles.classList}>
            {sortedClasses.map((item) => {
              const status = classStatus[item.id];
              const statusTone = status?.tone ?? "neutral";
              const statusLabel =
                !status && item.submissionCount > 0
                  ? "Checking grades..."
                  : status?.label === "Status unavailable"
                    ? "Status unavailable"
                    : item.submissionCount === 0
                      ? "No submissions"
                      : status && status.pending > 0
                        ? `${status.pending} to grade`
                        : "All graded";

              const isEditing = editingClassId === item.id;
              const menuOpen = openManageMenuId === item.id;
              const cardToneClass =
                statusTone === "warning"
                  ? styles.classCardWarning
                  : statusTone === "success"
                    ? styles.classCardSuccess
                    : styles.classCardNeutral;

              return (
                <article key={item.id} className={`${styles.classCard} ${cardToneClass}`}>
                  <div className={styles.classMain}>
                    <div className={styles.classTitleWrap}>
                      {isEditing ? (
                        <div className={styles.inlineEditRow}>
                          <label className={styles.visuallyHidden} htmlFor={`class-name-${item.id}`}>
                            Class name
                          </label>
                          <input
                            id={`class-name-${item.id}`}
                            className={`input ${styles.inlineEditInput}`}
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
                      <p className={styles.classMeta}>
                        <span>{pluralize(item.assignmentCount, "assignment")}</span>
                        <span aria-hidden="true">&middot;</span>
                        <span>{pluralize(item.submissionCount, "submission")}</span>
                        <span aria-hidden="true">&middot;</span>
                        <span>Created {formatDate(item.createdAt)}</span>
                      </p>
                    </div>

                    <span className={`status-badge status-${statusTone} ${styles.classStatus}`}>
                      {statusLabel}
                    </span>
                  </div>

                  <div className={styles.classActions}>
                    <Link
                      className="btn btn-primary btn-sm"
                      href={`/teacher/class/${item.id}`}
                      aria-label={`Open ${item.name}`}
                    >
                      Open class
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                    {!isEditing ? (
                      <div
                        id={`class-manage-root-${item.id}`}
                        className={styles.manageRoot}
                        data-class-menu-root={item.id}
                      >
                        <button
                          id={`class-manage-trigger-${item.id}`}
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          aria-controls={`class-manage-menu-${item.id}`}
                          onClick={() =>
                            setOpenManageMenuId((current) => (current === item.id ? "" : item.id))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              setOpenManageMenuId(item.id);
                            }
                          }}
                        >
                          Manage class
                          <ChevronDown
                            className={menuOpen ? styles.chevronOpen : undefined}
                            size={16}
                            aria-hidden="true"
                          />
                        </button>
                        {menuOpen ? (
                          <div
                            id={`class-manage-menu-${item.id}`}
                            className={styles.manageMenu}
                            role="menu"
                            aria-label={`Manage ${item.name}`}
                            onKeyDown={handleManageMenuKeyDown}
                          >
                            <button
                              type="button"
                              className={styles.manageMenuItem}
                              role="menuitem"
                              onClick={() => {
                                setOpenManageMenuId("");
                                startInlineEdit(item);
                              }}
                              aria-label={`Rename ${item.name}`}
                            >
                              <Pencil size={15} aria-hidden="true" />
                              Rename class
                            </button>
                            <button
                              type="button"
                              className={`${styles.manageMenuItem} ${styles.manageMenuDanger}`}
                              role="menuitem"
                              onClick={() => {
                                setOpenManageMenuId("");
                                setDeleteTarget(item);
                              }}
                              aria-label={`Delete ${item.name}`}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                              Delete class
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
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

      {showChangelogBanner ? (
        <aside className={styles.changelog} aria-label="TryHabla update">
          <span>
            <strong>New in TryHabla:</strong> Batch and automatic transcripts, recording downloads, and student oral portfolios.{" "}
            <Link className="teacher-access-link" href="/changelog">
              Patch notes
            </Link>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismissChangelogBanner}>
            Dismiss
          </button>
        </aside>
      ) : null}

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

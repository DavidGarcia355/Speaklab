"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, CheckCircle2, Clock3, Pencil, Trash2, X } from "lucide-react";
import AudioPlayer from "@/app/components/AudioPlayer";
import BrandBar from "@/app/components/BrandBar";
import ConfirmModal from "@/app/components/ConfirmModal";
import UndoToast from "@/app/components/UndoToast";

type AssignmentSummary = {
  id: string;
  classId: string;
  title: string;
  description: string;
  instructions: string;
  createdAt: number;
  submissionCount: number;
};

type SubmissionItem = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  studentName: string;
  studentEmail: string;
  audioData: string;
  submittedAt: number;
  feedback: string;
  grade: number | null;
};

type ClassPayload = {
  item: { id: string; name: string; createdAt: number };
  assignments: AssignmentSummary[];
  submissions: SubmissionItem[];
  stats: { assignmentCount: number; submissionCount: number };
};

type DraftState = { gradeInput: string; feedback: string; saving: boolean };
type Tone = "warning" | "success" | "neutral";
type AssignmentView = AssignmentSummary & {
  totalSubmissions: number;
  ungradedCount: number;
  tone: Tone;
  label: string;
};
type UndoState = { message: string; expiresAt: number };
type DeleteTarget =
  | { type: "assignment"; assignment: AssignmentView }
  | { type: "submission"; submission: SubmissionItem }
  | null;

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? `${singular}s`}`;
}

function autoResizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
}

export default function ClassDetailPage() {
  const params = useParams<{ classId?: string }>();
  const searchParams = useSearchParams();
  const classId = params?.classId;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");
  const [payload, setPayload] = useState<ClassPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [studentFilter, setStudentFilter] = useState("");
  const [showUngradedOnly, setShowUngradedOnly] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [copiedId, setCopiedId] = useState("");

  const [assignmentEditOpen, setAssignmentEditOpen] = useState(false);
  const [assignmentTitleDraft, setAssignmentTitleDraft] = useState("");
  const [assignmentInstructionsDraft, setAssignmentInstructionsDraft] = useState("");
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");

  const [editingSubmissionId, setEditingSubmissionId] = useState("");
  const [editingSubmissionName, setEditingSubmissionName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [submissionErrors, setSubmissionErrors] = useState<Record<string, string>>({});

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const pendingDeleteRef = useRef<{
    key: string;
    rollback: () => void;
    commit: () => Promise<void>;
    onError: (message: string) => void;
    timerId: number;
  } | null>(null);

  async function loadData(targetClassId: string) {
    setLoading(true);
    setErrorMsg("");
    try {
      const response = await fetch(`/api/classes/${targetClassId}`, { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to load class.");
      }
      const data = (await response.json()) as ClassPayload;
      setPayload(data);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const submission of data.submissions) {
          next[submission.id] = {
            gradeInput: prev[submission.id]?.gradeInput ?? (submission.grade === null ? "" : String(submission.grade)),
            feedback: prev[submission.id]?.feedback ?? submission.feedback ?? "",
            saving: false,
          };
        }
        return next;
      });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Failed to load class.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!classId) {
      setLoading(false);
      setErrorMsg("Missing class id.");
      return;
    }
    loadData(classId);
    const onFocus = () => loadData(classId);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [classId]);

  useEffect(() => {
    const created = searchParams.get("created");
    if (created === "class") setInfoMsg("Class created. Next step: create your first assignment.");
    else if (created === "assignment") setInfoMsg("Assignment created. Share the student link when ready.");
    else setInfoMsg("");
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) window.clearTimeout(pendingDeleteRef.current.timerId);
    };
  }, []);

  const submissionsByAssignment = useMemo(() => {
    const grouped: Record<string, SubmissionItem[]> = {};
    if (!payload) return grouped;
    for (const sub of payload.submissions) {
      if (!grouped[sub.assignmentId]) grouped[sub.assignmentId] = [];
      grouped[sub.assignmentId].push(sub);
    }
    return grouped;
  }, [payload]);

  const filteredByAssignment = useMemo(() => {
    const grouped: Record<string, SubmissionItem[]> = {};
    for (const [assignmentId, submissions] of Object.entries(submissionsByAssignment)) {
      grouped[assignmentId] = submissions.filter((item) => {
        const matchesStudent = item.studentName.toLowerCase().includes(studentFilter.trim().toLowerCase());
        const matchesGrade = showUngradedOnly ? item.grade === null : true;
        return matchesStudent && matchesGrade;
      });
    }
    return grouped;
  }, [showUngradedOnly, studentFilter, submissionsByAssignment]);

  const workspaceStats = useMemo(() => {
    if (!payload) return { pending: 0, graded: 0 };
    const pending = payload.submissions.filter((item) => item.grade === null).length;
    return { pending, graded: payload.submissions.length - pending };
  }, [payload]);

  const assignmentViews = useMemo<AssignmentView[]>(() => {
    if (!payload) return [];
    return payload.assignments.map((assignment) => {
      const all = submissionsByAssignment[assignment.id] ?? [];
      const ungradedCount = all.filter((s) => s.grade === null).length;
      const tone: Tone = all.length === 0 ? "neutral" : ungradedCount > 0 ? "warning" : "success";
      const label = all.length === 0 ? "No submissions" : ungradedCount > 0 ? "Needs grading" : "Grading complete";
      return { ...assignment, totalSubmissions: all.length, ungradedCount, tone, label };
    });
  }, [payload, submissionsByAssignment]);

  useEffect(() => {
    if (assignmentViews.length === 0) {
      setSelectedAssignmentId("");
      return;
    }
    if (!assignmentViews.some((a) => a.id === selectedAssignmentId)) {
      setSelectedAssignmentId(assignmentViews[0].id);
    }
  }, [assignmentViews, selectedAssignmentId]);

  const activeAssignment = assignmentViews.find((assignment) => assignment.id === selectedAssignmentId) ?? assignmentViews[0] ?? null;
  const activeAllSubmissions = activeAssignment ? submissionsByAssignment[activeAssignment.id] ?? [] : [];
  const activeFilteredSubmissions = activeAssignment ? filteredByAssignment[activeAssignment.id] ?? [] : [];

  function updatePayloadSubmissions(updater: (items: SubmissionItem[]) => SubmissionItem[]) {
    setPayload((prev) => (prev ? { ...prev, submissions: updater(prev.submissions) } : prev));
  }

  function updatePayloadAssignments(updater: (items: AssignmentSummary[]) => AssignmentSummary[]) {
    setPayload((prev) => (prev ? { ...prev, assignments: updater(prev.assignments) } : prev));
  }

  function setDraft(submissionId: string, update: Partial<DraftState>) {
    setDrafts((prev) => ({
      ...prev,
      [submissionId]: {
        gradeInput: prev[submissionId]?.gradeInput ?? "",
        feedback: prev[submissionId]?.feedback ?? "",
        saving: prev[submissionId]?.saving ?? false,
        ...update,
      },
    }));
  }

  async function saveSubmission(submissionId: string) {
    const draft = drafts[submissionId];
    const existing = payload?.submissions.find((item) => item.id === submissionId);
    if (!draft || !existing) return;
    const clean = draft.gradeInput.trim();
    let parsedGrade: number | null = null;
    if (clean !== "") {
      const numericGrade = Number(clean);
      if (!Number.isFinite(numericGrade) || numericGrade < 0 || numericGrade > 100) {
        setSubmissionErrors((prev) => ({ ...prev, [submissionId]: "Score must be a number from 0 to 100." }));
        return;
      }
      parsedGrade = numericGrade;
    }

    setDraft(submissionId, { saving: true });
    setSubmissionErrors((prev) => ({ ...prev, [submissionId]: "" }));
    updatePayloadSubmissions((items) =>
      items.map((row) => (row.id === submissionId ? { ...row, grade: parsedGrade, feedback: draft.feedback } : row))
    );

    try {
      const response = await fetch(`/api/submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: parsedGrade, feedback: draft.feedback }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to save grade.");
      }
      const updated = (await response.json()) as { item?: SubmissionItem | null };
      if (updated.item) {
        updatePayloadSubmissions((items) => items.map((row) => (row.id === submissionId ? updated.item! : row)));
      }
      setInfoMsg("Grade saved.");
      window.setTimeout(() => setInfoMsg(""), 1300);
    } catch (error) {
      updatePayloadSubmissions((items) =>
        items.map((row) => (row.id === submissionId ? { ...row, grade: existing.grade, feedback: existing.feedback } : row))
      );
      setSubmissionErrors((prev) => ({ ...prev, [submissionId]: error instanceof Error ? error.message : "Failed to save grade." }));
    } finally {
      setDraft(submissionId, { saving: false });
    }
  }

  async function saveSubmissionName(submission: SubmissionItem) {
    const name = editingSubmissionName.trim();
    if (!name) {
      setSubmissionErrors((prev) => ({ ...prev, [submission.id]: "Student name is required." }));
      return;
    }
    setNameSaving(true);
    setSubmissionErrors((prev) => ({ ...prev, [submission.id]: "" }));
    updatePayloadSubmissions((items) => items.map((row) => (row.id === submission.id ? { ...row, studentName: name } : row)));
    setEditingSubmissionId("");
    setEditingSubmissionName("");

    try {
      const response = await fetch(`/api/submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentName: name }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to update student name.");
      }
    } catch (error) {
      updatePayloadSubmissions((items) => items.map((row) => (row.id === submission.id ? { ...row, studentName: submission.studentName } : row)));
      setSubmissionErrors((prev) => ({ ...prev, [submission.id]: error instanceof Error ? error.message : "Unable to update student name." }));
    } finally {
      setNameSaving(false);
    }
  }

  function openAssignmentEditModal() {
    if (!activeAssignment) return;
    setAssignmentTitleDraft(activeAssignment.title);
    setAssignmentInstructionsDraft(activeAssignment.instructions);
    setAssignmentError("");
    setAssignmentEditOpen(true);
  }

  async function saveAssignmentEdit() {
    if (!activeAssignment) return;
    const title = assignmentTitleDraft.trim();
    const instructions = assignmentInstructionsDraft.trim();
    if (!title || !instructions) {
      setAssignmentError("Assignment name and instructions are required.");
      return;
    }

    const rollback = { title: activeAssignment.title, instructions: activeAssignment.instructions };
    setAssignmentSaving(true);
    setAssignmentError("");
    updatePayloadAssignments((items) => items.map((row) => (row.id === activeAssignment.id ? { ...row, title, instructions } : row)));
    setAssignmentEditOpen(false);

    try {
      const response = await fetch(`/api/assignments/${activeAssignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, instructions }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to update assignment.");
      }
    } catch (error) {
      updatePayloadAssignments((items) => items.map((row) => (row.id === activeAssignment.id ? { ...row, ...rollback } : row)));
      setAssignmentError(error instanceof Error ? error.message : "Unable to update assignment.");
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function copyStudentLink(assignmentId: string) {
    try {
      const url = `${window.location.origin}/a/${assignmentId}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(assignmentId);
      window.setTimeout(() => setCopiedId(""), 1400);
    } catch {
      setErrorMsg("Copy failed. Select the link directly from your browser address bar.");
    }
  }

  function scheduleDelete(config: {
    key: string;
    message: string;
    rollback: () => void;
    commit: () => Promise<void>;
    onError: (message: string) => void;
  }) {
    if (pendingDeleteRef.current) {
      window.clearTimeout(pendingDeleteRef.current.timerId);
      const pending = pendingDeleteRef.current;
      pendingDeleteRef.current = null;
      void pending.commit().catch((error) => {
        pending.rollback();
        pending.onError(error instanceof Error ? error.message : "Delete failed.");
      });
    }

    const timerId = window.setTimeout(async () => {
      const pending = pendingDeleteRef.current;
      if (!pending || pending.key !== config.key) return;
      pendingDeleteRef.current = null;
      setUndoState(null);
      try {
        await pending.commit();
      } catch (error) {
        pending.rollback();
        pending.onError(error instanceof Error ? error.message : "Delete failed.");
      }
    }, 5000);

    pendingDeleteRef.current = { ...config, timerId };
    setUndoState({ message: config.message, expiresAt: Date.now() + 5000 });
  }

  function undoDelete() {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    pending.rollback();
    pendingDeleteRef.current = null;
    setUndoState(null);
  }

  function deleteAssignment(assignment: AssignmentView) {
    const assignmentSnapshot = payload?.assignments.find((row) => row.id === assignment.id);
    if (!assignmentSnapshot) return;
    const submissionSnapshots = payload?.submissions.filter((row) => row.assignmentId === assignment.id) ?? [];
    updatePayloadAssignments((items) => items.filter((row) => row.id !== assignment.id));
    updatePayloadSubmissions((items) => items.filter((row) => row.assignmentId !== assignment.id));
    setDeleteTarget(null);
    setAssignmentError("");

    scheduleDelete({
      key: `assignment:${assignment.id}`,
      message: `Assignment "${assignment.title}" removed.`,
      rollback: () => {
        updatePayloadAssignments((items) => [...items, assignmentSnapshot].sort((a, b) => b.createdAt - a.createdAt));
        updatePayloadSubmissions((items) => [...items, ...submissionSnapshots].sort((a, b) => b.submittedAt - a.submittedAt));
      },
      commit: async () => {
        const response = await fetch(`/api/assignments/${assignment.id}`, { method: "DELETE" });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Unable to delete assignment.");
        }
      },
      onError: (message) => setAssignmentError(message),
    });
  }

  function deleteSubmission(submission: SubmissionItem) {
    updatePayloadSubmissions((items) => items.filter((row) => row.id !== submission.id));
    setDeleteTarget(null);
    if (editingSubmissionId === submission.id) {
      setEditingSubmissionId("");
      setEditingSubmissionName("");
    }

    scheduleDelete({
      key: `submission:${submission.id}`,
      message: `Submission from "${submission.studentName}" removed.`,
      rollback: () => {
        updatePayloadSubmissions((items) => [...items, submission].sort((a, b) => b.submittedAt - a.submittedAt));
      },
      commit: async () => {
        const response = await fetch(`/api/submissions/${submission.id}`, { method: "DELETE" });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Unable to delete submission.");
        }
      },
      onError: (message) => setSubmissionErrors((prev) => ({ ...prev, [submission.id]: message })),
    });
  }

  if (loading) return <main className="page-wrap"><p className="meta">Loading class...</p></main>;
  if (errorMsg && !payload) {
    return (
      <main className="page-wrap">
        <section className="card">
          <h1 className="surface-title">Class unavailable</h1>
          <p className="status-danger">{errorMsg}</p>
          <div className="actions"><Link className="btn btn-ghost" href="/teacher">Back to teacher</Link></div>
        </section>
      </main>
    );
  }
  if (!payload) return null;

  return (
    <main className="page-wrap">
      <BrandBar label="Grading Workspace" />
      <p className="meta page-intent">Assignments are your main navigation. Select one, then grade every submission in one panel.</p>

      <div className="workspace-header">
        <div className="dense-row">
          <div><h2 className="surface-title">{payload.item.name}</h2><p className="meta">Class grading studio</p></div>
          <div className="actions">
            <Link className="btn btn-ghost" href="/teacher">Back to teacher</Link>
            <Link className="btn btn-primary" href={`/teacher/class/${payload.item.id}/assignment/new`}>Create assignment</Link>
            <a className="btn btn-ghost" href={`/api/classes/${payload.item.id}/gradebook.csv`}>Export CSV</a>
          </div>
        </div>
      </div>

      {errorMsg ? <p className="notice danger">{errorMsg}</p> : null}
      {infoMsg ? <p className="notice success">{infoMsg}</p> : null}

      <section className="grid cols-3 section-gap">
        <article className="card kpi-card"><p className="meta stat-label"><BookOpen size={14} /> Assignments</p><p className="stat-value">{payload.stats.assignmentCount}</p><p className="meta kpi-note">Published tasks</p></article>
        <article className="card kpi-card kpi-warning"><p className="meta stat-label"><Clock3 size={14} /> Needs grading</p><p className="stat-value">{workspaceStats.pending}</p><p className="meta kpi-note">Ungraded submissions</p></article>
        <article className="card kpi-card kpi-success"><p className="meta stat-label"><CheckCircle2 size={14} /> Graded</p><p className="stat-value">{workspaceStats.graded}</p><p className="meta kpi-note">Completed scores</p></article>
      </section>

      {assignmentViews.length === 0 ? (
        <section className="card section-gap"><h2 className="surface-title">Assignments</h2><p className="empty">No assignments yet. Create one to start collecting recordings.</p></section>
      ) : (
        <section className="workspace-split section-gap">
          <aside className="card assignment-nav panel-subtle">
            <h2 className="surface-title">Assignments</h2>
            <p className="meta">Switch assignments quickly and triage what needs grading.</p>
            <div className="assignment-list">
              {assignmentViews.map((assignment) => (
                <button key={assignment.id} type="button" className={`assignment-nav-item ${assignment.id === activeAssignment?.id ? "is-selected" : ""}`} onClick={() => setSelectedAssignmentId(assignment.id)}>
                  <div className="assignment-nav-head"><p className="assignment-nav-title">{assignment.title}</p><span className={`status-badge status-${assignment.tone}`}>{assignment.label}</span></div>
                  <div className="assignment-nav-counts"><span className="pill pill-subtle">{pluralize(assignment.totalSubmissions, "submission")}</span>{assignment.totalSubmissions === 0 ? <span className="pill pill-neutral">No activity</span> : assignment.ungradedCount > 0 ? <span className="pill pill-warning">{pluralize(assignment.ungradedCount, "ungraded")}</span> : <span className="pill pill-success">All graded</span>}</div>
                </button>
              ))}
            </div>
          </aside>

          <div className="card assignment-main">
            {!activeAssignment ? null : (
              <>
                <div className="dense-row assignment-main-header">
                  <div><h2 className="assignment-title">{activeAssignment.title}</h2>{activeAssignment.description ? <p className="meta assignment-description">{activeAssignment.description}</p> : null}<p className="meta assignment-meta">Created {formatDate(activeAssignment.createdAt)}</p></div>
                  <div className="assignment-header-actions"><span className={`status-badge status-${activeAssignment.tone}`}>{activeAssignment.label}</span><button type="button" className="icon-btn" onClick={openAssignmentEditModal}><Pencil size={15} /></button><button type="button" className="icon-btn icon-btn-danger" onClick={() => setDeleteTarget({ type: "assignment", assignment: activeAssignment })}><Trash2 size={15} /></button></div>
                </div>

                <div className="actions assignment-actions">
                  <Link className="btn btn-ghost" href={`/a/${activeAssignment.id}`}>Open student page</Link>
                  <button type="button" className="btn btn-ghost" onClick={() => void copyStudentLink(activeAssignment.id)}>{copiedId === activeAssignment.id ? "Copied" : "Copy link"}</button>
                  <span className="pill pill-subtle">{pluralize(activeAssignment.totalSubmissions, "submission")}</span>
                  <span className={`pill ${activeAssignment.totalSubmissions === 0 ? "pill-neutral" : activeAssignment.ungradedCount > 0 ? "pill-warning" : "pill-success"}`}>{activeAssignment.totalSubmissions === 0 ? "No activity" : activeAssignment.ungradedCount > 0 ? pluralize(activeAssignment.ungradedCount, "ungraded") : "All graded"}</span>
                </div>
                {assignmentError ? <p className="card-inline-error">{assignmentError}</p> : null}
                <div className="assignment-instructions"><p className="meta"><strong>Instructions:</strong> {activeAssignment.instructions?.trim() || "No instructions provided."}</p></div>

                <div className="toolbar-compact">
                  <label className="label toolbar-label" htmlFor="student-filter">Find student in this assignment</label>
                  <input id="student-filter" className="input toolbar-input" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)} placeholder="Type student name..." />
                  <button type="button" className={`btn ${showUngradedOnly ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowUngradedOnly((prev) => !prev)}>{showUngradedOnly ? "Ungraded only: on" : "Ungraded only"}</button>
                  <span className="status-badge status-warning">{pluralize(activeAssignment.ungradedCount, "ungraded")}</span>
                </div>

                {activeAllSubmissions.length === 0 ? <p className="empty">No submissions yet for this assignment.</p> : activeFilteredSubmissions.length === 0 ? <p className="empty">No submissions match current filters.</p> : (
                  <div className="grid submission-grid assignment-submissions">
                    {activeFilteredSubmissions.map((submission) => {
                      const draft = drafts[submission.id] ?? { gradeInput: submission.grade === null ? "" : String(submission.grade), feedback: submission.feedback ?? "", saving: false };
                      const isEditing = editingSubmissionId === submission.id;
                      return (
                        <div key={submission.id} className="card submission-card">
                          <div className="dense-row">
                            <div>
                              {isEditing ? (
                                <div className="inline-edit-row"><input className="input inline-edit-input" value={editingSubmissionName} onChange={(event) => setEditingSubmissionName(event.target.value)} maxLength={120} autoFocus /><button type="button" className="icon-btn icon-btn-confirm" onClick={() => void saveSubmissionName(submission)} disabled={nameSaving}><Check size={15} /></button><button type="button" className="icon-btn" onClick={() => { setEditingSubmissionId(""); setEditingSubmissionName(""); }}><X size={15} /></button></div>
                              ) : (
                                <div className="submission-name-row"><strong>{submission.studentName}</strong><button type="button" className="icon-btn" onClick={() => { setEditingSubmissionId(submission.id); setEditingSubmissionName(submission.studentName); }}><Pencil size={14} /></button><button type="button" className="icon-btn icon-btn-danger" onClick={() => setDeleteTarget({ type: "submission", submission })}><Trash2 size={14} /></button></div>
                              )}
                              <div className="meta">{formatDateTime(submission.submittedAt)}</div>
                              <div className="meta">{submission.studentEmail || "No email captured"}</div>
                            </div>
                            <div className="score-control"><label className="meta score-label" htmlFor={`grade-${submission.id}`}>Score</label><div className="score-field"><input id={`grade-${submission.id}`} className="input score-input" type="number" min={0} max={100} step={1} inputMode="numeric" placeholder="0" value={draft.gradeInput} onChange={(event) => setDraft(submission.id, { gradeInput: event.target.value })} /><span className="score-suffix">/100</span></div></div>
                          </div>
                          <AudioPlayer src={submission.audioData} variant="compact" showSpeed={false} />
                          <label className="label feedback-label" htmlFor={`feedback-${submission.id}`}>Feedback (optional)</label>
                          <textarea id={`feedback-${submission.id}`} className="textarea feedback-area" value={draft.feedback} onChange={(event) => setDraft(submission.id, { feedback: event.target.value })} onInput={(event) => autoResizeTextarea(event.currentTarget)} onFocus={(event) => autoResizeTextarea(event.currentTarget)} placeholder="Optional student feedback..." rows={2} />
                          <div className="actions submission-actions"><button type="button" className="btn btn-primary" onClick={() => void saveSubmission(submission.id)} disabled={draft.saving}>{draft.saving ? "Saving..." : "Save grade"}</button></div>
                          {submissionErrors[submission.id] ? <p className="card-inline-error">{submissionErrors[submission.id]}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title={deleteTarget?.type === "assignment" ? "Delete assignment?" : "Delete submission?"}
        description={deleteTarget?.type === "assignment" ? "This permanently removes the assignment and all of its submissions." : "This permanently removes this submission."}
        confirmLabel={deleteTarget?.type === "assignment" ? "Delete assignment" : "Delete submission"}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "assignment") deleteAssignment(deleteTarget.assignment);
          else deleteSubmission(deleteTarget.submission);
        }}
      />

      {assignmentEditOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit assignment">
          <div className="modal-card">
            <h3 className="surface-title">Edit assignment</h3>
            <p className="meta">Update assignment name and instructions.</p>
            <label className="label form-label-top" htmlFor="edit-assignment-title">Assignment name</label>
            <input id="edit-assignment-title" className="input" value={assignmentTitleDraft} onChange={(event) => setAssignmentTitleDraft(event.target.value)} maxLength={160} />
            <label className="label form-label-top" htmlFor="edit-assignment-instructions">Instructions</label>
            <textarea id="edit-assignment-instructions" className="textarea" rows={4} value={assignmentInstructionsDraft} onChange={(event) => setAssignmentInstructionsDraft(event.target.value)} maxLength={4000} />
            {assignmentError ? <p className="card-inline-error">{assignmentError}</p> : null}
            <div className="actions modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setAssignmentEditOpen(false)} disabled={assignmentSaving}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => void saveAssignmentEdit()} disabled={assignmentSaving}>{assignmentSaving ? "Saving..." : "Save changes"}</button></div>
          </div>
        </div>
      ) : null}

      {undoState ? <UndoToast message={undoState.message} expiresAt={undoState.expiresAt} onUndo={undoDelete} onDismiss={() => setUndoState(null)} /> : null}
    </main>
  );
}

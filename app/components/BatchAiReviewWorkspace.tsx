"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import AudioPlayer from "@/app/components/AudioPlayer";
import type {
  BulkAiBatch,
  BulkAiBatchItem,
  BulkAiBatchSaveItem,
  BulkAiRubricScore,
} from "@/app/components/bulk-ai-grade-runner";
import { saveBulkAiBatchDraft } from "@/app/components/bulk-ai-grade-runner";
import styles from "./BatchAiReviewWorkspace.module.css";

type Rubric = {
  title: string;
  criteria: {
    id: string;
    name: string;
    description: string;
    maxPoints: number;
  }[];
} | null;

export type BatchAiReviewDraft = {
  gradeInput: string;
  feedback: string;
  rubricScoreInputs: Record<string, string>;
  sourceAttemptId?: string | null;
  sourceStatus?: BulkAiBatchItem["status"];
};

type DraftErrors = Record<string, string>;

export type BatchAiReviewWorkspaceProps = {
  batch: BulkAiBatch;
  maxPoints: number;
  rubric: Rubric;
  saving: boolean;
  saveError?: string;
  onSave: (items: BulkAiBatchSaveItem[]) => void | Promise<void>;
  onRetryFailed: (latestBatch?: BulkAiBatch) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
  onBackToManual: () => void;
  onBatchUpdated: (batch: BulkAiBatch) => void;
};

function draftFromItem(item: BulkAiBatchItem): BatchAiReviewDraft {
  return {
    gradeInput: item.draft.grade === null ? "" : String(item.draft.grade),
    feedback: item.draft.feedback ?? "",
    rubricScoreInputs: Object.fromEntries(
      (item.draft.rubricScores ?? []).map((score) => [score.criterionId, String(score.awarded)]),
    ),
    sourceAttemptId: item.attemptId,
    sourceStatus: item.status,
  };
}

function makeDrafts(batch: BulkAiBatch) {
  return Object.fromEntries(batch.items.map((item) => [item.id, draftFromItem(item)]));
}

function rubricScoresMatch(
  left: BulkAiRubricScore[] | null,
  right: BulkAiRubricScore[] | null,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function saveItemMatchesPersistedDraft(item: BulkAiBatchItem, value: BulkAiBatchSaveItem) {
  return item.draft.grade === value.grade &&
    item.draft.feedback === value.feedback &&
    rubricScoresMatch(item.draft.rubricScores, value.rubricScores);
}

function statusLabel(item: BulkAiBatchItem) {
  if (item.status === "review_ready") return "Ready to review";
  if (item.status === "saved") return "Saved";
  if (item.status === "skipped") return "Needs manual grading";
  if (item.status === "conflict") return "Changed since this run";
  if (item.status === "failed") return "AI could not finish";
  if (item.status === "processing") return "Processing";
  return "Waiting";
}

function inputIsWholeNumber(value: string, max: number) {
  if (!value.trim()) return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max;
}

function buildBulkAiReviewValidation(input: {
  batch: BulkAiBatch;
  maxPoints: number;
  rubric: Rubric;
  drafts: Record<string, BatchAiReviewDraft>;
}): { items: BulkAiBatchSaveItem[]; errors: DraftErrors; errorFieldIds: Record<string, string> } {
  const items: BulkAiBatchSaveItem[] = [];
  const errors: DraftErrors = {};
  const errorFieldIds: Record<string, string> = {};

  for (const item of input.batch.items) {
    if (item.status !== "review_ready") continue;
    const draft = input.drafts[item.id] ?? draftFromItem(item);
    let grade = Number(draft.gradeInput);
    let rubricScores: BulkAiRubricScore[] | null = null;

    if (input.rubric) {
      rubricScores = [];
      for (const criterion of input.rubric.criteria) {
        const value = draft.rubricScoreInputs[criterion.id] ?? "";
        if (!inputIsWholeNumber(value, criterion.maxPoints)) {
          errors[item.id] = `${criterion.name} must be a whole number from 0 to ${criterion.maxPoints}.`;
          errorFieldIds[item.id] = `batch-ai-score-${item.id}-${criterion.id}`;
          break;
        }
        rubricScores.push({
          criterionId: criterion.id,
          criterionName: criterion.name,
          maxPoints: criterion.maxPoints,
          awarded: Number(value),
        });
      }
      if (errors[item.id]) continue;
      grade = rubricScores.reduce((sum, score) => sum + score.awarded, 0);
    } else if (!inputIsWholeNumber(draft.gradeInput, input.maxPoints)) {
      errors[item.id] = `Score must be a whole number from 0 to ${input.maxPoints}.`;
      errorFieldIds[item.id] = `batch-ai-score-${item.id}`;
      continue;
    }

    items.push({
      itemId: item.id,
      grade,
      feedback: draft.feedback.trim(),
      rubricScores,
    });
  }

  return { items, errors, errorFieldIds };
}

export function buildBulkAiReviewSaveItems(input: {
  batch: BulkAiBatch;
  maxPoints: number;
  rubric: Rubric;
  drafts: Record<string, BatchAiReviewDraft>;
}): { items: BulkAiBatchSaveItem[]; errors: DraftErrors } {
  const { items, errors } = buildBulkAiReviewValidation(input);
  return { items, errors };
}

export function buildBulkAiReviewDraftSaveItems(input: {
  batch: BulkAiBatch;
  maxPoints: number;
  rubric: Rubric;
  drafts: Record<string, BatchAiReviewDraft>;
}): { items: BulkAiBatchSaveItem[]; errors: DraftErrors } {
  const result = buildBulkAiReviewValidation(input);
  const itemsById = new Map(input.batch.items.map((item) => [item.id, item]));
  return {
    errors: result.errors,
    items: result.items.filter((value) => {
      const item = itemsById.get(value.itemId);
      return item ? !saveItemMatchesPersistedDraft(item, value) : false;
    }),
  };
}

function BatchAiReviewEditor({
  batch,
  maxPoints,
  rubric,
  saving,
  saveError = "",
  onSave,
  onRetryFailed,
  onDismiss,
  onBackToManual,
  onBatchUpdated,
}: BatchAiReviewWorkspaceProps) {
  const [drafts, setDrafts] = useState<Record<string, BatchAiReviewDraft>>(() => makeDrafts(batch));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [errorFieldIds, setErrorFieldIds] = useState<Record<string, string>>({});
  const [draftSaveStatus, setDraftSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("saved");
  const [draftSaveError, setDraftSaveError] = useState("");
  const [actionFlushing, setActionFlushing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const draftsRef = useRef(drafts);
  const batchRef = useRef(batch);
  const draftSaveInFlightRef = useRef<Promise<{ batch: BulkAiBatch }> | null>(null);
  const onBatchUpdatedRef = useRef(onBatchUpdated);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    batchRef.current = batch;
  }, [batch]);

  useEffect(() => {
    onBatchUpdatedRef.current = onBatchUpdated;
  }, [onBatchUpdated]);

  const reviewItems = useMemo(
    () => batch.items.filter((item) => item.status === "review_ready"),
    [batch.items],
  );
  const exceptionItems = useMemo(
    () => batch.items.filter((item) => ["failed", "skipped", "conflict"].includes(item.status)),
    [batch.items],
  );

  function updateDraft(itemId: string, update: Partial<BatchAiReviewDraft>) {
    setDrafts((previous) => {
      const next = {
        ...previous,
        [itemId]: {
          ...(previous[itemId] ?? { gradeInput: "", feedback: "", rubricScoreInputs: {} }),
          ...update,
        },
      };
      draftsRef.current = next;
      return next;
    });
    setErrors((previous) => ({ ...previous, [itemId]: "" }));
    setErrorFieldIds((previous) => ({ ...previous, [itemId]: "" }));
    setDraftSaveStatus("idle");
    setDraftSaveError("");
  }

  const persistValidDrafts = useCallback(async (): Promise<{
    ok: boolean;
    batch: BulkAiBatch;
  }> => {
    if (draftSaveInFlightRef.current) {
      try {
        await draftSaveInFlightRef.current;
      } catch {
        // The newest local draft gets one fresh attempt below.
      }
    }

    const currentBatch = batchRef.current;
    const pending = buildBulkAiReviewDraftSaveItems({
      batch: currentBatch,
      maxPoints,
      rubric,
      drafts: draftsRef.current,
    });
    if (pending.items.length === 0) {
      setDraftSaveStatus(Object.keys(pending.errors).length > 0 ? "idle" : "saved");
      return { ok: true, batch: currentBatch };
    }

    setDraftSaveStatus("saving");
    setDraftSaveError("");
    const request = saveBulkAiBatchDraft({
      batchId: currentBatch.id,
      items: pending.items,
    });
    draftSaveInFlightRef.current = request;
    try {
      const result = await request;
      batchRef.current = result.batch;
      onBatchUpdatedRef.current(result.batch);
      const remaining = buildBulkAiReviewDraftSaveItems({
        batch: result.batch,
        maxPoints,
        rubric,
        drafts: draftsRef.current,
      });
      setDraftSaveStatus(
        remaining.items.length > 0 || Object.keys(remaining.errors).length > 0
          ? "idle"
          : "saved",
      );
      return { ok: true, batch: result.batch };
    } catch (error) {
      setDraftSaveStatus("error");
      setDraftSaveError(
        error instanceof Error
          ? error.message
          : "Review draft could not be saved. Your edits are still on this page.",
      );
      return { ok: false, batch: currentBatch };
    } finally {
      if (draftSaveInFlightRef.current === request) {
        draftSaveInFlightRef.current = null;
      }
    }
  }, [maxPoints, rubric]);

  useEffect(() => {
    if (draftSaveStatus !== "idle") return;
    const timer = window.setTimeout(() => {
      void persistValidDrafts();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draftSaveStatus, drafts, persistValidDrafts]);

  function focusFirstError(result: ReturnType<typeof buildBulkAiReviewValidation>) {
    setErrors(result.errors);
    setErrorFieldIds(result.errorFieldIds);
    const firstErrorId = Object.keys(result.errors)[0];
    if (!firstErrorId) return false;
    window.requestAnimationFrame(() => {
      const field = document.getElementById(result.errorFieldIds[firstErrorId]);
      field?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
      field?.focus({ preventScroll: true });
    });
    return true;
  }

  async function flushValidReviewDrafts() {
    const validation = buildBulkAiReviewValidation({
      batch: batchRef.current,
      maxPoints,
      rubric,
      drafts: draftsRef.current,
    });
    if (focusFirstError(validation)) return null;
    const persisted = await persistValidDrafts();
    return persisted.ok ? { batch: persisted.batch, items: validation.items } : null;
  }

  async function submitReview() {
    setActionFlushing(true);
    try {
      const flushed = await flushValidReviewDrafts();
      if (!flushed) return;
      await onSave(flushed.items);
    } finally {
      setActionFlushing(false);
    }
  }

  async function retryFailed() {
    setActionFlushing(true);
    try {
      const flushed = await flushValidReviewDrafts();
      if (!flushed) return;
      await onRetryFailed(flushed.batch);
    } finally {
      setActionFlushing(false);
    }
  }

  async function backToManual() {
    setActionFlushing(true);
    try {
      const flushed = await flushValidReviewDrafts();
      if (!flushed) return;
      onBackToManual();
    } finally {
      setActionFlushing(false);
    }
  }

  const controlsDisabled = saving || actionFlushing;
  const canDismissTerminalBatch =
    reviewItems.length === 0 &&
    batch.counts.queued === 0 &&
    batch.counts.processing === 0 &&
    exceptionItems.length > 0;
  const draftStatusMessage = draftSaveStatus === "saving" || actionFlushing
    ? "Saving review draft..."
    : draftSaveStatus === "error"
      ? draftSaveError || "Review draft could not be saved. Your edits are still on this page."
      : draftSaveStatus === "idle"
        ? "Changes not saved yet."
        : "Review draft saved.";

  return (
    <section className={styles.workspace} aria-labelledby="batch-ai-review-title">
      <div className={styles.reviewHeader}>
        <div className={styles.reviewHeading}>
          <span className={styles.eyebrow}><Sparkles size={16} aria-hidden="true" /> AI review workspace</span>
          <h3 id="batch-ai-review-title" ref={headingRef} tabIndex={-1}>Review every suggestion</h3>
          <p>Nothing below is visible to students until you choose <strong>Save all scores</strong>.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void backToManual()} disabled={controlsDisabled}>
          <ChevronLeft size={16} aria-hidden="true" /> Back to individual grading
        </button>
      </div>

      <div className={styles.draftPersistence} data-state={draftSaveStatus}>
        <span role={draftSaveStatus === "error" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
          {draftStatusMessage}
        </span>
        {draftSaveStatus === "error" ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void persistValidDrafts()}>
            Retry draft save
          </button>
        ) : null}
      </div>

      <div className={styles.summary} aria-label="AI grading review summary">
        <div><strong>{reviewItems.length}</strong><span>Ready to review</span></div>
        <div><strong>{batch.counts.failed}</strong><span>Failed</span></div>
        <div><strong>{batch.counts.skipped + batch.counts.conflict}</strong><span>Need you</span></div>
        <div><strong>{batch.newUnitsRequired}</strong><span>Max new units</span></div>
      </div>

      {saveError ? <p className={styles.errorBanner} role="alert">{saveError}</p> : null}

      {reviewItems.length > 0 ? (
        <div className={styles.reviewList}>
          {reviewItems.map((item, index) => {
            const draft = drafts[item.id] ?? draftFromItem(item);
            const attempt = item.attempt;
            const rubricTotal = rubric
              ? rubric.criteria.reduce(
                  (sum, criterion) => sum + (Number(draft.rubricScoreInputs[criterion.id]) || 0),
                  0,
                )
              : null;

            return (
              <article
                key={item.id}
                id={`batch-ai-review-${item.id}`}
                className={styles.reviewCard}
                aria-labelledby={`batch-ai-student-${item.id}`}
              >
                <div className={styles.studentRow}>
                  <div>
                    <span className={styles.position}>Suggestion {index + 1} of {reviewItems.length}</span>
                    <h4 id={`batch-ai-student-${item.id}`}>{item.studentName}</h4>
                    <p>{item.studentEmail || "No email captured"}</p>
                  </div>
                  <span className={styles.readyBadge}><CheckCircle2 size={15} aria-hidden="true" /> {statusLabel(item)}</span>
                </div>

                <div className={styles.editorGrid}>
                  <div className={styles.scoreEditor}>
                    {rubric ? (
                      <>
                        <div className={styles.totalScore} aria-live="polite">
                          <span>Total score</span>
                          <strong>{rubricTotal} / {maxPoints}</strong>
                        </div>
                        <div className={styles.rubricGrid}>
                          {rubric.criteria.map((criterion) => (
                            <label key={criterion.id} className={styles.criterion}>
                              <span><strong>{criterion.name}</strong>{criterion.description ? <small>{criterion.description}</small> : null}</span>
                              <span className={styles.scoreField}>
                                <input
                                  id={`batch-ai-score-${item.id}-${criterion.id}`}
                                  className="input score-input"
                                  type="number"
                                  min={0}
                                  max={criterion.maxPoints}
                                  step={1}
                                  inputMode="numeric"
                                  value={draft.rubricScoreInputs[criterion.id] ?? ""}
                                  onChange={(event) => updateDraft(item.id, {
                                    rubricScoreInputs: {
                                      ...draft.rubricScoreInputs,
                                      [criterion.id]: event.target.value,
                                    },
                                  })}
                                  disabled={controlsDisabled}
                                  aria-invalid={errorFieldIds[item.id] === `batch-ai-score-${item.id}-${criterion.id}` || undefined}
                                  aria-describedby={errorFieldIds[item.id] === `batch-ai-score-${item.id}-${criterion.id}` ? `batch-ai-error-${item.id}` : undefined}
                                />
                                <span>/ {criterion.maxPoints}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </>
                    ) : (
                      <label className={styles.scoreLabel}>
                        <span>Score</span>
                        <span className={styles.scoreField}>
                          <input
                            id={`batch-ai-score-${item.id}`}
                            className="input score-input"
                            type="number"
                            min={0}
                            max={maxPoints}
                            step={1}
                            inputMode="numeric"
                            value={draft.gradeInput}
                            onChange={(event) => updateDraft(item.id, { gradeInput: event.target.value })}
                            disabled={controlsDisabled}
                            aria-invalid={errorFieldIds[item.id] === `batch-ai-score-${item.id}` || undefined}
                            aria-describedby={errors[item.id] ? `batch-ai-error-${item.id}` : undefined}
                          />
                          <span>/ {maxPoints}</span>
                        </span>
                      </label>
                    )}
                  </div>

                  <label className={styles.feedbackEditor}>
                    <span>Feedback for {item.studentName}</span>
                    <textarea
                      className="textarea"
                      rows={5}
                      value={draft.feedback}
                      onChange={(event) => updateDraft(item.id, { feedback: event.target.value })}
                      disabled={controlsDisabled}
                    />
                  </label>
                </div>

                <div className={styles.audioReview}>
                  <span>Listen before saving</span>
                  <AudioPlayer
                    src={`/api/submissions/${encodeURIComponent(item.submissionId)}/audio`}
                    variant="compact"
                  />
                </div>

                {errors[item.id] ? (
                  <p id={`batch-ai-error-${item.id}`} className={styles.fieldError} role="alert">
                    {errors[item.id]}
                  </p>
                ) : null}

                <details className={styles.aiDetails}>
                  <summary>Why AI suggested this</summary>
                  <div>
                    {attempt?.confidence ? <p><strong>Confidence:</strong> {attempt.confidence}</p> : null}
                    {attempt?.warnings?.length ? <p><strong>Check closely:</strong> {attempt.warnings.join("; ")}</p> : null}
                    {attempt?.strengths?.length ? <p><strong>Strengths:</strong> {attempt.strengths.join("; ")}</p> : null}
                    {attempt?.improvements?.length ? <p><strong>Improvements:</strong> {attempt.improvements.join("; ")}</p> : null}
                    {attempt?.evidence?.length ? <p><strong>Evidence:</strong> {attempt.evidence.join("; ")}</p> : null}
                    {attempt?.transcript ? <p><strong>Transcript:</strong> {attempt.transcript}</p> : null}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyReview}>
          <CheckCircle2 size={24} aria-hidden="true" />
          <div><strong>No AI suggestions are waiting.</strong><p>Use individual grading for anything that still needs a score.</p></div>
        </div>
      )}

      {exceptionItems.length > 0 ? (
        <section className={styles.exceptions} aria-labelledby="batch-ai-exceptions-title">
          <div className={styles.exceptionHeader}>
            <div>
              <h4 id="batch-ai-exceptions-title"><AlertTriangle size={18} aria-hidden="true" /> Needs your attention</h4>
              <p>These submissions were not changed. Grade them manually, or retry temporary failures.</p>
            </div>
            <div className={styles.exceptionActions}>
              {batch.counts.failed > 0 ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retryFailed()} disabled={controlsDisabled}>
                  <RotateCcw size={15} aria-hidden="true" /> Retry failed
                </button>
              ) : null}
              {canDismissTerminalBatch ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onDismiss()} disabled={controlsDisabled}>
                  Dismiss this batch
                </button>
              ) : null}
            </div>
          </div>
          <ul>
            {exceptionItems.map((item) => (
              <li key={item.id}>
                <strong>{item.studentName}</strong>
                <span>{statusLabel(item)}{item.errorMessage ? ` - ${item.errorMessage}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.saveBar}>
        <div aria-live="polite" aria-atomic="true">
          <strong>{reviewItems.length} score{reviewItems.length === 1 ? "" : "s"} ready</strong>
          <span>{saving ? "Saving the reviewed scores..." : "Students will see them only after you save."}</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void submitReview()}
          disabled={controlsDisabled || reviewItems.length === 0}
        >
          <Save size={17} aria-hidden="true" /> {saving ? "Saving all scores..." : "Save all scores"}
        </button>
      </div>
    </section>
  );
}

export default function BatchAiReviewWorkspace(props: BatchAiReviewWorkspaceProps) {
  // A server retry can turn an exception into a new suggestion without changing
  // the batch id. Remount only when an item's attempt or status changes; ordinary
  // parent renders preserve the teacher's in-progress edits.
  const reviewRevision = props.batch.items
    .map((item) => `${item.id}:${item.attemptId ?? "none"}:${item.status}`)
    .join("|");
  return <BatchAiReviewEditor key={`${props.batch.id}:${reviewRevision}`} {...props} />;
}

"use client";

export type BulkAiAttempt = {
  id: string;
  status: "completed" | "failed";
  transcript: string;
  suggestedScore: number | null;
  rubricScores: {
    criterionId: string;
    criterionName: string;
    maxPoints: number;
    awarded: number;
  }[];
  feedback: string;
  strengths: string[];
  improvements: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
  teacherAttention: string;
  errorMessage: string;
  gradeApplied?: boolean;
};

export type BulkAiGradeRunSummary = {
  total: number;
  completed: number;
  graded: number;
  reviewOnly: number;
  skipped: number;
  failed: number;
  uncertain: number;
  notProcessed: number;
};

export type BulkAiGradeItemResult = {
  submissionId: string;
  outcome: "graded" | "review_only" | "skipped" | "failed" | "uncertain";
  attempt: BulkAiAttempt | null;
  message: string;
};

export type BulkAiBatchStatus =
  | "queued"
  | "processing"
  | "review_ready"
  | "partial_failure"
  | "saved"
  | "cancelled";

export type BulkAiBatchItemStatus =
  | "queued"
  | "processing"
  | "review_ready"
  | "failed"
  | "skipped"
  | "saved"
  | "conflict";

export type BulkAiRubricScore = {
  criterionId: string;
  criterionName: string;
  maxPoints: number;
  awarded: number;
};

export type BulkAiBatchItem = {
  id: string;
  submissionId: string;
  studentName: string;
  studentEmail: string;
  submittedAt: number;
  ordinal: number;
  status: BulkAiBatchItemStatus;
  attemptId: string | null;
  errorCode: string;
  errorMessage: string;
  retryCount: number;
  teacherEdited: boolean;
  draft: {
    grade: number | null;
    rubricScores: BulkAiRubricScore[] | null;
    feedback: string;
  };
  attempt: BulkAiAttempt | null;
  updatedAt: number;
};

export type BulkAiBatch = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  assignmentFingerprint: string;
  status: BulkAiBatchStatus;
  eligibleCount: number;
  newUnitsRequired: number;
  transcriptsRequired: number;
  savedTranscripts: number;
  enhanced: boolean;
  counts: {
    total: number;
    queued: number;
    processing: number;
    reviewReady: number;
    failed: number;
    skipped: number;
    saved: number;
    conflict: number;
  };
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  savedAt: number | null;
  items: BulkAiBatchItem[];
};

export type BulkAiBatchSaveItem = {
  itemId: string;
  grade: number;
  feedback: string;
  rubricScores: BulkAiRubricScore[] | null;
};

export class BulkAiBatchRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: Record<string, unknown> | null;

  constructor(input: {
    message: string;
    status: number;
    code?: string;
    payload?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "BulkAiBatchRequestError";
    this.status = input.status;
    this.code = input.code ?? "";
    this.payload = input.payload ?? null;
  }
}

export function bulkAiPreflightFromScopeError<T extends { assignmentId: string }>(
  error: unknown,
  expectedAssignmentId: string,
): T | null {
  if (!(error instanceof BulkAiBatchRequestError)) return null;
  if (error.code !== "confirmation_scope_changed") return null;
  const preflight = error.payload?.preflight;
  if (!preflight || typeof preflight !== "object") return null;
  if ((preflight as { assignmentId?: unknown }).assignmentId !== expectedAssignmentId) {
    return null;
  }
  return preflight as T;
}

type BulkAiGradeRunInput = {
  submissionIds: string[];
  cooldownSeconds: number;
  fetchImpl?: typeof fetch;
  waitImpl?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  onItem?: (item: BulkAiGradeItemResult) => void;
  onProgress?: (summary: BulkAiGradeRunSummary, processed: number) => void;
};

type GradeResponse = {
  attempt?: BulkAiAttempt | null;
  gradeApplied?: boolean;
  error?: string;
};

const SKIPPED_STATUSES = new Set([404, 413, 422]);
const TERMINAL_STATUSES = new Set([401, 403, 409, 429, 503]);

function abortError() {
  const error = new Error("Bulk AI grading was stopped.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortError();
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      globalThis.clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function uniqueSubmissionIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function snapshot(summary: BulkAiGradeRunSummary) {
  return { ...summary };
}

async function batchJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: unknown; code?: unknown })
    | null;
  if (!response.ok) {
    throw new BulkAiBatchRequestError({
      message:
        typeof payload?.error === "string" && payload.error.trim()
          ? payload.error
          : `AI grading request failed (status ${response.status}).`,
      status: response.status,
      code: typeof payload?.code === "string" ? payload.code : "",
      payload,
    });
  }
  if (!payload) {
    throw new BulkAiBatchRequestError({
      message: "TryHabla could not confirm the AI grading response. Reload before retrying.",
      status: response.status,
      code: "invalid_response",
    });
  }
  return payload as T;
}

export async function createOrResumeBulkAiBatch(input: {
  assignmentId: string;
  idempotencyKey: string;
  confirmationToken: string;
  enhanced?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(
    `/api/assignments/${encodeURIComponent(input.assignmentId)}/ai-grade-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: input.idempotencyKey,
        confirmationToken: input.confirmationToken,
        confirmed: true,
        enhanced: input.enhanced === true,
      }),
      signal: input.signal,
    },
  );
  return batchJson<{ created: boolean; batch: BulkAiBatch }>(response);
}

export async function saveBulkAiBatchDraft(input: {
  batchId: string;
  items: BulkAiBatchSaveItem[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(
    `/api/ai-grading-batches/${encodeURIComponent(input.batchId)}/draft`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: input.items }),
      cache: "no-store",
      signal: input.signal,
    },
  );
  return batchJson<{ batch: BulkAiBatch }>(response);
}

export async function closeBulkAiBatch(input: {
  batchId: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(
    `/api/ai-grading-batches/${encodeURIComponent(input.batchId)}/close`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
      cache: "no-store",
      signal: input.signal,
    },
  );
  return batchJson<{ closed: boolean; batch: BulkAiBatch }>(response);
}

export async function loadBulkAiBatch(input: {
  batchId: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(
    `/api/ai-grading-batches/${encodeURIComponent(input.batchId)}`,
    { cache: "no-store", signal: input.signal },
  );
  return (await batchJson<{ batch: BulkAiBatch }>(response)).batch;
}

export async function advanceBulkAiBatch(input: {
  batchId: string;
  retryFailed?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(
    `/api/ai-grading-batches/${encodeURIComponent(input.batchId)}/next`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retryFailed: input.retryFailed === true }),
      signal: input.signal,
    },
  );
  return batchJson<{
    processedItemId: string | null;
    done: boolean;
    batch: BulkAiBatch;
  }>(response);
}

/**
 * Advances the server-persisted batch one item at a time. The batch itself is
 * the progress checkpoint, so closing or reloading the page never restarts
 * successful items and never turns a lost response into a duplicate charge.
 */
export async function runBulkAiBatch(input: {
  batch: BulkAiBatch;
  retryFailed?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (batch: BulkAiBatch) => void;
}) {
  let batch = input.batch;
  const retryBudget = input.retryFailed ? batch.counts.failed : 0;
  const retriedItems = new Set<string>();

  while (true) {
    throwIfAborted(input.signal);
    const hasQueuedWork =
      batch.status === "queued" ||
      batch.status === "processing" ||
      batch.counts.queued > 0 ||
      batch.counts.processing > 0;
    const untriedFailedItems = batch.items.filter(
      (item) => item.status === "failed" && !retriedItems.has(item.id),
    );
    const canRetryFailure =
      input.retryFailed === true &&
      !hasQueuedWork &&
      untriedFailedItems.length > 0 &&
      retriedItems.size < retryBudget;
    if (!hasQueuedWork && !canRetryFailure) break;

    const result = await advanceBulkAiBatch({
      batchId: batch.id,
      retryFailed: canRetryFailure,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
    });
    batch = result.batch;
    input.onProgress?.(batch);

    if (canRetryFailure && result.processedItemId) {
      if (retriedItems.has(result.processedItemId)) break;
      retriedItems.add(result.processedItemId);
    }
    if (!result.processedItemId && result.done) break;
  }

  return batch;
}

export async function saveBulkAiBatch(input: {
  batchId: string;
  items: BulkAiBatchSaveItem[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(
    `/api/ai-grading-batches/${encodeURIComponent(input.batchId)}/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, items: input.items }),
      signal: input.signal,
    },
  );
  return batchJson<{ saved: boolean; batch: BulkAiBatch }>(response);
}

/**
 * Runs assignment-wide grading as independent, retry-safe requests. A closed
 * page can be resumed later because every successful item is committed before
 * the next request begins; no classroom-sized server request is kept open.
 */
export async function runBulkAiGradeRequests(
  input: BulkAiGradeRunInput,
): Promise<BulkAiGradeRunSummary & { terminalError: string }> {
  const submissionIds = uniqueSubmissionIds(input.submissionIds);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const summary: BulkAiGradeRunSummary = {
    total: submissionIds.length,
    completed: 0,
    graded: 0,
    reviewOnly: 0,
    skipped: 0,
    failed: 0,
    uncertain: 0,
    notProcessed: 0,
  };
  let terminalError = "";

  for (const [index, submissionId] of submissionIds.entries()) {
    throwIfAborted(input.signal);
    if (index > 0 && input.cooldownSeconds > 0) {
      if (input.waitImpl) await input.waitImpl(input.cooldownSeconds * 1_000);
      else await wait(input.cooldownSeconds * 1_000, input.signal);
      throwIfAborted(input.signal);
    }

    let item: BulkAiGradeItemResult;
    let terminal = false;
    try {
      const response = await fetchImpl(
        `/api/submissions/${encodeURIComponent(submissionId)}/ai-grade`,
        { method: "POST", signal: input.signal },
      );
      const payload = (await response.json().catch(() => null)) as GradeResponse | null;
      if (!response.ok) {
        const skipped = SKIPPED_STATUSES.has(response.status);
        terminal = TERMINAL_STATUSES.has(response.status);
        if (skipped) summary.skipped += 1;
        else summary.failed += 1;
        item = {
          submissionId,
          outcome: skipped ? "skipped" : "failed",
          attempt: null,
          message: payload?.error?.trim() || "AI grading failed.",
        };
      } else if (payload?.attempt?.status === "completed") {
        const gradeApplied =
          payload.gradeApplied === true && payload.attempt.suggestedScore !== null;
        const attempt = { ...payload.attempt, gradeApplied };
        summary.completed += 1;
        if (gradeApplied) summary.graded += 1;
        else summary.reviewOnly += 1;
        item = {
          submissionId,
          outcome: gradeApplied ? "graded" : "review_only",
          attempt,
          message: "",
        };
      } else {
        // A malformed/lost success response is ambiguous: the server may have
        // committed the score before the client lost the response. Never label
        // that row as definitely failed.
        summary.uncertain += 1;
        terminal = true;
        item = {
          submissionId,
          outcome: "uncertain",
          attempt: null,
          message: payload?.error?.trim() || "The saved result could not be confirmed. Reload before retrying.",
        };
      }
    } catch (error) {
      if (input.signal?.aborted) throw abortError();
      summary.uncertain += 1;
      terminal = true;
      item = {
        submissionId,
        outcome: "uncertain",
        attempt: null,
        message:
          error instanceof Error
            ? `${error.message} Reload before retrying; the server may have saved this result.`
            : "The result could not be confirmed. Reload before retrying.",
      };
    }

    input.onItem?.(item);
    if (terminal) {
      summary.notProcessed = submissionIds.length - index - 1;
      terminalError = item.message;
    }
    input.onProgress?.(snapshot(summary), index + 1);
    if (terminal) break;
  }

  return { ...summary, terminalError };
}

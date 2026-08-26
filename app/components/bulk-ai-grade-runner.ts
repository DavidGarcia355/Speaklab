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

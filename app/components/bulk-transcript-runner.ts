"use client";

import {
  prepareBulkTranscriptDownload,
  type BulkTranscriptDownloadResult,
  type BulkTranscriptSubmission,
} from "@/app/components/bulk-transcript-download";
import { parseTranscriptResponse } from "@/app/components/submission-transcript-response";

type TranscriptFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type BulkTranscriptPreflight = {
  total: number;
  reusedSubmissionIds: string[];
  missingSubmissionIds: string[];
  unreadableSubmissionIds: string[];
};

export type BulkTranscriptRunSummary = {
  total: number;
  generated: number;
  reused: number;
  failed: number;
  uncertain: number;
  notProcessed: number;
  terminalError: string;
  archive: BulkTranscriptDownloadResult;
};

export type BulkTranscriptRunItem = {
  submissionId: string;
  outcome: "generated" | "failed" | "uncertain";
  message: string;
};

type PreflightInput = {
  submissions: BulkTranscriptSubmission[];
  fetchImpl?: TranscriptFetch;
  signal?: AbortSignal;
};

type RunInput = {
  assignmentTitle: string;
  submissions: BulkTranscriptSubmission[];
  preflight: BulkTranscriptPreflight;
  fetchImpl?: TranscriptFetch;
  signal?: AbortSignal;
  generatedAt?: number;
  onItem?: (item: BulkTranscriptRunItem) => void;
  onProgress?: (summary: Omit<BulkTranscriptRunSummary, "archive">, processed: number) => void;
};

const TERMINAL_STATUSES = new Set([401, 403, 409, 429, 503]);

function abortError() {
  const error = new Error("Bulk transcription was stopped.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function responsePayload(response: Response) {
  return (await response.json().catch(() => null)) as unknown;
}

function responseMessage(payload: unknown, fallback: string) {
  const parsed = parseTranscriptResponse(payload);
  return parsed.error || parsed.message || fallback;
}

/**
 * Read-only preflight. A submission is eligible for generation only when its
 * owner-protected transcript GET succeeds and confirms that nothing is saved.
 * Unreadable rows are never POSTed, avoiding duplicate provider work after an
 * ambiguous preflight request.
 */
export async function preflightBulkTranscripts(input: PreflightInput): Promise<BulkTranscriptPreflight> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const ids = uniqueIds(input.submissions.map((item) => item.id));
  const reusedSubmissionIds: string[] = [];
  const missingSubmissionIds: string[] = [];
  const unreadableSubmissionIds: string[] = [];

  // Sequential reads keep load low and make cancellation deterministic.
  for (const submissionId of ids) {
    throwIfAborted(input.signal);
    try {
      const response = await fetchImpl(
        `/api/submissions/${encodeURIComponent(submissionId)}/transcript`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: input.signal,
        },
      );
      const payload = await responsePayload(response);
      if (!response.ok) unreadableSubmissionIds.push(submissionId);
      else if (parseTranscriptResponse(payload).transcript) reusedSubmissionIds.push(submissionId);
      else missingSubmissionIds.push(submissionId);
    } catch {
      if (input.signal?.aborted) throw abortError();
      unreadableSubmissionIds.push(submissionId);
    }
  }

  return {
    total: ids.length,
    reusedSubmissionIds,
    missingSubmissionIds,
    unreadableSubmissionIds,
  };
}

/**
 * Generates only rows proven missing by a prior read-only preflight. Requests
 * are sequential and independently idempotent at the transcript endpoint.
 * Authentication/configuration/allowance conflicts stop the run; definite
 * per-recording failures continue; ambiguous responses stop before any retry.
 */
export async function runBulkTranscriptRequests(input: RunInput): Promise<BulkTranscriptRunSummary> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const knownIds = new Set(uniqueIds(input.submissions.map((item) => item.id)));
  const reusedIds = uniqueIds(input.preflight.reusedSubmissionIds).filter((id) => knownIds.has(id));
  const unreadableIds = uniqueIds(input.preflight.unreadableSubmissionIds).filter((id) => knownIds.has(id));
  const reusedSet = new Set(reusedIds);
  const unreadableSet = new Set(unreadableIds);
  // A malformed/stale caller snapshot must never override a positive saved or
  // unreadable classification and accidentally trigger provider work.
  const missingIds = uniqueIds(input.preflight.missingSubmissionIds).filter(
    (id) => knownIds.has(id) && !reusedSet.has(id) && !unreadableSet.has(id),
  );
  const summary = {
    total: knownIds.size,
    generated: 0,
    reused: reusedIds.length,
    failed: 0,
    uncertain: unreadableIds.length,
    notProcessed: 0,
    terminalError: unreadableIds.length
      ? "Some saved transcripts could not be checked. Reload before retrying those recordings."
      : "",
  };

  let processedMissing = 0;
  for (const submissionId of missingIds) {
    throwIfAborted(input.signal);
    let item: BulkTranscriptRunItem;
    let terminal = false;
    try {
      const response = await fetchImpl(
        `/api/submissions/${encodeURIComponent(submissionId)}/transcript`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: input.signal,
        },
      );
      const payload = await responsePayload(response);
      const parsed = parseTranscriptResponse(payload);
      if (!response.ok) {
        terminal = TERMINAL_STATUSES.has(response.status);
        if (response.status === 409) {
          summary.uncertain += 1;
          item = {
            submissionId,
            outcome: "uncertain",
            message: `${responseMessage(payload, "The transcript is in a conflicting state.")} Reload before retrying; another request may have saved it.`,
          };
        } else {
          summary.failed += 1;
          item = {
            submissionId,
            outcome: "failed",
            message: responseMessage(payload, "Transcription failed."),
          };
        }
      } else if (parsed.transcript) {
        summary.generated += 1;
        item = { submissionId, outcome: "generated", message: "" };
      } else {
        terminal = true;
        summary.uncertain += 1;
        item = {
          submissionId,
          outcome: "uncertain",
          message: responseMessage(payload, "The saved transcript could not be confirmed. Reload before retrying."),
        };
      }
    } catch (error) {
      if (input.signal?.aborted) throw abortError();
      terminal = true;
      summary.uncertain += 1;
      item = {
        submissionId,
        outcome: "uncertain",
        message: error instanceof Error
          ? `${error.message} Reload before retrying; the transcript may have been saved.`
          : "The transcript could not be confirmed. Reload before retrying.",
      };
    }

    processedMissing += 1;
    input.onItem?.(item);
    if (terminal) {
      summary.notProcessed = missingIds.length - processedMissing;
      summary.terminalError = item.message;
    }
    input.onProgress?.({ ...summary }, reusedIds.length + unreadableIds.length + processedMissing);
    if (terminal) break;
  }

  throwIfAborted(input.signal);
  const archive = await prepareBulkTranscriptDownload({
    assignmentTitle: input.assignmentTitle,
    submissions: input.submissions,
    fetchImpl,
    generatedAt: input.generatedAt,
    signal: input.signal,
  });
  return { ...summary, archive };
}

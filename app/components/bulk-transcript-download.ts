"use client";

import { strToU8, zipSync } from "fflate";
import {
  buildSubmissionDownloadFilenameBase,
  sanitizeDownloadFilenameBase,
} from "@/app/components/submission-download-filenames";
import { parseTranscriptResponse } from "@/app/components/submission-transcript-response";

export type BulkTranscriptSubmission = {
  id: string;
  studentName: string;
  submittedAt: number;
};

export type BulkTranscriptDownloadResult = {
  total: number;
  included: number;
  unavailable: number;
  needsReview: number;
  archive: Blob | null;
  archiveFilename: string | null;
};

type TranscriptFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type BulkTranscriptDownloadInput = {
  assignmentTitle: string;
  submissions: BulkTranscriptSubmission[];
  fetchImpl?: TranscriptFetch;
  concurrency?: number;
  generatedAt?: number;
  signal?: AbortSignal;
};

type TranscriptOutcome = {
  studentName: string;
  filename: string;
  transcript: string | null;
  quality: "good" | "needs_review" | "";
  reason: "included" | "not_available" | "request_failed";
};

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const REPORT_FILENAME = "TryHabla transcript report.csv";

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function transcriptQualityFrom(value: unknown): TranscriptOutcome["quality"] {
  const root = asObject(value);
  if (!root) return "";
  const containers = [root, asObject(root.item), asObject(root.result), asObject(root.data)].filter(
    (item): item is Record<string, unknown> => item !== null,
  );
  const quality = containers
    .map((container) => cleanString(container.transcriptQuality || container.transcript_quality))
    .find(Boolean)
    ?.toLowerCase();
  if (quality === "good") return "good";
  // A saved transcript without an explicit "good" signal is still useful,
  // but it should never be presented as clean without a teacher checking it.
  return "needs_review";
}

function normalizeConcurrency(value: number | undefined, total: number) {
  const requested = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, requested, Math.max(1, total)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: normalizeConcurrency(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

function safeCsvCell(value: string) {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const neutralized = /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
  const escaped = neutralized.replace(/"/g, '""');
  return escaped.includes(",") || escaped.includes('"') ? `"${escaped}"` : escaped;
}

function uniqueFilename(candidate: string, used: Set<string>) {
  let filename = candidate;
  let suffix = 2;
  while (used.has(filename.toLocaleLowerCase())) {
    const stem = candidate.replace(/\.txt$/i, "");
    filename = `${sanitizeDownloadFilenameBase(`${stem} (${suffix})`, "TryHabla transcript")}.txt`;
    suffix += 1;
  }
  used.add(filename.toLocaleLowerCase());
  return filename;
}

function reportCsv(outcomes: TranscriptOutcome[]) {
  const rows = [["Student", "Transcript file", "Status", "Quality", "Note"]];
  for (const outcome of outcomes) {
    const included = outcome.transcript !== null;
    rows.push([
      outcome.studentName,
      included ? outcome.filename : "",
      included ? "Included" : "Unavailable",
      outcome.quality === "needs_review" ? "Needs teacher review" : outcome.quality === "good" ? "Good" : "",
      outcome.reason === "included"
        ? outcome.quality === "needs_review"
          ? "Included, but the saved transcript was marked for teacher review."
          : "Included."
        : outcome.reason === "not_available"
          ? "No saved transcript was available."
          : "The saved transcript could not be loaded.",
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function archiveDate(value: number | undefined) {
  const date = new Date(value ?? Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "unknown-date";
}

function abortError() {
  const error = new Error("Transcript download preparation was stopped.");
  error.name = "AbortError";
  return error;
}

/**
 * Fetches only already-saved transcripts and prepares one local ZIP download.
 * Every network request is deliberately GET-only: this helper cannot create a
 * transcript, call an AI provider, or consume an AI-assisted recording unit.
 */
export async function prepareBulkTranscriptDownload(
  input: BulkTranscriptDownloadInput,
): Promise<BulkTranscriptDownloadResult> {
  const total = input.submissions.length;
  if (total === 0) {
    return {
      total: 0,
      included: 0,
      unavailable: 0,
      needsReview: 0,
      archive: null,
      archiveFilename: null,
    };
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new Error("Transcript downloads are not supported in this browser.");

  const usedFilenames = new Set<string>();
  const outcomes = await mapWithConcurrency(
    input.submissions,
    normalizeConcurrency(input.concurrency, total),
    async (submission): Promise<TranscriptOutcome> => {
      const filenameBase = buildSubmissionDownloadFilenameBase({
        studentName: submission.studentName,
        assignmentTitle: input.assignmentTitle,
        submittedAt: submission.submittedAt,
        submissionId: submission.id,
      });
      const filename = uniqueFilename(
        `${sanitizeDownloadFilenameBase(`${filenameBase} - transcript`, "TryHabla transcript")}.txt`,
        usedFilenames,
      );

      try {
        if (input.signal?.aborted) {
          return {
            studentName: submission.studentName,
            filename,
            transcript: null,
            quality: "",
            reason: "request_failed",
          };
        }
        const response = await fetchImpl(
          `/api/submissions/${encodeURIComponent(submission.id)}/transcript`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: input.signal,
          },
        );
        if (!response.ok) {
          return {
            studentName: submission.studentName,
            filename,
            transcript: null,
            quality: "",
            reason: "request_failed",
          };
        }

        const payload = (await response.json().catch(() => null)) as unknown;
        const transcript = parseTranscriptResponse(payload).transcript;
        if (!transcript) {
          return {
            studentName: submission.studentName,
            filename,
            transcript: null,
            quality: "",
            reason: "not_available",
          };
        }
        return {
          studentName: submission.studentName,
          filename,
          transcript,
          quality: transcriptQualityFrom(payload),
          reason: "included",
        };
      } catch {
        return {
          studentName: submission.studentName,
          filename,
          transcript: null,
          quality: "",
          reason: "request_failed",
        };
      }
    },
  );
  if (input.signal?.aborted) throw abortError();

  const included = outcomes.filter((outcome) => outcome.transcript !== null).length;
  const needsReview = outcomes.filter(
    (outcome) => outcome.transcript !== null && outcome.quality === "needs_review",
  ).length;
  const unavailable = total - included;
  if (included === 0) {
    return {
      total,
      included,
      unavailable,
      needsReview,
      archive: null,
      archiveFilename: null,
    };
  }

  const files: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const outcome of outcomes) {
    if (outcome.transcript === null) continue;
    const cleanTranscript = outcome.transcript.endsWith("\n")
      ? outcome.transcript
      : `${outcome.transcript}\n`;
    files[outcome.filename] = strToU8(cleanTranscript);
  }
  files[REPORT_FILENAME] = strToU8(reportCsv(outcomes));

  const archiveBytes = zipSync(files, { level: 6 });
  const archiveFilename = `${sanitizeDownloadFilenameBase(
    `TryHabla - ${input.assignmentTitle} - transcripts - ${archiveDate(input.generatedAt)}`,
    "TryHabla transcripts",
  )}.zip`;
  return {
    total,
    included,
    unavailable,
    needsReview,
    archive: new Blob([archiveBytes], { type: "application/zip" }),
    archiveFilename,
  };
}

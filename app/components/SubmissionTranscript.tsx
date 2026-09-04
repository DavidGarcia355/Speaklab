"use client";

import { useCallback, useEffect, useState } from "react";
import { Clipboard, Download, FileText, RefreshCw } from "lucide-react";
import GoogleDriveExportButton from "@/app/components/GoogleDriveExportButton";
import { sanitizeDownloadFilenameBase } from "@/app/components/submission-download-filenames";
import { parseTranscriptResponse } from "@/app/components/submission-transcript-response";

type SubmissionTranscriptProps = {
  submissionId: string;
  studentName: string;
  downloadFilenameBase: string;
};

type TranscriptPhase = "loading" | "idle" | "generating" | "pending" | "ready" | "error";

const PENDING_STATUSES = new Set(["queued", "pending", "processing", "generating"]);
const EMPTY_STATUSES = new Set(["", "idle", "missing", "none", "not_generated", "not_started"]);
const ERROR_STATUSES = new Set(["error", "failed", "unavailable"]);
export const TRANSCRIPTION_USAGE_DISCLOSURE =
  "A successful transcript uses one AI-assisted recording unit; optional grading for this same recording and assignment is included.";

async function readResponseJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function responseError(response: Response, payload: unknown, fallback: string) {
  const parsed = parseTranscriptResponse(payload);
  return parsed.error || parsed.message || `${fallback} (status ${response.status}).`;
}

async function copyPlainText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some school-managed browsers expose Clipboard but block it. Use the
      // selection-based fallback below before reporting an error.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy was blocked by this browser.");
}

function downloadPlainText(text: string, filenameBase: string) {
  const blob = new Blob([text.endsWith("\n") ? text : `${text}\n`], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizeDownloadFilenameBase(`${filenameBase} - transcript`)}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function SubmissionTranscript({
  submissionId,
  studentName,
  downloadFilenameBase,
}: SubmissionTranscriptProps) {
  const [phase, setPhase] = useState<TranscriptPhase>("loading");
  const [transcript, setTranscript] = useState("");
  const [message, setMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const endpoint = `/api/submissions/${encodeURIComponent(submissionId)}/transcript`;

  const loadTranscript = useCallback(async (signal?: AbortSignal) => {
    setPhase((current) => (current === "ready" ? current : "loading"));
    setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const payload = await readResponseJson(response);
      if (!response.ok) {
        throw new Error(responseError(response, payload, "Could not load the transcript"));
      }

      const parsed = parseTranscriptResponse(payload);
      if (parsed.transcript) {
        setTranscript(parsed.transcript);
        setPhase("ready");
        return;
      }
      setTranscript("");
      if (PENDING_STATUSES.has(parsed.status)) {
        setPhase("pending");
        setMessage(parsed.message || "The transcript is still processing.");
      } else if (ERROR_STATUSES.has(parsed.status)) {
        setPhase("error");
        setMessage(parsed.error || parsed.message || "The transcript could not be generated.");
      } else if (EMPTY_STATUSES.has(parsed.status)) {
        setPhase("idle");
      } else {
        setPhase("idle");
        setMessage(parsed.message);
      }
    } catch (error) {
      if (signal?.aborted) return;
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Could not load the transcript.");
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTranscript(controller.signal);
    return () => controller.abort();
  }, [loadTranscript]);

  async function transcribeRecording() {
    if (phase === "generating") return;
    setPhase("generating");
    setMessage("");
    setActionMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const payload = await readResponseJson(response);
      if (!response.ok) {
        throw new Error(responseError(response, payload, "Could not transcribe this recording"));
      }

      const parsed = parseTranscriptResponse(payload);
      if (parsed.transcript) {
        setTranscript(parsed.transcript);
        setPhase("ready");
        setActionMessage("Transcript ready.");
        return;
      }
      if (PENDING_STATUSES.has(parsed.status)) {
        setPhase("pending");
        setMessage(parsed.message || "The transcript is processing. Refresh it in a moment.");
        return;
      }
      if (ERROR_STATUSES.has(parsed.status)) {
        throw new Error(parsed.error || parsed.message || "The transcript could not be generated.");
      }
      throw new Error(
        parsed.message || "Transcription finished without any transcript text. Check the recording and try again.",
      );
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Could not transcribe this recording.");
    }
  }

  async function copyTranscript() {
    if (!transcript) return;
    setActionMessage("");
    try {
      await copyPlainText(transcript);
      setActionMessage("Transcript copied.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not copy the transcript.");
    }
  }

  function downloadTranscript() {
    if (!transcript) return;
    try {
      downloadPlainText(transcript, downloadFilenameBase);
      setActionMessage("Transcript downloaded.");
    } catch {
      setActionMessage("Could not download the transcript. Try copying it instead.");
    }
  }

  return (
    <section className="submission-transcript" aria-busy={phase === "loading" || phase === "generating"}>
      <div className="submission-transcript-heading">
        <div>
          <h3 className="submission-transcript-title">
            <FileText size={16} aria-hidden="true" /> Transcript
          </h3>
          <p className="meta">Read, copy, or download the transcript while you review this recording.</p>
        </div>
        {phase === "ready" ? <span className="pill pill-success">Ready</span> : null}
      </div>

      {phase === "loading" ? <p className="meta submission-transcript-status">Checking for a saved transcript...</p> : null}

      {phase === "idle" ? (
        <div className="submission-transcript-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void transcribeRecording()}>
            Transcribe recording
          </button>
          <span className="meta submission-transcript-allowance">
            {TRANSCRIPTION_USAGE_DISCLOSURE}
          </span>
          {message ? <span className="meta">{message}</span> : null}
        </div>
      ) : null}

      {phase === "generating" ? (
        <p className="meta submission-transcript-status" role="status">Transcribing recording...</p>
      ) : null}

      {phase === "pending" ? (
        <div>
          <p className="meta submission-transcript-status" role="status">{message}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadTranscript()}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh transcript
          </button>
        </div>
      ) : null}

      {phase === "ready" ? (
        <>
          <div className="submission-transcript-text" tabIndex={0}>{transcript}</div>
          <div className="submission-transcript-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyTranscript()}>
              <Clipboard size={14} aria-hidden="true" /> Copy transcript
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTranscript}>
              <Download size={14} aria-hidden="true" /> Download transcript
            </button>
            <GoogleDriveExportButton
              submissionId={submissionId}
              studentName={studentName}
              filenameBase={downloadFilenameBase}
            />
          </div>
        </>
      ) : null}

      {phase === "error" ? (
        <div>
          <p className="card-inline-error" role="alert">{message}</p>
          <div className="submission-transcript-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadTranscript()}>
              <RefreshCw size={14} aria-hidden="true" /> Retry
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void transcribeRecording()}>
              Transcribe recording
            </button>
            <span className="meta submission-transcript-allowance">
              {TRANSCRIPTION_USAGE_DISCLOSURE}
            </span>
          </div>
        </div>
      ) : null}

      <p className="meta submission-transcript-action-message" role="status" aria-live="polite">
        {actionMessage}
      </p>
    </section>
  );
}

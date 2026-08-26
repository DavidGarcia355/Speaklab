"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, LoaderCircle, Mic } from "lucide-react";
import AudioPlayer from "@/app/components/AudioPlayer";
import BrandBar from "@/app/components/BrandBar";
import SignInLink from "@/app/components/SignInLink";
import { STUDENT_AI_GRADING_DISCLOSURE } from "@/lib/ai/student-provenance";
import PageTitle from "@/app/components/PageTitle";
import SchoolNetworkNotice from "@/app/components/SchoolNetworkNotice";
import {
  cleanupFailedMediaRecorderStart,
  describeMicrophoneAccessFailure,
  RECORDER_RUNTIME_FAILURE_MESSAGE,
  RECORDER_START_FAILURE_MESSAGE,
  selectSupportedAudioMimeType,
  stopMediaStreamTracks,
} from "@/lib/media-recorder-safety";
import {
  AUDIO_RECORDING_AUTO_STOP_MESSAGE,
  AUDIO_RECORDING_TIMESLICE_MS,
  AUDIO_UPLOAD_TOO_LARGE_MESSAGE,
  isAudioUploadSizeAllowed,
  shouldAutoStopAudioRecording,
  TARGET_AUDIO_BITS_PER_SECOND,
} from "@/lib/upload-limits";

type AssignmentDetail = {
  id: string;
  classId: string;
  className: string;
  title: string;
  description: string;
  instructions: string;
  targetLanguage: string;
  maxPoints: number;
  maxSubmissions: number;
  maxRecordingSeconds: number;
  autoTranscribe: boolean;
  attachmentName: string;
  attachmentUrl: string;
  attachmentContentType: string;
  createdAt: number;
};

type SessionResponse = {
  user?: {
    name?: string | null;
    email?: string | null;
  };
};

type RecorderState =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "finalizing"
  | "ready"
  | "submitting";
type RecordingStopReason = "manual" | "duration" | "size";
const DEFAULT_MAX_RECORDING_SECONDS = 180;

type BannerTone =
  | "state-idle"
  | "state-requesting-permission"
  | "state-recording"
  | "state-ready"
  | "state-submitting"
  | "state-success"
  | "state-error";

type RecorderBanner = {
  tone: BannerTone;
  icon: ReactNode;
  text: string;
};

type StudentAssignmentClientProps = {
  assignmentId: string;
  localAuthBypassEnabled: boolean;
};

type LoadErrorKind = "none" | "not-found" | "network";

function getRecorderBanner(options: {
  state: RecorderState;
  seconds: number;
  maxSeconds: number;
  statusMsg: string;
  errorMsg: string;
  submittedCurrentRecording: boolean;
}): RecorderBanner {
  const { state, seconds, maxSeconds, statusMsg, errorMsg, submittedCurrentRecording } = options;

  if (errorMsg) {
    return {
      tone: "state-error",
      icon: <AlertTriangle size={16} aria-hidden="true" />,
      text: errorMsg,
    };
  }

  if (submittedCurrentRecording && statusMsg) {
    return {
      tone: "state-success",
      icon: <CheckCircle2 size={16} aria-hidden="true" />,
      text: "Submitted! Your teacher will review your recording.",
    };
  }

  if (state === "requesting-permission") {
    return {
      tone: "state-requesting-permission",
      icon: <LoaderCircle size={16} className="is-spinning" aria-hidden="true" />,
      text: "Requesting microphone permission...",
    };
  }

  if (state === "recording") {
    return {
      tone: "state-recording",
      icon: <CircleDot size={16} aria-hidden="true" />,
      text: `Recording in progress (${seconds}s of ${maxSeconds}s).`,
    };
  }

  if (state === "finalizing") {
    return {
      tone: "state-requesting-permission",
      icon: <LoaderCircle size={16} className="is-spinning" aria-hidden="true" />,
      text: "Finalizing recording...",
    };
  }

  if (state === "submitting") {
    return {
      tone: "state-submitting",
      icon: <LoaderCircle size={16} className="is-spinning" aria-hidden="true" />,
      text: "Submitting response...",
    };
  }

  if (state === "ready") {
    return {
      tone: "state-ready",
      icon: <CheckCircle2 size={16} aria-hidden="true" />,
      text: "Recording ready. Play back, then submit.",
    };
  }

  return {
    tone: "state-idle",
    icon: <Mic size={16} aria-hidden="true" />,
    text: "Ready to record.",
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read audio blob."));
    reader.readAsDataURL(blob);
  });
}

function getSupportedAudioMimeType() {
  return selectSupportedAudioMimeType((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export default function StudentAssignmentClient({
  assignmentId,
  localAuthBypassEnabled,
}: StudentAssignmentClientProps) {
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrorKind, setLoadErrorKind] = useState<LoadErrorKind>("none");
  const [studentName, setStudentName] = useState("");
  const [recordingUrl, setRecordingUrl] = useState("");
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micSupported, setMicSupported] = useState(true);
  const [permissionState, setPermissionState] = useState<"granted" | "denied" | "prompt" | "unknown">(
    "unknown"
  );
  const [submittedCurrentRecording, setSubmittedCurrentRecording] = useState(false);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [studentEmail, setStudentEmail] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("/");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopReasonRef = useRef<RecordingStopReason>("manual");

  useEffect(() => {
    setCallbackUrl(window.location.href);
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setErrorMsg("");
      setLoadErrorKind("none");
      let errorKind: LoadErrorKind = "none";

      try {
        const response = await fetch(`/api/student/assignments/${assignmentId}`, { cache: "no-store" });
        if (!response.ok) {
          let data: { error?: string } | null = null;
          try {
            data = (await response.json()) as { error?: string };
          } catch {
            data = null;
          }
          errorKind = response.status === 404 ? "not-found" : "network";
          throw new Error(
            data?.error ||
              (response.status === 404
                ? "Assignment not found."
                : "Unable to load this assignment right now.")
          );
        }
        const data = (await response.json()) as { item: AssignmentDetail };
        setAssignment(data.item);
      } catch (error) {
        setLoadErrorKind(errorKind === "none" ? "network" : errorKind);
        const message = error instanceof Error ? error.message : "Assignment not found.";
        setErrorMsg(message);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [assignmentId]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setAuthLoading(true);
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load session.");
        const data = (await response.json()) as SessionResponse | null;
        const email = data?.user?.email?.trim().toLowerCase() ?? "";
        const name = data?.user?.name?.trim() ?? "";
        if (cancelled) return;
        setStudentEmail(email);
        setStudentName((prev) => prev || name || (email ? email.split("@")[0] : ""));
      } catch {
        if (cancelled) return;
        setStudentEmail("");
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!studentEmail || !assignmentId) return;
    async function loadSubmissionCount() {
      try {
        const response = await fetch(`/api/student/assignments/${assignmentId}/submissions`, { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as { count: number };
          setSubmissionCount(data.count);
        }
      } catch {
        // non-critical
      }
    }
    void loadSubmissionCount();
  }, [studentEmail, assignmentId, submittedCurrentRecording]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      setMicSupported(false);
      setErrorMsg(
        "This browser does not support audio recording. Open the link in a current version of Chrome, Edge, Firefox, or Safari."
      );
    }
  }, []);

  useEffect(() => {
    async function loadPermissionState() {
      if (!("permissions" in navigator) || !navigator.permissions?.query) return;
      try {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        setPermissionState(status.state);
        status.onchange = () => setPermissionState(status.state);
      } catch {
        setPermissionState("unknown");
      }
    }
    void loadPermissionState();
  }, []);

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [recordingUrl]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopMediaStreamTracks(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  async function startRecording() {
    setStatusMsg("");
    setErrorMsg("");
    if (!micSupported) return;
    setRecorderState("requesting-permission");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const failure = describeMicrophoneAccessFailure(error);
      setRecorderState("idle");
      setPermissionState(failure.permissionDenied ? "denied" : "unknown");
      setErrorMsg(failure.message);
      return;
    }

    streamRef.current = stream;
    setPermissionState("granted");

    try {
      const mimeType = getSupportedAudioMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: TARGET_AUDIO_BITS_PER_SECOND,
        });
      } catch {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      }
      recorderRef.current = recorder;
      stopReasonRef.current = "manual";
      const chunks: Blob[] = [];
      let recordedBytes = 0;
      let sizeStopRequested = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return;
        chunks.push(event.data);
        recordedBytes += event.data.size;

        if (
          !sizeStopRequested &&
          recorder.state === "recording" &&
          shouldAutoStopAudioRecording(recordedBytes)
        ) {
          sizeStopRequested = true;
          stopRecording("size");
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        const stopReason = stopReasonRef.current;
        stopReasonRef.current = "manual";
        if (recorderRef.current === recorder) recorderRef.current = null;
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        if (!isAudioUploadSizeAllowed(blob.size)) {
          setRecordingBlob(null);
          setRecordingUrl("");
          setSubmittedCurrentRecording(false);
          setErrorMsg(AUDIO_UPLOAD_TOO_LARGE_MESSAGE);
          setStatusMsg("");
          stopMediaStreamTracks(stream);
          if (streamRef.current === stream) streamRef.current = null;
          setRecorderState("idle");
          return;
        }
        setRecordingBlob(blob);
        setRecordingUrl(URL.createObjectURL(blob));
        setSubmittedCurrentRecording(false);
        setErrorMsg("");
        if (stopReason === "size") {
          setStatusMsg(AUDIO_RECORDING_AUTO_STOP_MESSAGE);
        } else if (stopReason === "duration") {
          const maxSec = assignment?.maxRecordingSeconds || DEFAULT_MAX_RECORDING_SECONDS;
          setStatusMsg(`Recording stopped automatically at ${maxSec} seconds.`);
        } else {
          setStatusMsg("");
        }
        stopMediaStreamTracks(stream);
        if (streamRef.current === stream) streamRef.current = null;
        setRecorderState("ready");
      };

      recorder.onerror = () => {
        if (recorderRef.current !== recorder) return;
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        cleanupFailedMediaRecorderStart({
          acquiredStream: stream,
          streamRef,
          recorderRef,
          timerRef,
          clearTimer: (timerId) => window.clearInterval(timerId),
        });
        setRecordingBlob(null);
        setRecordingUrl("");
        setSubmittedCurrentRecording(false);
        setStatusMsg("");
        setErrorMsg(RECORDER_RUNTIME_FAILURE_MESSAGE);
        setRecorderState("idle");
      };

      recorder.start(AUDIO_RECORDING_TIMESLICE_MS);
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      setRecordingUrl("");
      setRecordingBlob(null);
      setSubmittedCurrentRecording(false);
      setRecordingSeconds(0);
      setRecorderState("recording");
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          const maxSec = assignment?.maxRecordingSeconds || DEFAULT_MAX_RECORDING_SECONDS;
          if (next >= maxSec) {
            stopRecording("duration");
          }
          return next;
        });
      }, 1000);
    } catch {
      cleanupFailedMediaRecorderStart({
        acquiredStream: stream,
        streamRef,
        recorderRef,
        timerRef,
        clearTimer: (timerId) => window.clearInterval(timerId),
      });
      setRecorderState("idle");
      setPermissionState("granted");
      setErrorMsg(RECORDER_START_FAILURE_MESSAGE);
    }
  }

  function stopRecording(reason: RecordingStopReason = "manual") {
    const recorder = recorderRef.current;
    if (!recorder) return;
    stopReasonRef.current = reason;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      if (recorder.state !== "inactive") recorder.stop();
      setRecorderState("finalizing");
    } catch {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorderRef.current === recorder) recorderRef.current = null;
      stopMediaStreamTracks(streamRef.current);
      streamRef.current = null;
      setRecordingBlob(null);
      setRecordingUrl("");
      setStatusMsg("");
      setErrorMsg(RECORDER_RUNTIME_FAILURE_MESSAGE);
      setRecorderState("idle");
    }
  }

  function clearRecording() {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl("");
    setRecordingBlob(null);
    setRecordingSeconds(0);
    setSubmittedCurrentRecording(false);
    setRecorderState("idle");
    setStatusMsg("");
    setErrorMsg("");
  }

  async function submitResponse() {
    if (!assignment) return;
    if (!studentEmail && !localAuthBypassEnabled) {
      setErrorMsg("Please sign in before submitting.");
      return;
    }

    if (submittedCurrentRecording) {
      setErrorMsg("This recording has already been submitted. Record a new one to submit again.");
      return;
    }

    const cleanName = studentName.trim();
    if (!cleanName) {
      setErrorMsg("Enter your name before submitting.");
      return;
    }
    if (!recordingBlob) {
      setErrorMsg("Record your response first.");
      return;
    }
    if (!isAudioUploadSizeAllowed(recordingBlob.size)) {
      setErrorMsg(AUDIO_UPLOAD_TOO_LARGE_MESSAGE);
      setRecorderState("ready");
      return;
    }

    setRecorderState("submitting");
    setErrorMsg("");
    setStatusMsg("");

    let audioData: string;
    try {
      audioData = await blobToDataUrl(recordingBlob);
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error("blobToDataUrl failed", reason, { blobType: recordingBlob.type, blobSize: recordingBlob.size });
      setErrorMsg(`Couldn't read the recording (${reason}). Try recording again.`);
      setRecorderState("ready");
      return;
    }

    let response: Response;
    try {
      response = await fetch(`/api/assignments/${assignment.id}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: cleanName,
          audioData,
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error("Submit fetch failed", reason);
      setErrorMsg(`Couldn't reach the server (${reason}). Check your connection and try again.`);
      setRecorderState("ready");
      return;
    }

    if (!response.ok) {
      let serverMessage = `HTTP ${response.status}`;
      try {
        const data = (await response.json()) as { error?: string; fieldErrors?: Record<string, string[]> };
        const detail = data.fieldErrors ? Object.values(data.fieldErrors).flat()[0] : undefined;
        if (detail) serverMessage = detail;
        else if (data.error) serverMessage = data.error;
      } catch {
        // response body wasn't JSON — keep the HTTP status as the message
      }
      console.error("Submit rejected by server", { status: response.status, serverMessage });
      setErrorMsg(serverMessage);
      setRecorderState("ready");
      return;
    }

    setSubmittedCurrentRecording(true);
    setSubmissionCount((prev) => prev + 1);
    setStatusMsg("Submitted! Your teacher will review your recording.");
    setRecorderState("ready");
  }

  const maxRecSec = assignment?.maxRecordingSeconds || DEFAULT_MAX_RECORDING_SECONDS;
  const maxSubs = assignment?.maxSubmissions || 0;
  const atSubmissionLimit = maxSubs > 0 && submissionCount >= maxSubs;

  const recorderBanner = getRecorderBanner({
    state: recorderState,
    seconds: recordingSeconds,
    maxSeconds: maxRecSec,
    statusMsg,
    errorMsg,
    submittedCurrentRecording,
  });
  const recorderAnnouncement =
    errorMsg ||
    (recorderState === "recording" ? "Recording started." : recorderBanner.text);

  if (loading) {
    return (
      <main className="page-wrap">
        <p className="meta">Loading assignment...</p>
      </main>
    );
  }

  if (!assignment) {
    return (
      <main className="page-wrap">
        <section className="card">
          <h1 style={{ marginTop: 0 }}>Assignment unavailable</h1>
          <p className="status-danger">{errorMsg || "Assignment not found."}</p>
          {loadErrorKind === "network" ? (
            <SchoolNetworkNotice
              className="student-network-notice"
              message="Having trouble loading? If you're on a school network, try opening this link on your phone."
              storageKey="habla-school-network-student-notice"
            />
          ) : null}
          <div className="actions">
            <Link className="btn btn-ghost" href="/">
              Back home
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-wrap">
      <PageTitle title={`Assignment: ${assignment.title}`} />
      <BrandBar label="Student Submission" />

      <section className="hero student-hero">
        <p className="pill">{assignment.className}</p>
        <h1>{assignment.title}</h1>
        {assignment.description ? <p>{assignment.description}</p> : null}
        <p className="meta">
          Respond in {assignment.targetLanguage || "Spanish"} · Worth {assignment.maxPoints} points
        </p>
      </section>

      <section className="grid cols-2 section-gap">
        <article className="card">
          <h2 className="surface-title">Instructions</h2>
          <p className="meta instruction-copy">
            {assignment.instructions || "Your teacher hasn't added instructions yet."}
          </p>
          {assignment.attachmentUrl ? (
            <div className="notice info assignment-attachment-notice">
              <span>
                Attachment: <strong>{assignment.attachmentName || "Directions file"}</strong>
              </span>
              <a
                className="text-link"
                href={assignment.attachmentUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open attachment
              </a>
            </div>
          ) : null}
        </article>

        <article className="card panel-subtle">
          <h2 className="surface-title">Record your response</h2>
          <div className="record-module">
            {authLoading ? (
              <p className="notice info">Checking sign-in status...</p>
            ) : studentEmail ? (
              <div className="auth-status-bar">
                <p className="notice success auth-status-notice">
                  Signed in as <strong>{studentEmail}</strong>
                </p>
                <div className="auth-status-actions">
                  <a className="btn btn-ghost btn-sm" href="/student">My submissions</a>
                  <a className="btn btn-ghost btn-sm" href={`/api/auth/signout?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
                    Sign out
                  </a>
                </div>
              </div>
            ) : localAuthBypassEnabled ? (
              <p className="notice info">Local dev auth bypass is on — sign-in is skipped. Record and submit below.</p>
            ) : (
              <div className="auth-signin-prompt">
                <p className="meta">Sign in with your school account to submit your recording.</p>
                <SignInLink
                  className="btn btn-primary"
                  callbackUrl={callbackUrl}
                  wrapperClassName="auth-webview-guard-full"
                >
                  Sign in to submit
                </SignInLink>
              </div>
            )}

            <div className="record-top">
              <p className="meta recorder-note">Enter your name, record your response, play it back, then submit.</p>
              <p className="notice info">
                {STUDENT_AI_GRADING_DISCLOSURE}
              </p>
              {assignment.autoTranscribe ? (
                <p className="notice warning">
                  Automatic transcription is on for this assignment. After you submit, TryHabla will
                  send your recording to its configured AI transcription provider and save the transcript
                  for your teacher. This does not automatically grade your work.
                </p>
              ) : null}
              {maxSubs > 0 ? (
                <p className={`notice ${atSubmissionLimit ? "danger" : "info"}`}>
                  {atSubmissionLimit
                    ? `You've used all ${maxSubs} submission${maxSubs === 1 ? "" : "s"}. Delete a previous one from your dashboard to submit again.`
                    : `${submissionCount} of ${maxSubs} submission${maxSubs === 1 ? "" : "s"} used.`}
                </p>
              ) : null}
              {maxRecSec !== DEFAULT_MAX_RECORDING_SECONDS ? (
                <p className="meta">Max recording length: {maxRecSec} seconds</p>
              ) : null}
              <p className={`state-banner ${recorderBanner.tone}`}>
                <span className="state-banner-icon">{recorderBanner.icon}</span>
                <span>{recorderBanner.text}</span>
              </p>
              <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {recorderAnnouncement}
              </p>
              {permissionState === "denied" ? (
                <p className="notice danger">
                  Microphone is blocked. Open browser site settings and allow microphone access.
                </p>
              ) : null}
            </div>

            <div>
              <label className="label" htmlFor="student-name">
                Your name
              </label>
              <input
                id="student-name"
                className="input"
                value={studentName}
                onChange={(event) => setStudentName(event.target.value)}
                placeholder="Your full name"
                maxLength={80}
              />
              <p className="meta field-meta">{studentName.length}/80</p>
            </div>

            <div className="actions record-controls">
              {recorderState !== "recording" ? (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={startRecording}
                  disabled={
                    (!studentEmail && !localAuthBypassEnabled) ||
                    !micSupported ||
                    recorderState === "requesting-permission" ||
                    recorderState === "finalizing" ||
                    recorderState === "submitting" ||
                    atSubmissionLimit
                  }
                >
                  Start recording
                </button>
              ) : (
                <button className="btn btn-danger" type="button" onClick={() => stopRecording()}>
                  Stop recording
                </button>
              )}

              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => void submitResponse()}
                disabled={
                  (!studentEmail && !localAuthBypassEnabled) ||
                  recorderState === "requesting-permission" ||
                  recorderState === "recording" ||
                  recorderState === "finalizing" ||
                  recorderState === "submitting" ||
                  !recordingBlob ||
                  submittedCurrentRecording ||
                  atSubmissionLimit
                }
              >
                {recorderState === "submitting" ? "Submitting..." : "Submit response"}
              </button>

              {recordingBlob ? (
                <button className="btn btn-ghost" type="button" onClick={clearRecording}>
                  Record again
                </button>
              ) : null}
            </div>

            {recordingUrl ? (
              <div className="recording-ready">
                <span className="pill pill-success">Recording ready</span>
                <AudioPlayer src={recordingUrl} variant="default" showSpeed />
              </div>
            ) : null}

            {submittedCurrentRecording && statusMsg ? (
              <div className="submission-success-block">
                <p className="submission-confirm">
                  <CheckCircle2 size={16} aria-hidden="true" /> {statusMsg}
                </p>
                <a className="btn btn-ghost btn-sm" href="/student" style={{ marginTop: "0.5rem" }}>
                  View all your submissions
                </a>
              </div>
            ) : null}
            {!submittedCurrentRecording && statusMsg ? <p className="notice info">{statusMsg}</p> : null}
          </div>
        </article>
      </section>
    </main>
  );
}

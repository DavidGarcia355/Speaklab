"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDot, LoaderCircle, Mic } from "lucide-react";
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
import styles from "./student-assignment.module.css";

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
      text: "Submitted! The recording is ready for teacher review.",
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
  const [submissionAccessState, setSubmissionAccessState] = useState<
    "idle" | "checking" | "allowed" | "blocked"
  >("idle");
  const [submissionAccessError, setSubmissionAccessError] = useState("");

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
    let cancelled = false;

    if (!studentEmail || !assignmentId) {
      setSubmissionAccessState("idle");
      setSubmissionAccessError("");
      return () => {
        cancelled = true;
      };
    }

    async function checkSubmissionAccess() {
      setSubmissionAccessState("checking");
      setSubmissionAccessError("");
      try {
        const response = await fetch(`/api/student/assignments/${assignmentId}/submissions`, { cache: "no-store" });
        let data: { count?: number; error?: string } | null = null;
        try {
          data = (await response.json()) as { count?: number; error?: string };
        } catch {
          data = null;
        }

        if (cancelled) return;
        if (!response.ok) {
          setSubmissionAccessState("blocked");
          setSubmissionAccessError(
            data?.error || "We couldn't verify that this account can submit to this assignment."
          );
          return;
        }

        setSubmissionCount(typeof data?.count === "number" ? data.count : 0);
        setSubmissionAccessState("allowed");
      } catch {
        if (cancelled) return;
        setSubmissionAccessState("blocked");
        setSubmissionAccessError(
          "We couldn't verify access to this assignment. Check your connection and try again."
        );
      }
    }

    void checkSubmissionAccess();
    return () => {
      cancelled = true;
    };
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
    if (!localAuthBypassEnabled && submissionAccessState !== "allowed") {
      setErrorMsg(submissionAccessError || "Wait while we verify that this account can submit.");
      return;
    }
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
    if (!localAuthBypassEnabled && submissionAccessState !== "allowed") {
      setErrorMsg(submissionAccessError || "Wait while we verify that this account can submit.");
      return;
    }

    if (submittedCurrentRecording) {
      setErrorMsg("This recording has already been submitted. Record a new one to submit again.");
      return;
    }

    const cleanName = studentName.trim();
    if (!cleanName) {
      setErrorMsg("Enter a name before submitting.");
      return;
    }
    if (!recordingBlob) {
      setErrorMsg("Record a response first.");
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
      setErrorMsg(`Couldn't reach the server (${reason}). Check the connection and try again.`);
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
    setStatusMsg("Submitted! The recording is ready for teacher review.");
    setRecorderState("ready");
  }

  const maxRecSec = assignment?.maxRecordingSeconds || DEFAULT_MAX_RECORDING_SECONDS;
  const maxSubs = assignment?.maxSubmissions || 0;
  const atSubmissionLimit = maxSubs > 0 && submissionCount >= maxSubs;
  const submissionAccessBlocked =
    !localAuthBypassEnabled && Boolean(studentEmail) && submissionAccessState !== "allowed";

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
    <main className={`page-wrap ${styles.page}`}>
      <PageTitle title={`Assignment: ${assignment.title}`} />
      <BrandBar label="Student Submission" />

      <section className={styles.hero} aria-labelledby="assignment-title">
        <span className={styles.heroEcho} aria-hidden="true">
          Speak
        </span>
        <div className={styles.heroCopy}>
          <p className={`pill ${styles.classPill}`}>{assignment.className}</p>
          <h1 id="assignment-title">{assignment.title}</h1>
          {assignment.description ? <p className={styles.description}>{assignment.description}</p> : null}
          <p className="meta">
            Respond in {assignment.targetLanguage || "Spanish"} · Worth {assignment.maxPoints} points
          </p>
        </div>
      </section>

      <section className={styles.workspace}>
        <article className={styles.instructions}>
          <div className={styles.sectionHeading}>
            <span className={styles.sectionKicker}>Brief</span>
            <h2>Instructions</h2>
          </div>
          <p className={`instruction-copy ${styles.instructionCopy}`}>
            {assignment.instructions || "No instructions have been added yet."}
          </p>
          {assignment.attachmentUrl ? (
            <div className={`notice info assignment-attachment-notice ${styles.attachment}`}>
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

        <article className={styles.responsePanel} aria-labelledby="response-title">
          <div className={styles.responseHeading}>
            <div className={styles.sectionHeading}>
              <span className={styles.sectionKicker}>Recorder</span>
              <h2 id="response-title">My response</h2>
            </div>
            <p>Complete each step, listen once, then send it.</p>
          </div>
          <div className={styles.recordModule}>
            {authLoading ? (
              <p className={`notice info ${styles.authNotice}`}>Checking sign-in status...</p>
            ) : studentEmail ? (
              <div className={styles.authBar}>
                <p className={`notice success auth-status-notice ${styles.authNotice}`}>
                  Signed in as <strong>{studentEmail}</strong>
                </p>
                <div className={`auth-status-actions ${styles.authActions}`}>
                  <a className="btn btn-ghost btn-sm" href="/student">My submissions</a>
                  <a className="btn btn-ghost btn-sm" href={`/api/auth/signout?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
                    Sign out
                  </a>
                </div>
              </div>
            ) : localAuthBypassEnabled ? (
              <p className="notice info">Local dev auth bypass is on — sign-in is skipped. Record and submit below.</p>
            ) : (
              <div className={`auth-signin-prompt ${styles.signInPrompt}`}>
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

            {studentEmail && submissionAccessState === "checking" ? (
              <p className={`notice info ${styles.inlineNotice}`} role="status">
                Verifying access to this assignment...
              </p>
            ) : null}
            {studentEmail && submissionAccessState === "blocked" ? (
              <p className={`notice danger ${styles.inlineNotice}`} role="alert">
                {submissionAccessError}
              </p>
            ) : null}

            <details className={styles.aiDisclosure}>
              <summary>
                <span>How AI may be used</span>
                <span className={styles.disclosureHint}>Optional features &amp; privacy</span>
                <span className={styles.disclosureChevron} aria-hidden="true">
                  <ChevronDown size={17} />
                </span>
              </summary>
              <div className={styles.disclosureBody}>
                <p>{STUDENT_AI_GRADING_DISCLOSURE}</p>
                {assignment.autoTranscribe ? (
                  <p className={styles.autoTranscribeNotice}>
                    Automatic transcription is on for this assignment. After you submit, TryHabla will
                    send the recording to its configured AI transcription provider and save the transcript
                    for teacher review. This does not automatically grade the work.
                  </p>
                ) : null}
              </div>
            </details>

            {maxSubs > 0 ? (
              <p className={`notice ${atSubmissionLimit ? "danger" : "info"} ${styles.limitNotice}`}>
                {atSubmissionLimit
                  ? `Submission limit reached (${maxSubs}). Delete an ungraded recording from My Recordings, or ask your teacher for help.`
                  : `${submissionCount} of ${maxSubs} submission${maxSubs === 1 ? "" : "s"} used.`}
              </p>
            ) : null}

            <div className={styles.steps}>
              <section className={styles.step} aria-labelledby="name-step-title">
                <div className={styles.stepHeader}>
                  <span className={styles.stepNumber} aria-hidden="true">01</span>
                  <div>
                    <h3 id="name-step-title">Name</h3>
                    <p>Identify the recording.</p>
                  </div>
                </div>
                <div className={styles.stepBody}>
                  <label className="label" htmlFor="student-name">
                    My name
                  </label>
                  <input
                    id="student-name"
                    className="input"
                    value={studentName}
                    onChange={(event) => setStudentName(event.target.value)}
                    placeholder="Full name"
                    maxLength={80}
                    aria-describedby="student-name-count"
                  />
                  <p className={`meta field-meta ${styles.fieldMeta}`} id="student-name-count">
                    {studentName.length}/80
                  </p>
                </div>
              </section>

              <section className={styles.step} aria-labelledby="record-step-title">
                <div className={styles.stepHeader}>
                  <span className={styles.stepNumber} aria-hidden="true">02</span>
                  <div>
                    <h3 id="record-step-title">Record</h3>
                    <p>
                      {maxRecSec !== DEFAULT_MAX_RECORDING_SECONDS
                        ? `Up to ${maxRecSec} seconds.`
                        : "Speak clearly and at a natural pace."}
                    </p>
                  </div>
                </div>
                <div className={styles.stepBody}>
                  <p className={`state-banner ${recorderBanner.tone} ${styles.stateBanner}`}>
                    <span className="state-banner-icon">{recorderBanner.icon}</span>
                    <span>{recorderBanner.text}</span>
                  </p>
                  <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {recorderAnnouncement}
                  </p>
                  {permissionState === "denied" ? (
                    <p className={`notice danger ${styles.inlineNotice}`}>
                      Microphone is blocked. Open browser site settings and allow microphone access.
                    </p>
                  ) : null}
                  <div className={`actions record-controls ${styles.stepActions}`}>
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
                          submissionAccessBlocked ||
                          atSubmissionLimit
                        }
                      >
                        <Mic size={17} aria-hidden="true" />
                        Start recording
                      </button>
                    ) : (
                      <button className="btn btn-danger" type="button" onClick={() => stopRecording()}>
                        Stop recording
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section className={`${styles.step} ${styles.reviewStep}`} aria-labelledby="review-step-title">
                <div className={styles.stepHeader}>
                  <span className={styles.stepNumber} aria-hidden="true">03</span>
                  <div>
                    <h3 id="review-step-title">Review &amp; submit</h3>
                    <p>Listen back before sending.</p>
                  </div>
                </div>
                <div className={styles.stepBody}>
                  {submittedCurrentRecording && statusMsg ? (
                    <div className={styles.successPanel}>
                      <div className={styles.successCopy}>
                        <span className={styles.successEyebrow}>
                          <CheckCircle2 size={16} aria-hidden="true" /> Submitted
                        </span>
                        <h3>Recording delivered.</h3>
                        <p>{statusMsg}</p>
                        <div className={`actions ${styles.successActions}`}>
                          <a className="btn btn-primary btn-sm" href="/student">
                            View my submissions
                          </a>
                          {!atSubmissionLimit ? (
                            <button className="btn btn-ghost btn-sm" type="button" onClick={clearRecording}>
                              Record another response
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className={styles.successMascot} aria-hidden="true">
                        <Image
                          src="/mascot/hablaman-student-submission-freedom-v1.png"
                          alt=""
                          fill
                          sizes="(max-width: 720px) 180px, 280px"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      {recordingUrl ? (
                        <div className={styles.recordingReady}>
                          <span className="pill pill-success">Recording ready</span>
                          <AudioPlayer src={recordingUrl} variant="default" showSpeed />
                        </div>
                      ) : (
                        <p className={styles.reviewEmpty}>The playback and submit controls appear after recording.</p>
                      )}

                      <div className={`actions ${styles.stepActions}`}>
                        <button
                          className="btn btn-primary"
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
                            submissionAccessBlocked ||
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
                      {!submittedCurrentRecording && statusMsg ? (
                        <p className={`notice info ${styles.inlineNotice}`}>{statusMsg}</p>
                      ) : null}
                    </>
                  )}
                </div>
              </section>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

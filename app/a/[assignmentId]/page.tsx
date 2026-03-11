"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, LoaderCircle, Mic } from "lucide-react";
import AudioPlayer from "@/app/components/AudioPlayer";
import BrandBar from "@/app/components/BrandBar";

type AssignmentDetail = {
  id: string;
  classId: string;
  className: string;
  title: string;
  description: string;
  instructions: string;
  createdAt: number;
};

type SessionResponse = {
  user?: {
    name?: string | null;
    email?: string | null;
  };
};

type RecorderState = "idle" | "requesting-permission" | "recording" | "ready" | "submitting";
const MAX_RECORDING_SECONDS = 180;

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

function getRecorderBanner(options: {
  state: RecorderState;
  seconds: number;
  statusMsg: string;
  errorMsg: string;
  submittedCurrentRecording: boolean;
}): RecorderBanner {
  const { state, seconds, statusMsg, errorMsg, submittedCurrentRecording } = options;

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
      text: "Submission complete. Your response was received.",
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
      text: `Recording in progress (${seconds}s of ${MAX_RECORDING_SECONDS}s).`,
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

export default function StudentAssignmentPage() {
  const params = useParams<{ assignmentId?: string }>();
  const assignmentId = params?.assignmentId;

  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [studentEmail, setStudentEmail] = useState("");
  const [localAuthBypass, setLocalAuthBypass] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("/");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!assignmentId) {
      setLoading(false);
      setErrorMsg("Missing assignment id.");
      return;
    }

    async function load() {
      setLoading(true);
      setErrorMsg("");
      try {
        const response = await fetch(`/api/student/assignments/${assignmentId}`, { cache: "no-store" });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Assignment not found.");
        }
        const data = (await response.json()) as { item: AssignmentDetail };
        setAssignment(data.item);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Assignment not found.";
        setErrorMsg(message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [assignmentId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCallbackUrl(window.location.href);
      const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      setLocalAuthBypass(process.env.NODE_ENV !== "production" && isLocalHost);
    }
  }, []);

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

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      setMicSupported(false);
      setErrorMsg("This browser does not support audio recording. Please use Safari or Chrome.");
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
    loadPermissionState();
  }, []);

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [recordingUrl]);

  async function startRecording() {
    setStatusMsg("");
    setErrorMsg("");
    if (!micSupported) return;
    setRecorderState("requesting-permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        setRecordingBlob(blob);
        setRecordingUrl(URL.createObjectURL(blob));
        setSubmittedCurrentRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecorderState("ready");
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecordingSeconds(0);
      setRecorderState("recording");
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            stopRecording();
            setStatusMsg("Recording stopped automatically after 3 minutes.");
          }
          return next;
        });
      }, 1000);
      setPermissionState("granted");
    } catch {
      setRecorderState("idle");
      setPermissionState("denied");
      setErrorMsg(
        "Microphone access was blocked. Allow microphone permission in your browser settings, then try again."
      );
    }
  }

  function stopRecording() {
    if (!recorderRef.current) return;
    recorderRef.current.stop();
    recorderRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    setRecorderState("ready");
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
    if (!studentEmail && !localAuthBypass) {
      setErrorMsg("Please sign in with Google before submitting.");
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

    setRecorderState("submitting");
    setErrorMsg("");
    setStatusMsg("");
    try {
      const audioData = await blobToDataUrl(recordingBlob);
      const response = await fetch(`/api/assignments/${assignment.id}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: cleanName,
          audioData,
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Submission failed.");
      }
      setSubmittedCurrentRecording(true);
      setStatusMsg("Submission received. You can record again if your teacher asks for a new take.");
      setRecorderState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Submission failed.";
      setErrorMsg(message);
      setRecorderState("ready");
    } finally {
      // no-op
    }
  }

  const recorderBanner = getRecorderBanner({
    state: recorderState,
    seconds: recordingSeconds,
    statusMsg,
    errorMsg,
    submittedCurrentRecording,
  });

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
          <div className="actions">
            <Link className="btn btn-ghost" href="/">
              Back Home
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-wrap">
      <BrandBar label="Student Submission" />

      <section className="hero student-hero">
        <p className="pill">{assignment.className}</p>
        <h1>{assignment.title}</h1>
        {assignment.description ? <p>{assignment.description}</p> : null}
      </section>

      <section className="grid cols-2 section-gap">
        <article className="card">
          <h2 className="surface-title">Instructions</h2>
          <p className="meta instruction-copy">
            {assignment.instructions || "No instructions provided."}
          </p>
        </article>

        <article className="card panel-subtle">
          <h2 className="surface-title">Record your response</h2>
          <div className="record-module">
            {authLoading ? (
              <p className="notice info">Checking sign-in status...</p>
            ) : studentEmail ? (
              <p className="notice success">
                Signed in as <strong>{studentEmail}</strong>
                {" · "}
                <a href={`/api/auth/signout?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
                  Sign out
                </a>
              </p>
            ) : (
              <p className="notice warning">
                Sign in with Google to submit:
                {" "}
                <a href={`/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
                  Continue with Google
                </a>
              </p>
            )}

            <div className="record-top">
              <p className="meta recorder-note">Steps: Enter name, record, play back, submit.</p>
              <p className={`state-banner ${recorderBanner.tone}`}>
                <span className="state-banner-icon">{recorderBanner.icon}</span>
                <span>{recorderBanner.text}</span>
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
                placeholder="Student name"
                maxLength={120}
              />
              <p className="meta field-meta">{studentName.length}/120</p>
            </div>

            <div className="actions record-controls">
              {recorderState !== "recording" ? (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={startRecording}
                  disabled={
                    (!studentEmail && !localAuthBypass) ||
                    !micSupported ||
                    recorderState === "requesting-permission" ||
                    recorderState === "submitting"
                  }
                >
                  Start recording
                </button>
              ) : (
                <button className="btn btn-danger" type="button" onClick={stopRecording}>
                  Stop recording
                </button>
              )}

              <button
                className="btn btn-ghost"
                type="button"
                onClick={submitResponse}
                disabled={
                  (!studentEmail && !localAuthBypass) ||
                  recorderState === "submitting" ||
                  !recordingBlob ||
                  submittedCurrentRecording
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
              <p className="submission-confirm">
                <CheckCircle2 size={16} aria-hidden="true" /> {statusMsg}
              </p>
            ) : null}
            {!submittedCurrentRecording && statusMsg ? <p className="notice info">{statusMsg}</p> : null}
          </div>
        </article>
      </section>
    </main>
  );
}

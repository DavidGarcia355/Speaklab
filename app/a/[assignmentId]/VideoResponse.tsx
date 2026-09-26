"use client";

import { useEffect, useRef, useState } from "react";
import { VIDEO_MAX_BYTES } from "@/lib/video-policy";

type State = "idle" | "requesting" | "recording" | "finalizing" | "ready" | "submitting" | "done";

export default function VideoResponse(props: {
  assignmentId: string; studentName: string; maxSeconds: number; disabled: boolean;
  required?: boolean; autoGrade?: boolean;
  onBusyChange?: (busy: boolean) => void; onSubmitted: () => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<Blob | null>(null);
  const liveRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  const upload = useRef<{ id: string; uploaded: boolean } | null>(null);
  const request = useRef<AbortController | null>(null);
  const onBusyChange = props.onBusyChange;

  useEffect(() => {
    onBusyChange?.(["requesting", "recording", "finalizing", "submitting"].includes(state));
  }, [state, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    const generationRef = generation;
    return () => {
      mounted.current = false; generationRef.current++; request.current?.abort(); releaseCamera();
    };
  }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  function releaseCamera() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }

  function stop() {
    if (state === "requesting") {
      generation.current++; busy.current = false; setState("idle");
    } else setState("finalizing");
    releaseCamera();
  }

  async function start() {
    if (props.disabled || busy.current || state === "done") return;
    busy.current = true;
    const current = ++generation.current;
    setState("requesting"); setError(""); setVideo(null); setUrl(""); setSeconds(0);
    upload.current = null;
    try {
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot record video. Contact your teacher for an alternative.");
      const mimeType = ["video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This browser cannot record a supported video. Contact your teacher.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true });
      if (!mounted.current || generation.current !== current) {
        stream.getTracks().forEach(track => track.stop()); return;
      }
      streamRef.current = stream;
      if (liveRef.current) liveRef.current.srcObject = stream;
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 450_000, audioBitsPerSecond: 32_000 });
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      let failed = false;
      const fail = (message: string) => {
        failed = true; releaseCamera();
        if (mounted.current && generation.current === current) {
          busy.current = false; setState("idle"); setError(message);
        }
      };
      recorder.ondataavailable = event => {
        bytes += event.data.size;
        if (bytes > VIDEO_MAX_BYTES) { fail("Video exceeded 20 MB. Record a shorter response."); return; }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (failed || !mounted.current || generation.current !== current) return;
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 1000) { fail("No usable video was recorded. Please try again."); return; }
        busy.current = false; setVideo(blob); setUrl(URL.createObjectURL(blob)); setState("ready");
        upload.current = { id: crypto.randomUUID(), uploaded: false };
      };
      recorder.onerror = () => fail("Recording stopped unexpectedly. Please try again.");
      recorder.start(250);
      const startedAt = performance.now();
      setState("recording");
      timerRef.current = setInterval(() => {
        const elapsed = (performance.now() - startedAt) / 1000;
        setSeconds(Math.floor(elapsed));
        if (elapsed >= props.maxSeconds - 0.25) { setState("finalizing"); releaseCamera(); }
      }, 100);
    } catch (cause) {
      if (generation.current !== current) return;
      releaseCamera();
      if (mounted.current) {
        busy.current = false; setState("idle");
        setError(cause instanceof Error ? cause.message : "Camera or microphone could not be opened.");
      }
    }
  }

  async function submit() {
    if (!video || !upload.current || props.disabled || busy.current || state !== "ready") return;
    if (!props.studentName.trim()) { setError("Enter your name before submitting."); return; }
    busy.current = true; setState("submitting"); setError("");
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const pending = upload.current;
    try {
      if (!pending.uploaded) {
        const authorization = await fetch(`/api/assignments/${props.assignmentId}/video-upload`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ contentType: video.type, size: video.size, uploadId: pending.id }),
        });
        const data = await authorization.json() as { error?: string; uploadUrl?: string };
        if (!authorization.ok || !data.uploadUrl) throw new Error(data.error || "Video upload is unavailable. Contact your teacher.");
        // An immutable object may already exist after a lost PUT response.
        // Finalization validates it and can safely be repeated.
        try {
          await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": video.type }, body: video, signal: controller.signal });
        } catch {
          if (controller.signal.aborted) throw new Error("Upload timed out. Retry this same recording.");
        }
        pending.uploaded = true;
      }
      const response = await fetch(`/api/assignments/${props.assignmentId}/submissions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ studentName: props.studentName.trim(), videoReservationId: `vid_${pending.id}` }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        pending.uploaded = false;
        throw new Error(result.error || "Could not submit the video. Retry or contact your teacher.");
      }
      if (mounted.current) { setState("done"); props.onSubmitted(); }
    } catch (cause) {
      if (mounted.current) {
        setError(controller.signal.aborted ? "The request timed out. Retry this same recording safely." : cause instanceof Error ? cause.message : "Could not submit the video.");
        setState("ready");
      }
    } finally { clearTimeout(timeout); busy.current = false; }
  }

  return <section className="card panel-subtle" aria-label="Video response">
    <h3>Video response — {props.required ? "required" : "optional"}</h3>
    <p className="meta">Record with camera and microphone. Preview before submitting. Maximum {props.maxSeconds} seconds and 20 MB. Keep this tab open while recording.</p>
    <p className="meta">{props.autoGrade ? "Automatic speech-based AI draft grading is on. Your teacher reviews the result; AI does not evaluate your appearance." : "Automatic AI grading of video is off for this assignment."}</p>
    {props.required ? <p className="meta">Cannot use video? Contact your teacher for an audio accommodation before submitting.</p> : null}
    {state === "recording" ? <p role="status">Recording video: {seconds} seconds</p> : null}
    <video ref={liveRef} autoPlay muted playsInline hidden={state !== "recording"} aria-label="Live camera preview" style={{ width: "100%", maxWidth: 640 }} />
    {url ? <video src={url} controls playsInline aria-label="Preview your recorded response" style={{ width: "100%", maxWidth: 640 }} /> : null}
    {error ? <p className="notice danger" role="alert">{error}</p> : null}
    {state === "done" ? <p className="notice success" role="status">Video submitted for teacher review.</p> : null}
    <div className="actions">
      {state === "recording" || state === "requesting" ? <button className="btn btn-danger" type="button" onClick={stop}>{state === "requesting" ? "Cancel camera request" : "Stop video"}</button> :
        <button className="btn btn-ghost" type="button" onClick={() => void start()} disabled={props.disabled || state === "finalizing" || state === "submitting" || state === "done"}>{state === "ready" ? "Record again" : "Start video"}</button>}
      {state === "ready" ? <button className="btn btn-primary" type="button" onClick={() => void submit()} disabled={props.disabled}>Submit video</button> : null}
      {["submitting", "requesting", "finalizing"].includes(state) ? <p role="status">{state === "submitting" ? "Uploading and checking video…" : state === "requesting" ? "Waiting for camera permission…" : "Preparing preview…"}</p> : null}
    </div>
  </section>;
}

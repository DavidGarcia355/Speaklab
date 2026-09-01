"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play } from "lucide-react";
import { sanitizeDownloadFilenameBase } from "@/app/components/submission-download-filenames";

type AudioPlayerProps = {
  src: string;
  variant?: "default" | "compact";
  showSpeed?: boolean;
  downloadFilename?: string;
};

const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 3] as const;

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mm = String(Math.floor(safe / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatSpeed(value: number) {
  return Number.isInteger(value) ? `${value}.0x` : `${value}x`;
}

function audioFileExtension(contentType: string) {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const knownExtensions: Record<string, string> = {
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/x-m4a": "m4a",
  };
  return knownExtensions[normalized] ?? "webm";
}

export default function AudioPlayer({
  src,
  variant = "default",
  showSpeed = true,
  downloadFilename,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => setDuration(audio.duration || 0);
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onEnd = () => setIsPlaying(false);
    const onLoadStart = () => {
      setIsPlaying(false);
      setDuration(0);
      setCurrentTime(0);
      setErrorMsg("");
    };
    const onError = () => {
      const mediaError = audio.error;
      console.error("Audio element failed to load", { src, code: mediaError?.code, message: mediaError?.message });
      setErrorMsg(`Couldn't load this recording (media error ${mediaError?.code ?? "unknown"}).`);
      setIsPlaying(false);
    };

    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onError);
    audio.load();
    return () => {
      audio.pause();
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onError);
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
  }, [speed]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    setErrorMsg("");
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      const reason = error instanceof DOMException ? `${error.name}: ${error.message}` : String(error);
      console.error("Audio playback failed", reason, { src, networkState: audio.networkState, errorCode: audio.error?.code });
      setErrorMsg(`Playback failed (${reason}). Try again.`);
      setIsPlaying(false);
    }
  }

  async function handleDownload() {
    if (!downloadFilename || downloading) return;
    setErrorMsg("");
    setDownloading(true);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Download request failed with status ${res.status}.`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error("The downloaded recording was empty.");
      const ext = audioFileExtension(blob.type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeDownloadFilenameBase(downloadFilename)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      console.error("Audio download failed", error);
      setErrorMsg("Couldn't download this recording. Check the internet connection and try again.");
    } finally {
      setDownloading(false);
    }
  }

  function seekTo(next: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(next, duration || 0));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }

  return (
    <div className={`audio-shell ${variant === "compact" ? "audio-shell-compact" : ""}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="audio-controls">
        <button
          type="button"
          className={`audio-toggle ${isPlaying ? "is-playing" : ""}`}
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
        >
          {isPlaying ? <Pause size={16} strokeWidth={2.3} /> : <Play size={16} strokeWidth={2.3} />}
        </button>

        {downloadFilename ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm audio-download-action"
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            <Download size={15} strokeWidth={2.3} aria-hidden="true" />
            {downloading ? "Downloading..." : "Download recording"}
          </button>
        ) : null}
      </div>

      <div className="audio-main">
        <div className="audio-progress-row">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="audio-range"
            aria-label="Audio progress"
          />
          <span className="audio-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="audio-meta">
          {showSpeed ? (
            <div className="audio-speed" role="group" aria-label="Playback speed">
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`audio-speed-btn ${speed === option ? "active" : ""}`}
                  onClick={() => setSpeed(option)}
                  aria-pressed={speed === option}
                >
                  {formatSpeed(option)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {errorMsg ? <p className="status-danger audio-error" role="alert">{errorMsg}</p> : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

type AudioPlayerProps = {
  src: string;
  variant?: "default" | "compact";
  showSpeed?: boolean;
};

const SPEED_OPTIONS = [1, 1.25, 1.5] as const;

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mm = String(Math.floor(safe / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatSpeed(value: number) {
  return Number.isInteger(value) ? `${value}.0x` : `${value}x`;
}

export default function AudioPlayer({
  src,
  variant = "default",
  showSpeed = true,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => setDuration(audio.duration || 0);
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onEnd = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
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
    } catch {
      setErrorMsg("Playback failed. Try again.");
      setIsPlaying(false);
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

      <button
        type="button"
        className={`audio-toggle ${isPlaying ? "is-playing" : ""}`}
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause audio" : "Play audio"}
      >
        {isPlaying ? <Pause size={16} strokeWidth={2.3} /> : <Play size={16} strokeWidth={2.3} />}
      </button>

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
            <div className="audio-speed" aria-label="Playback speed">
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`audio-speed-btn ${speed === option ? "active" : ""}`}
                  onClick={() => setSpeed(option)}
                >
                  {formatSpeed(option)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {errorMsg ? <p className="status-danger audio-error">{errorMsg}</p> : null}
    </div>
  );
}

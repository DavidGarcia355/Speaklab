"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  CircleHelp,
  Hand,
  Lightbulb,
  MessageSquareText,
  Mic,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";
import { openLocalMicrophone, type LocalMicrophone } from "./audio";
import {
  CHARACTER_STATES,
  DEMO_TRANSCRIPT,
  STATE_COPY,
  nextConversationState,
  type CharacterState,
  type SceneInput,
} from "./state";
import styles from "./lab.module.css";

const icons = {
  ready: Hand,
  listening: Mic,
  thinking: Lightbulb,
  success: CheckCheck,
  feedback: MessageSquareText,
  error: CircleHelp,
};

export default function HablaManLab() {
  const [state, setState] = useState<CharacterState>("ready");
  const [graphics, setGraphics] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [useMicrophone, setUseMicrophone] = useState(false);
  const [audioStatus, setAudioStatus] = useState("");
  const [paused, setPaused] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const mic = useRef<LocalMicrophone | null>(null);
  const request = useRef(0);
  const microphoneAbort = useRef<AbortController | null>(null);
  const input = useRef<SceneInput>({
    state: "ready",
    energy: -1,
    pointer: { x: 0, y: 0 },
    reducedMotion: false,
    paused: false,
    replay: 0,
  });
  const copy = STATE_COPY[state];
  const feedback = state === "feedback";
  const stopMicrophone = useCallback(() => {
    request.current++;
    microphoneAbort.current?.abort();
    microphoneAbort.current = null;
    mic.current?.stop();
    mic.current = null;
    input.current.energy = -1;
  }, []);

  useEffect(() => {
    let alive = true;
    let dispose: (() => void) | undefined;
    const controller = new AbortController();
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      input.current.reducedMotion = media.matches;
    };
    update();
    media.addEventListener("change", update);
    void import("./scene")
      .then(async ({ createHablaManScene }) => {
        if (!alive || !host.current) return;
        const scene = await createHablaManScene(
          host.current,
          input.current,
          () => {
            if (alive) setGraphics("fallback");
          },
          controller.signal,
        );
        if (!alive) {
          scene.dispose();
          return;
        }
        dispose = scene.dispose;
        setGraphics("ready");
      })
      .catch(() => {
        if (alive) setGraphics("fallback");
      });
    return () => {
      alive = false;
      controller.abort();
      dispose?.();
      media.removeEventListener("change", update);
      stopMicrophone();
    };
  }, [stopMicrophone]);

  useEffect(() => {
    input.current.state = state;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (state === "thinking")
      timer = setTimeout(() => setState("success"), 2600);
    if (state === "success")
      timer = setTimeout(() => setState("feedback"), 2100);
    if (state !== "listening") {
      stopMicrophone();
    }
    return () => clearTimeout(timer);
  }, [state, stopMicrophone]);

  useEffect(() => {
    if (state !== "listening") return;
    let frame = 0;
    const sample = () => {
      input.current.energy = mic.current ? mic.current.sample() : -1;
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    const limit = setTimeout(() => setState("thinking"), 45000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(limit);
    };
  }, [state]);

  useEffect(() => {
    const hide = () => {
      if (!document.hidden) return;
      stopMicrophone();
      if (input.current.state === "listening") setState("ready");
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [stopMicrophone]);

  async function enter(next: CharacterState) {
    stopMicrophone();
    const token = request.current;
    setState(next);
    setAudioStatus("");
    if (next !== "listening" || !useMicrophone) return;
    const controller = new AbortController();
    microphoneAbort.current = controller;
    setAudioStatus("Waiting for microphone permission...");
    try {
      const microphone = await openLocalMicrophone(controller.signal);
      if (token !== request.current) {
        microphone.stop();
        return;
      }
      mic.current = microphone;
      setAudioStatus("Your microphone is live. Audio stays on this device.");
    } catch {
      if (token === request.current)
        setAudioStatus(
          "Microphone unavailable. The demo voice is taking over.",
        );
    }
  }

  const buttonLabel =
    state === "listening"
      ? "Finish speaking"
      : state === "thinking"
        ? "Finding the words"
        : state === "success"
          ? "See your moment"
          : feedback || state === "error"
            ? "Speak again"
            : "Let's speak";
  return (
    <main
      className={styles.lab}
      data-state={state}
      data-graphics={graphics}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        input.current.pointer = {
          x: Math.max(
            -1,
            Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1),
          ),
          y: Math.max(
            -1,
            Math.min(1, 1 - ((e.clientY - r.top) / r.height) * 2),
          ),
        };
      }}
      onPointerLeave={() => {
        input.current.pointer = { x: 0, y: 0 };
      }}
    >
      <div ref={host} className={styles.scene} aria-hidden="true" />
      {graphics !== "ready" && (
        <div className={styles.fallback}>
          <Image
            src="/mascot/hablaman-home-hero-v1.png"
            alt=""
            width={1254}
            height={1254}
            priority
          />
          <span>
            {graphics === "loading" ? "Opening the studio" : "Illustrated mode"}
          </span>
        </div>
      )}

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Back to TryHabla">
          <Image src="/tryhabla-belt-mark.png" alt="" width={34} height={36} />
          <span>
            TryHabla<span className={styles.labLabel}> / LABS</span>
          </span>
        </Link>
        <span className={styles.edition}>
          CHARACTER STUDY <span>01</span>
        </span>
        <Link href="/" className={styles.back} aria-label="Back to TryHabla">
          <ArrowLeft size={15} /> <span>Back to TryHabla</span>
        </Link>
      </header>

      <section className={styles.intro} aria-labelledby="hablaman-title">
        <p className={styles.eyebrow}>
          <span /> THE SPEAKING STUDIO
        </p>
        <h1 id="hablaman-title">
          HablaMan<span>.</span>
        </h1>
        <div className={styles.stateCopy} key={state}>
          <h2>{copy.headline}</h2>
          <p>{copy.detail}</p>
        </div>
        {!feedback && (
          <div className={styles.signature}>
            <span /> A world of possibility. One voice at a time.
          </div>
        )}
      </section>

      {feedback && (
        <section
          className={styles.transcript}
          aria-labelledby="transcript-title"
        >
          <div className={styles.transcriptHead}>
            <span>
              <MessageSquareText size={16} /> YOUR WORDS
            </span>
            <small>SAMPLE TRANSCRIPT</small>
          </div>
          <p id="transcript-title" lang="es">
            {DEMO_TRANSCRIPT}
          </p>
          <div className={styles.feedbackLine}>
            <span>
              <Check size={15} />
            </span>
            <div>
              <strong>A clear idea, confidently shared.</strong>
              <p>Next time, tell us about your favorite conversation.</p>
            </div>
          </div>
          <div className={styles.transcriptFoot}>
            <span>SPANISH</span>
            <span>
              <Sparkles size={12} /> A little more confident
            </span>
          </div>
        </section>
      )}

      <div className={styles.characterStatus} aria-hidden="true">
        <span className={styles.statusDot} />
        {copy.label}
        <span className={styles.statusRule} />
      </div>

      <section
        className={styles.conversation}
        aria-label="Conversation controls"
      >
        <button
          className={styles.speak}
          disabled={state === "thinking"}
          onClick={() => void enter(nextConversationState(state))}
        >
          {state === "listening" ? (
            <Square size={19} fill="currentColor" />
          ) : state === "thinking" ? (
            <Lightbulb size={20} />
          ) : (
            <Mic size={20} />
          )}
          <span>{buttonLabel}</span>
          <ArrowRight size={18} />
        </button>
        <label className={styles.micOption}>
          <input
            type="checkbox"
            checked={useMicrophone}
            onChange={(e) => {
              setUseMicrophone(e.target.checked);
              stopMicrophone();
              if (state === "listening") setState("ready");
              setAudioStatus("");
            }}
          />
          <span className={styles.switch} aria-hidden="true" /> Use my
          microphone
        </label>
        <p className={styles.privacy}>
          <ShieldCheck size={12} />{" "}
          {useMicrophone
            ? "Local audio only. Never saved or uploaded."
            : "Demo voice. No microphone needed."}
        </p>
        <p className={styles.audioStatus} role="status">
          {state === "listening" ? audioStatus : ""}
        </p>
      </section>

      <footer className={styles.dock}>
        <div className={styles.dockHeading}>
          <span>MEET EVERY SIDE</span>
          <strong>
            Same hero.
            <br />
            Different moments.
          </strong>
        </div>
        <div
          className={styles.states}
          role="group"
          aria-label="Character states"
        >
          {CHARACTER_STATES.map((item) => {
            const Icon = icons[item];
            return (
              <button
                key={item}
                aria-label={STATE_COPY[item].label}
                aria-pressed={state === item}
                onClick={() => void enter(item)}
                title={`${STATE_COPY[item].label} state`}
              >
                <Icon size={21} strokeWidth={1.65} />
                <span>{STATE_COPY[item].label}</span>
              </button>
            );
          })}
        </div>
        <div className={styles.utilities}>
          <button
            title="Replay entrance"
            aria-label="Replay entrance"
            onClick={() => {
              input.current.replay++;
              void enter("ready");
            }}
          >
            <RotateCcw size={17} />
          </button>
          <button
            title={paused ? "Resume motion" : "Pause motion"}
            aria-label={paused ? "Resume motion" : "Pause motion"}
            aria-pressed={paused}
            onClick={() => {
              input.current.paused = !paused;
              setPaused(!paused);
            }}
          >
            {paused ? <Play size={17} /> : <Pause size={17} />}
          </button>
        </div>
      </footer>
      <div className={styles.bottomLine}>
        <span>TRYHABLA EXPERIMENTS</span>
        <span>
          <Volume2 size={12} /> MADE FOR EVERY VOICE
        </span>
      </div>
      <p className={styles.srOnly} role="status" aria-live="polite">
        HablaMan is {copy.label.toLowerCase()}.{" "}
        {feedback
          ? "A sample Spanish transcript and feedback are available."
          : ""}
      </p>
    </main>
  );
}

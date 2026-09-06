export const CHARACTER_STATES = [
  "ready",
  "listening",
  "thinking",
  "success",
  "feedback",
  "error",
] as const;
export type CharacterState = (typeof CHARACTER_STATES)[number];

export type SceneInput = {
  state: CharacterState;
  energy: number;
  pointer: { x: number; y: number };
  reducedMotion: boolean;
  paused: boolean;
  replay: number;
};

export const STATE_COPY: Record<
  CharacterState,
  { label: string; headline: string; detail: string }
> = {
  ready: {
    label: "Ready",
    headline: "Every voice has a little superpower.",
    detail: "Yours included.",
  },
  listening: {
    label: "Listening",
    headline: "You've got my attention.",
    detail: "Take your time. I'm all ears.",
  },
  thinking: {
    label: "Thinking",
    headline: "A little thought. A lot of possibility.",
    detail: "Finding the meaning in your words.",
  },
  success: {
    label: "Success",
    headline: "Now that's a voice worth hearing.",
    detail: "A little braver. A little clearer.",
  },
  feedback: {
    label: "Feedback",
    headline: "Look what your voice can do.",
    detail: "One small moment. Real progress.",
  },
  error: {
    label: "Try again",
    headline: "Even heroes take another take.",
    detail: "No pressure. We've got this.",
  },
};

export const DEMO_TRANSCRIPT =
  "Hola, soy Alex. Me gusta aprender idiomas porque cada conversaci\u00f3n es una nueva aventura.";

export function nextConversationState(state: CharacterState): CharacterState {
  if (state === "listening") return "thinking";
  if (state === "success") return "feedback";
  return "listening";
}

export function simulatedEnergy(time: number) {
  const phrase = Math.max(0, Math.sin(time * 1.8) * 0.55 + 0.25);
  return Math.min(1, phrase * (0.45 + Math.abs(Math.sin(time * 9.3)) * 0.55));
}

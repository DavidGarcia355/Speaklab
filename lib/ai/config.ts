import "server-only";

export type AiProvider = "mock" | "openai" | "ollama";

export type AiConfig = {
  enabled: boolean;
  isDev: boolean;
  transcriptionProvider: "mock" | "openai";
  gradingProvider: AiProvider;
  transcriptionModel: string;
  gradingModel: string;
  ollamaBaseUrl: string;
  maxAudioSeconds: number;
  maxGenerationsPerSubmission: number;
  cooldownSeconds: number;
  dailyTeacherLimit: number;
  failureMode: string;
};

function numberFromEnv(key: string, fallback: number) {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function providerFromEnv<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const raw = process.env[key]?.trim().toLowerCase();
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function getAiConfig(): AiConfig {
  const isDev = process.env.NODE_ENV !== "production";
  const transcriptionProvider = providerFromEnv("AI_TRANSCRIPTION_PROVIDER", "openai", [
    "mock",
    "openai",
  ] as const);
  const gradingProvider = providerFromEnv("AI_GRADING_PROVIDER", "ollama", [
    "mock",
    "openai",
    "ollama",
  ] as const);

  return {
    enabled: process.env.AI_GRADING_ENABLED === "true",
    isDev,
    transcriptionProvider,
    gradingProvider,
    transcriptionModel:
      process.env.AI_TRANSCRIPTION_MODEL?.trim() ||
      (transcriptionProvider === "mock" ? "mock-transcriber" : "whisper-1"),
    gradingModel:
      process.env.AI_GRADING_MODEL?.trim() ||
      process.env.OLLAMA_MODEL?.trim() ||
      (gradingProvider === "mock" ? "mock-grader" : "llama3.2"),
    ollamaBaseUrl:
      process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_URL?.trim() || "http://localhost:11434",
    maxAudioSeconds: numberFromEnv("AI_MAX_AUDIO_SECONDS", 300),
    maxGenerationsPerSubmission: numberFromEnv("AI_MAX_GENERATIONS_PER_SUBMISSION", 10),
    cooldownSeconds: numberFromEnv("AI_GENERATION_COOLDOWN_SECONDS", 3),
    dailyTeacherLimit: numberFromEnv("AI_DAILY_TEACHER_LIMIT", 100),
    failureMode: isDev ? process.env.AI_LOCAL_FAILURE_MODE?.trim().toLowerCase() || "" : "",
  };
}

export function assertAiProviderConfig(config: AiConfig) {
  if (!config.enabled) return;
  if (config.transcriptionProvider === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required when AI_TRANSCRIPTION_PROVIDER=openai.");
  }
  if (config.gradingProvider === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required when AI_GRADING_PROVIDER=openai.");
  }
}

export function isLocalMockAi(config = getAiConfig()) {
  return (
    config.isDev &&
    config.transcriptionProvider === "mock" &&
    config.gradingProvider === "mock"
  );
}

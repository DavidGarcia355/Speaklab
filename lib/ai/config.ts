import "server-only";

export type AiProvider = "mock" | "openai" | "ollama";
export type AiAccessMode = "paid" | "all";

export type AiConfig = {
  enabled: boolean;
  bulkEnabled: boolean;
  isDev: boolean;
  transcriptionProvider: "mock" | "openai";
  gradingProvider: AiProvider;
  transcriptionModel: string;
  gradingModel: string;
  accessMode: AiAccessMode;
  studentDataApproved: boolean;
  teacherDenylist: Set<string>;
  ollamaBaseUrl: string;
  maxAudioSeconds: number;
  maxGenerationsPerSubmission: number;
  cooldownSeconds: number;
  dailyTeacherLimit: number;
  dailyGlobalLimit: number;
  monthlyBudgetUsd: number;
  reservedCostUsdPerGeneration: number;
  providerTimeoutMs: number;
  providerMaxRetries: number;
  gradingMaxOutputTokens: number;
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

export function getAiGatewayAuthToken() {
  if (process.env.AI_GATEWAY_ENABLED?.trim().toLowerCase() === "false") return "";

  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (apiKey) return apiKey;

  // Vercel rotates this token automatically for deployed functions. Requiring
  // VERCEL=1 avoids accidentally using an expired token pulled into local env.
  if (process.env.VERCEL === "1") {
    return process.env.VERCEL_OIDC_TOKEN?.trim() || "";
  }
  return "";
}

function hasHostedAiCredentials() {
  return Boolean(getAiGatewayAuthToken() || process.env.OPENAI_API_KEY?.trim());
}

export function getAiConfig(): AiConfig {
  const isDev = process.env.NODE_ENV !== "production";
  const transcriptionProvider = providerFromEnv("AI_TRANSCRIPTION_PROVIDER", "openai", [
    "mock",
    "openai",
  ] as const);
  const defaultGradingProvider: AiProvider = isDev ? "ollama" : "openai";
  const gradingProvider = providerFromEnv("AI_GRADING_PROVIDER", defaultGradingProvider, [
    "mock",
    "openai",
    "ollama",
  ] as const);

  return {
    enabled: process.env.AI_GRADING_ENABLED === "true",
    bulkEnabled: process.env.AI_BULK_GRADING_ENABLED === "true",
    isDev,
    transcriptionProvider,
    gradingProvider,
    transcriptionModel:
      process.env.AI_TRANSCRIPTION_MODEL?.trim() ||
      (transcriptionProvider === "mock" ? "mock-transcriber" : "whisper-1"),
    gradingModel:
      process.env.AI_GRADING_MODEL?.trim() ||
      (gradingProvider === "mock"
        ? "mock-grader"
        : gradingProvider === "openai"
          ? "gpt-4o-mini"
          : process.env.OLLAMA_MODEL?.trim() || "llama3.2"),
    accessMode: providerFromEnv("AI_ACCESS_MODE", "paid", ["paid", "all"] as const),
    studentDataApproved: process.env.AI_STUDENT_DATA_APPROVED === "true",
    teacherDenylist: new Set(
      (process.env.AI_TEACHER_DENYLIST ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    ),
    ollamaBaseUrl:
      process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_URL?.trim() || "http://localhost:11434",
    maxAudioSeconds: numberFromEnv("AI_MAX_AUDIO_SECONDS", 300),
    maxGenerationsPerSubmission: numberFromEnv("AI_MAX_GENERATIONS_PER_SUBMISSION", 10),
    cooldownSeconds: numberFromEnv("AI_GENERATION_COOLDOWN_SECONDS", 3),
    dailyTeacherLimit: numberFromEnv("AI_DAILY_TEACHER_LIMIT", 20),
    dailyGlobalLimit: numberFromEnv("AI_DAILY_GLOBAL_LIMIT", 500),
    monthlyBudgetUsd: numberFromEnv("AI_MONTHLY_BUDGET_USD", 200),
    reservedCostUsdPerGeneration: numberFromEnv("AI_RESERVED_COST_USD_PER_GENERATION", 0.04),
    providerTimeoutMs: numberFromEnv("AI_PROVIDER_TIMEOUT_MS", 120_000),
    providerMaxRetries: Math.floor(numberFromEnv("AI_PROVIDER_MAX_RETRIES", 2)),
    gradingMaxOutputTokens: Math.floor(numberFromEnv("AI_GRADING_MAX_OUTPUT_TOKENS", 1_200)),
    failureMode: isDev ? process.env.AI_LOCAL_FAILURE_MODE?.trim().toLowerCase() || "" : "",
  };
}

export function assertAiProviderConfig(config: AiConfig) {
  if (!config.enabled) return;
  if (!config.isDev && !config.studentDataApproved) {
    throw new Error(
      "AI_STUDENT_DATA_APPROVED=true is required after student-data, privacy, and OpenAI retention review."
    );
  }
  if (config.transcriptionProvider === "openai" && !hasHostedAiCredentials()) {
    throw new Error(
      "OPENAI_API_KEY or Vercel AI Gateway credentials are required when AI_TRANSCRIPTION_PROVIDER=openai."
    );
  }
  if (config.gradingProvider === "openai" && !hasHostedAiCredentials()) {
    throw new Error(
      "OPENAI_API_KEY or Vercel AI Gateway credentials are required when AI_GRADING_PROVIDER=openai."
    );
  }
  if (config.monthlyBudgetUsd <= 0 || config.reservedCostUsdPerGeneration <= 0) {
    throw new Error("AI monthly budget and per-generation reservation must both be greater than zero.");
  }
  if (
    !config.isDev &&
    config.accessMode === "all" &&
    process.env.ALLOW_TEACHER_SELF_REGISTRATION === "true"
  ) {
    throw new Error(
      "AI_ACCESS_MODE=all cannot be combined with open teacher self-registration in production."
    );
  }
}

export function isAiAccessConfigurationSafe(config = getAiConfig()) {
  return !(
    !config.isDev &&
    config.accessMode === "all" &&
    process.env.ALLOW_TEACHER_SELF_REGISTRATION === "true"
  );
}

export function isLocalMockAi(config = getAiConfig()) {
  return (
    config.isDev &&
    config.transcriptionProvider === "mock" &&
    config.gradingProvider === "mock"
  );
}

export function isAiTeacherDenied(email: string, config = getAiConfig()) {
  return config.teacherDenylist.has(email.trim().toLowerCase());
}

export const GRADING_PROVIDERS = ["mock", "openai", "google", "openrouter", "ollama"] as const;

export type GradingProviderName = (typeof GRADING_PROVIDERS)[number];

export type GradingModelConfig = {
  provider: GradingProviderName;
  model: string;
};

export type GradingConfig = {
  enabled: boolean;
  isDev: boolean;
  defaultModel: GradingModelConfig;
  escalationModel: GradingModelConfig;
  confidenceThreshold: number;
  escalationRateLimit: number;
  unusuallyLongAnswerChars: number;
  scoreDisagreementThreshold: number;
  maxOutputTokens: number;
  formattingRetries: number;
  providerTimeoutMs: number;
  providerMaxRetries: number;
  promptVersion: string;
  cacheTtlDays: number;
  recordRetentionDays: number;
  dailyTeacherRequestLimit: number;
  monthlyTeacherRequestLimit: number;
  monthlyTeacherCostLimitUsd: number;
  monthlyCostTargetUsd: number;
  transcriptionUsdPerMinute: number | null;
  pricingJson: string;
  studentDataApproved: boolean;
  audioStrategy: "auto" | "gemini_direct" | "transcribe_then_grade";
  audioModel: GradingModelConfig;
  audioEscalationModel: GradingModelConfig;
  audioEscalationSeconds: number;
  audioMaxOutputTokens: number;
  experimentalGeminiWebm: boolean;
  deferredBatchEnabled: boolean;
};

function numberFromEnv(key: string, fallback: number, input?: { min?: number; max?: number }) {
  const parsed = Number(process.env[key]?.trim());
  if (!Number.isFinite(parsed)) return fallback;
  const min = input?.min ?? Number.NEGATIVE_INFINITY;
  const max = input?.max ?? Number.POSITIVE_INFINITY;
  return parsed >= min && parsed <= max ? parsed : fallback;
}

function integerFromEnv(key: string, fallback: number, input?: { min?: number; max?: number }) {
  return Math.floor(numberFromEnv(key, fallback, input));
}

function providerFromEnv(key: string, fallback: GradingProviderName): GradingProviderName {
  const raw = process.env[key]?.trim().toLowerCase();
  return GRADING_PROVIDERS.includes(raw as GradingProviderName)
    ? (raw as GradingProviderName)
    : fallback;
}

function audioStrategyFromEnv(): GradingConfig["audioStrategy"] {
  const raw = process.env.GRADING_AUDIO_STRATEGY?.trim().toLowerCase();
  return raw === "gemini_direct" || raw === "transcribe_then_grade" ? raw : "auto";
}

function defaultModelFor(provider: GradingProviderName, escalation: boolean) {
  if (provider === "mock") return escalation ? "mock-escalation" : "mock-cheap";
  if (provider === "google") return "gemini-2.5-flash-lite";
  if (provider === "openrouter") {
    return escalation
      ? process.env.OPENROUTER_ESCALATION_MODEL?.trim() || "openai/gpt-5.4"
      : process.env.OPENROUTER_DEFAULT_MODEL?.trim() || "openai/gpt-5.4-mini";
  }
  if (provider === "ollama") return process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  return escalation ? "gpt-5.4" : "gpt-5.4-mini";
}

function launchReliableModel(
  provider: GradingProviderName,
  configuredModel: string,
  escalation: boolean,
  isDev: boolean
) {
  if (isDev) return configuredModel;
  const normalized = configuredModel.trim().toLowerCase().replace(/^openai\//, "");
  const staleLaunchModels = new Set(["gpt-4o-mini", "gpt-5-nano", "gpt-5-mini"]);
  if ((provider === "openai" || provider === "openrouter") && staleLaunchModels.has(normalized)) {
    const replacement = escalation ? "gpt-5.4" : "gpt-5.4-mini";
    return provider === "openrouter" ? `openai/${replacement}` : replacement;
  }
  return configuredModel;
}

/**
 * Reads the new provider-neutral grading settings while retaining the existing
 * AI_* variables as fallbacks so a deployment can migrate without downtime.
 */
export function getGradingConfig(): GradingConfig {
  const isDev = process.env.NODE_ENV !== "production";
  const legacyProvider = providerFromEnv(
    "AI_GRADING_PROVIDER",
    isDev ? "mock" : "openai"
  );
  const defaultProvider = providerFromEnv("GRADING_DEFAULT_PROVIDER", legacyProvider);
  const escalationProvider = providerFromEnv(
    "GRADING_ESCALATION_PROVIDER",
    defaultProvider === "mock" || defaultProvider === "ollama" ? defaultProvider : "openai"
  );
  const configuredDefaultModel =
    process.env.GRADING_DEFAULT_MODEL?.trim() ||
    process.env.AI_GRADING_MODEL?.trim() ||
    defaultModelFor(defaultProvider, false);
  const configuredEscalationModel =
    process.env.GRADING_ESCALATION_MODEL?.trim() ||
    defaultModelFor(escalationProvider, true);

  return {
    enabled: process.env.AI_GRADING_ENABLED === "true",
    isDev,
    defaultModel: {
      provider: defaultProvider,
      model: launchReliableModel(defaultProvider, configuredDefaultModel, false, isDev),
    },
    escalationModel: {
      provider: escalationProvider,
      model: launchReliableModel(escalationProvider, configuredEscalationModel, true, isDev),
    },
    confidenceThreshold: numberFromEnv("GRADING_CONFIDENCE_THRESHOLD", 0.85, {
      min: 0,
      max: 1,
    }),
    escalationRateLimit: numberFromEnv("GRADING_ESCALATION_RATE_LIMIT", 0.1, {
      min: 0,
      max: 1,
    }),
    unusuallyLongAnswerChars: integerFromEnv("GRADING_LONG_ANSWER_CHARS", 6_000, {
      min: 100,
      max: 1_000_000,
    }),
    scoreDisagreementThreshold: numberFromEnv("GRADING_SCORE_DISAGREEMENT_POINTS", 1, {
      min: 0,
    }),
    maxOutputTokens: integerFromEnv(
      "GRADING_MAX_OUTPUT_TOKENS",
      integerFromEnv("AI_GRADING_MAX_OUTPUT_TOKENS", 2_400, { min: 1_600, max: 8_000 }),
      { min: 1_600, max: 8_000 }
    ),
    formattingRetries: integerFromEnv("GRADING_FORMAT_RETRIES", 1, { min: 0, max: 1 }),
    providerTimeoutMs: integerFromEnv(
      "GRADING_PROVIDER_TIMEOUT_MS",
      integerFromEnv("AI_PROVIDER_TIMEOUT_MS", 120_000, { min: 1_000 }),
      { min: 1_000 }
    ),
    providerMaxRetries: integerFromEnv("GRADING_PROVIDER_MAX_RETRIES", 0, {
      min: 0,
      max: 2,
    }),
    promptVersion: process.env.GRADING_PROMPT_VERSION?.trim() || "grading-v1",
    cacheTtlDays: integerFromEnv("GRADING_CACHE_TTL_DAYS", 30, { min: 1, max: 365 }),
    recordRetentionDays: integerFromEnv("GRADING_RECORD_RETENTION_DAYS", 90, {
      min: 1,
      max: 3_650,
    }),
    dailyTeacherRequestLimit: integerFromEnv(
      "GRADING_DAILY_TEACHER_LIMIT",
      integerFromEnv("AI_DAILY_TEACHER_LIMIT", 200, { min: 1 }),
      { min: 1 }
    ),
    monthlyTeacherRequestLimit: integerFromEnv("GRADING_MONTHLY_TEACHER_LIMIT", 3_000, {
      min: 1,
    }),
    monthlyTeacherCostLimitUsd: numberFromEnv("GRADING_MONTHLY_TEACHER_COST_LIMIT", 3, {
      min: 0.01,
    }),
    monthlyCostTargetUsd: numberFromEnv("GRADING_MONTHLY_COST_TARGET", 1, { min: 0 }),
    transcriptionUsdPerMinute: process.env.GRADING_TRANSCRIPTION_USD_PER_MINUTE?.trim()
      ? numberFromEnv("GRADING_TRANSCRIPTION_USD_PER_MINUTE", 0, { min: 0 })
      : null,
    pricingJson: process.env.GRADING_PROVIDER_PRICES_JSON?.trim() || "",
    studentDataApproved:
      process.env.GRADING_STUDENT_DATA_APPROVED === "true" ||
      process.env.AI_STUDENT_DATA_APPROVED === "true",
    audioStrategy: audioStrategyFromEnv(),
    audioModel: {
      provider: "google",
      model: process.env.GRADING_AUDIO_MODEL?.trim() || "gemini-2.5-flash-lite",
    },
    audioEscalationModel: {
      provider: "google",
      model: process.env.GRADING_AUDIO_ESCALATION_MODEL?.trim() || "gemini-2.5-flash",
    },
    audioEscalationSeconds: integerFromEnv("GRADING_AUDIO_ESCALATION_SECONDS", 300, {
      min: 10,
      max: 34_200,
    }),
    audioMaxOutputTokens: integerFromEnv("GRADING_AUDIO_MAX_OUTPUT_TOKENS", 2_000, {
      min: 256,
      max: 16_000,
    }),
    experimentalGeminiWebm: process.env.GRADING_GEMINI_EXPERIMENTAL_WEBM === "true",
    deferredBatchEnabled: process.env.GRADING_DEFERRED_BATCH_ENABLED === "true",
  };
}

export function requiredCredentialForProvider(provider: GradingProviderName) {
  if (provider === "openai") {
    const gatewaySetting = process.env.AI_GATEWAY_ENABLED?.trim().toLowerCase();
    const usesGateway =
      gatewaySetting === "true" ||
      (gatewaySetting !== "false" &&
        Boolean(process.env.VERCEL === "1" || process.env.AI_GATEWAY_API_KEY?.trim()));
    if (usesGateway) {
      return process.env.AI_GATEWAY_API_KEY?.trim() ||
        process.env.VERCEL === "1" ||
        process.env.VERCEL_OIDC_TOKEN?.trim()
        ? null
        : "AI_GATEWAY_API_KEY";
    }
    return "OPENAI_API_KEY";
  }
  if (provider === "google") return "GOOGLE_API_KEY";
  if (provider === "openrouter") return "OPENROUTER_API_KEY";
  return null;
}

export function assertGradingProviderConfiguration(config = getGradingConfig()) {
  if (!config.isDev && !config.studentDataApproved) {
    throw new Error(
      "GRADING_STUDENT_DATA_APPROVED=true is required after privacy, retention, and provider data-use review."
    );
  }
  for (const modelConfig of [config.defaultModel, config.escalationModel]) {
    const key = requiredCredentialForProvider(modelConfig.provider);
    if (key && !process.env[key]?.trim()) {
      throw new Error(`${key} is required for grading provider ${modelConfig.provider}.`);
    }
    if (!modelConfig.model.trim()) {
      throw new Error(`A model is required for grading provider ${modelConfig.provider}.`);
    }
  }
  if (config.audioStrategy === "gemini_direct" && !process.env.GOOGLE_API_KEY?.trim()) {
    throw new Error("GOOGLE_API_KEY is required for direct Gemini audio grading.");
  }
}

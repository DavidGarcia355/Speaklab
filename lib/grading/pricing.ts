import type { ProviderModelConfig, TokenUsage } from "@/lib/grading/contracts";

export type ModelTokenPricing = {
  inputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens?: number;
  audioInputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens: number;
};

export type ModelPricingTable = Record<string, ModelTokenPricing>;

/**
 * Standard text-token rates verified against provider pricing pages on
 * 2026-08-20. Environment JSON can override any entry without a code change.
 */
export const BUILT_IN_MODEL_PRICING: Readonly<ModelPricingTable> = Object.freeze({
  "mock/mock": {
    inputUsdPerMillionTokens: 0,
    cachedInputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
  },
  "mock/mock-cheap": {
    inputUsdPerMillionTokens: 0,
    cachedInputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
  },
  "mock/mock-escalation": {
    inputUsdPerMillionTokens: 0,
    cachedInputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
  },
  "openai/gpt-5-nano": {
    inputUsdPerMillionTokens: 0.05,
    cachedInputUsdPerMillionTokens: 0.005,
    outputUsdPerMillionTokens: 0.4,
  },
  "openai/gpt-5-mini": {
    inputUsdPerMillionTokens: 0.25,
    cachedInputUsdPerMillionTokens: 0.025,
    outputUsdPerMillionTokens: 2,
  },
  "google/gemini-2.5-flash-lite": {
    inputUsdPerMillionTokens: 0.1,
    cachedInputUsdPerMillionTokens: 0.01,
    audioInputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 0.4,
  },
  "google/gemini-2.5-flash": {
    inputUsdPerMillionTokens: 0.3,
    cachedInputUsdPerMillionTokens: 0.03,
    audioInputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 2.5,
  },
});

export const DEFAULT_MODEL_PRICING = BUILT_IN_MODEL_PRICING;

export type EstimatedTokenCost = {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  inputMicrousd: number;
  cachedInputMicrousd: number;
  outputMicrousd: number;
  totalMicrousd: number;
  totalUsd: number;
};

/** Provider/model keys are formatted as `provider/model`. */
export function pricingKey(model: Pick<ProviderModelConfig, "provider" | "model">) {
  return `${model.provider.trim().toLowerCase()}/${model.model.trim().toLowerCase()}`;
}

export function resolveModelPricing(
  table: ModelPricingTable,
  model: Pick<ProviderModelConfig, "provider" | "model">
) {
  return table[pricingKey(model)] ?? null;
}

/**
 * Estimates token cost using integer micro-USD. Each component rounds up to
 * avoid understating spend when a low price produces a fractional micro-dollar.
 */
export function estimateTokenCostMicrousd(
  usage: TokenUsage,
  pricing: ModelTokenPricing
): EstimatedTokenCost {
  assertTokenUsage(usage);
  assertPricing(pricing);

  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  const cachedRate = pricing.cachedInputUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens;
  // USD / 1M tokens numerically equals micro-USD / token.
  const inputMicrousd = Math.ceil(uncachedInputTokens * pricing.inputUsdPerMillionTokens);
  const cachedInputMicrousd = Math.ceil(usage.cachedInputTokens * cachedRate);
  const outputMicrousd = Math.ceil(usage.outputTokens * pricing.outputUsdPerMillionTokens);
  const totalMicrousd = inputMicrousd + cachedInputMicrousd + outputMicrousd;

  return {
    uncachedInputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    inputMicrousd,
    cachedInputMicrousd,
    outputMicrousd,
    totalMicrousd,
    totalUsd: microusdToUsd(totalMicrousd),
  };
}

/** Prices audio and text prompt tokens separately for multimodal Gemini calls. */
export function estimateAudioTokenCostMicrousd(
  usage: TokenUsage,
  audioInputTokens: number,
  pricing: ModelTokenPricing
): EstimatedTokenCost {
  assertTokenUsage(usage);
  assertPricing(pricing);
  if (!Number.isSafeInteger(audioInputTokens) || audioInputTokens < 0 || audioInputTokens > usage.inputTokens) {
    throw new TypeError("Audio input tokens must be a non-negative subset of total input tokens.");
  }
  const cachedInputTokens = usage.cachedInputTokens;
  const uncachedInputTokens = usage.inputTokens - cachedInputTokens;
  const uncachedAudioTokens = Math.min(audioInputTokens, uncachedInputTokens);
  const uncachedTextTokens = uncachedInputTokens - uncachedAudioTokens;
  const audioRate = pricing.audioInputUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens;
  const cachedRate = pricing.cachedInputUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens;
  const inputMicrousd =
    Math.ceil(uncachedTextTokens * pricing.inputUsdPerMillionTokens) +
    Math.ceil(uncachedAudioTokens * audioRate);
  const cachedInputMicrousd = Math.ceil(cachedInputTokens * cachedRate);
  const outputMicrousd = Math.ceil(usage.outputTokens * pricing.outputUsdPerMillionTokens);
  const totalMicrousd = inputMicrousd + cachedInputMicrousd + outputMicrousd;
  return {
    uncachedInputTokens,
    cachedInputTokens,
    outputTokens: usage.outputTokens,
    inputMicrousd,
    cachedInputMicrousd,
    outputMicrousd,
    totalMicrousd,
    totalUsd: microusdToUsd(totalMicrousd),
  };
}

export const calculateEstimatedCost = estimateTokenCostMicrousd;

export function microusdToUsd(microusd: number) {
  if (!Number.isSafeInteger(microusd) || microusd < 0) {
    throw new TypeError("Micro-USD must be a non-negative safe integer.");
  }
  return microusd / 1_000_000;
}

export function usdToMicrousd(usd: number) {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new TypeError("USD must be a non-negative finite number.");
  }
  const result = Math.ceil(usd * 1_000_000);
  if (!Number.isSafeInteger(result)) throw new TypeError("USD amount is too large.");
  return result;
}

export function estimateTranscriptionCostMicrousd(input: {
  provider: string;
  model: string;
  durationSeconds: number;
  configuredUsdPerMinute?: number;
}) {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) {
    throw new TypeError("Transcription duration must be a non-negative finite number.");
  }
  const configured = input.configuredUsdPerMinute;
  if (typeof configured === "number" && (!Number.isFinite(configured) || configured < 0)) {
    throw new TypeError("Configured transcription price must be non-negative.");
  }
  const identity = `${input.provider}/${input.model}`.toLowerCase();
  const knownRate =
    identity === "mock/mock-transcriber"
      ? 0
      : identity === "openai/gpt-4o-mini-transcribe"
        ? 0.003
        : identity === "openai/whisper-1" || identity === "openai/gpt-4o-transcribe"
          ? 0.006
          : null;
  const usdPerMinute = configured ?? knownRate;
  if (usdPerMinute === null) return { totalMicrousd: 0, totalUsd: 0, costKnown: false };
  const totalMicrousd = usdToMicrousd((input.durationSeconds / 60) * usdPerMinute);
  return { totalMicrousd, totalUsd: microusdToUsd(totalMicrousd), costKnown: true };
}

/** Parses an environment-provided JSON price table without accepting invalid rates. */
export function parseModelPricingTable(raw: string): ModelPricingTable {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new TypeError("Model pricing JSON must be an object.");

  const table: ModelPricingTable = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.includes("/") || !isRecord(value)) {
      throw new TypeError(`Invalid model pricing entry: ${key}.`);
    }
    const pricing: ModelTokenPricing = {
      inputUsdPerMillionTokens: readRate(value, "inputUsdPerMillionTokens", key),
      outputUsdPerMillionTokens: readRate(value, "outputUsdPerMillionTokens", key),
      ...(typeof value.cachedInputUsdPerMillionTokens === "undefined"
        ? {}
        : {
            cachedInputUsdPerMillionTokens: readRate(
              value,
              "cachedInputUsdPerMillionTokens",
              key
            ),
          }),
      ...(typeof value.audioInputUsdPerMillionTokens === "undefined"
        ? {}
        : {
            audioInputUsdPerMillionTokens: readRate(
              value,
              "audioInputUsdPerMillionTokens",
              key
            ),
          }),
    };
    table[key.trim().toLowerCase()] = pricing;
  }
  return table;
}

/** Built-ins plus environment overrides, with overrides taking precedence. */
export function modelPricingTableFromConfig(raw: string): ModelPricingTable {
  return { ...BUILT_IN_MODEL_PRICING, ...parseModelPricingTable(raw) };
}

function assertTokenUsage(usage: TokenUsage) {
  for (const [name, value] of Object.entries(usage)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer.`);
    }
  }
  if (usage.cachedInputTokens > usage.inputTokens) {
    throw new TypeError("Cached input tokens cannot exceed total input tokens.");
  }
}

function assertPricing(pricing: ModelTokenPricing) {
  for (const [name, value] of Object.entries(pricing)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative finite number.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRate(record: Record<string, unknown>, key: string, modelKey: string) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${modelKey}.${key} must be a non-negative finite number.`);
  }
  return value;
}

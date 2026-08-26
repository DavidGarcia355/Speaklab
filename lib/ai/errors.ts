import "server-only";

export type PublicAiError = {
  code: string;
  message: string;
};

export type SafeAiProviderMetadata = {
  name?: string;
  status?: number;
  code?: string;
  requestId?: string;
  generationId?: string;
};

type ProviderLogContext = {
  operation: "transcription" | "grading";
  route: "gateway" | "direct";
  model: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function safeIdentifier(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return /^[a-z0-9][a-z0-9._:/=-]*$/i.test(trimmed) ? trimmed : undefined;
}

function numericStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function readHeader(headers: unknown, name: string) {
  if (headers instanceof Headers) return safeIdentifier(headers.get(name));
  const record = asRecord(headers);
  if (!record) return undefined;
  const match = Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return safeIdentifier(match?.[1]);
}

export function getSafeAiProviderMetadata(error: unknown): SafeAiProviderMetadata {
  const root = asRecord(error);
  if (!root) return {};

  const queue: Record<string, unknown>[] = [root];
  const seen = new Set<Record<string, unknown>>();
  const records: Record<string, unknown>[] = [];

  while (queue.length > 0 && records.length < 8) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    records.push(current);

    for (const key of ["cause", "providerMetadata", "gateway", "response", "finalStep"]) {
      const nested = asRecord(current[key]);
      if (nested) queue.push(nested);
    }
    if (Array.isArray(current.errors)) {
      for (const item of current.errors.slice(0, 3)) {
        const nested = asRecord(item);
        if (nested) queue.push(nested);
      }
    }
  }

  let status: number | undefined;
  let code: string | undefined;
  let requestId: string | undefined;
  let generationId: string | undefined;
  let name: string | undefined;

  for (const record of records) {
    name ??= safeIdentifier(record.name, 100);
    status ??= numericStatus(record.status) ?? numericStatus(record.statusCode);
    code ??= safeIdentifier(record.code, 100) ?? safeIdentifier(asRecord(record.error)?.code, 100);
    requestId ??=
      safeIdentifier(record.requestID) ??
      safeIdentifier(record.requestId) ??
      safeIdentifier(record.request_id) ??
      readHeader(record.headers, "x-request-id") ??
      readHeader(record.responseHeaders, "x-request-id");
    generationId ??= safeIdentifier(record.generationId);
  }

  return {
    ...(name ? { name } : {}),
    ...(status ? { status } : {}),
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {}),
    ...(generationId ? { generationId } : {}),
  };
}

function safeLogContext(context: ProviderLogContext) {
  return {
    operation: context.operation,
    provider: "openai",
    route: context.route,
    model: safeIdentifier(context.model, 100) ?? "unknown",
  };
}

export function logAiProviderSuccess(context: ProviderLogContext, metadata: unknown) {
  const safe = getSafeAiProviderMetadata(metadata);
  if (!safe.requestId && !safe.generationId) return;
  console.info("AI provider request completed", {
    ...safeLogContext(context),
    ...(safe.requestId ? { requestId: safe.requestId } : {}),
    ...(safe.generationId ? { generationId: safe.generationId } : {}),
  });
}

export function logAiProviderFailure(context: ProviderLogContext, error: unknown) {
  const safe = getSafeAiProviderMetadata(error);
  console.error("AI provider request failed", {
    ...safeLogContext(context),
    ...(safe.name ? { errorName: safe.name } : {}),
    ...(safe.status ? { status: safe.status } : {}),
    ...(safe.code ? { code: safe.code } : {}),
    ...(safe.requestId ? { requestId: safe.requestId } : {}),
    ...(safe.generationId ? { generationId: safe.generationId } : {}),
  });
}

export function toPublicAiError(error: unknown): PublicAiError {
  const metadata = getSafeAiProviderMetadata(error);
  const name = metadata.name ?? "";
  const status = metadata.status;
  const providerCode = metadata.code ?? "";

  if (
    name === "AiProviderBudgetExhaustedError" ||
    name === "TranscriptProviderBudgetExhaustedError"
  ) {
    return {
      code: "provider_budget_exhausted",
      message: "The monthly AI usage limit has been reached. Try again next month.",
    };
  }

  if (name === "GradingUsageLimitError") {
    const message =
      providerCode === "daily_request_limit"
        ? "The daily AI processing limit has been reached. Try again tomorrow."
        : "The monthly AI processing limit has been reached. Try again next month.";
    return { code: "usage_limit_reached", message };
  }

  if (name === "AI_NoTranscriptGeneratedError") {
    return {
      code: "no_speech_detected",
      message: "No clear speech was detected. Record a longer response and try again.",
    };
  }

  if (name.includes("Timeout") || name === "AbortError" || status === 408) {
    return { code: "provider_timeout", message: "AI grading timed out. Please try again." };
  }
  if (status === 429 && ["insufficient_quota", "billing_hard_limit_reached"].includes(providerCode)) {
    return {
      code: "provider_spend_limit",
      message: "AI grading has reached its provider spending limit. Please contact the administrator.",
    };
  }
  if (status === 429) {
    return { code: "provider_rate_limit", message: "AI grading is busy right now. Please try again shortly." };
  }
  if (status === 401 || status === 403) {
    return {
      code: "provider_configuration",
      message: "AI grading is temporarily unavailable because its provider configuration needs attention.",
    };
  }
  if (typeof status === "number" && status >= 500) {
    return { code: "provider_unavailable", message: "The AI provider is temporarily unavailable. Please try again." };
  }
  if (error instanceof Error && error.message.includes("did not match the assignment rubric")) {
    return { code: "invalid_provider_output", message: error.message };
  }
  if (error instanceof Error && error.message.includes("declined to grade")) {
    return { code: "provider_refusal", message: "AI could not grade this recording. Please review it manually." };
  }

  return { code: "provider_error", message: "AI grading failed. Please try again or grade manually." };
}

export function toPublicTranscriptionError(error: unknown): PublicAiError {
  const metadata = getSafeAiProviderMetadata(error);
  if (metadata.status === 404) {
    return { code: "no_audio", message: "Audio not found." };
  }
  if (metadata.status === 413) {
    return {
      code: "audio_too_large",
      message: "Audio file is too large to transcribe (max 25 MB).",
    };
  }
  if (metadata.status === 410) {
    return {
      code: "audio_storage_migration_required",
      message: "This recording needs a storage update before it can be transcribed.",
    };
  }
  const mapped = toPublicAiError(error);
  const messages: Record<string, string> = {
    no_speech_detected: "No clear speech was detected. Record a longer response and try again.",
    provider_timeout: "Transcription timed out. Please try again.",
    provider_spend_limit:
      "Transcription has reached its provider spending limit. Please contact the administrator.",
    provider_rate_limit: "Transcription is busy right now. Please try again shortly.",
    provider_configuration:
      "Transcription is temporarily unavailable because its provider configuration needs attention.",
    provider_unavailable: "The transcription provider is temporarily unavailable. Please try again.",
    usage_limit_reached: mapped.message.replace("AI processing", "transcription"),
    provider_error: "Transcription failed. Please try again or review the recording manually.",
  };
  return { code: mapped.code, message: messages[mapped.code] ?? messages.provider_error };
}

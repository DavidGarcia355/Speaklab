import "server-only";

export type PublicAiError = {
  code: string;
  message: string;
};

export function toPublicAiError(error: unknown): PublicAiError {
  const candidate = error as {
    name?: string;
    status?: number;
    code?: string;
    error?: { code?: string };
  };
  const name = candidate?.name ?? "";
  const status = candidate?.status;
  const providerCode = candidate?.code ?? candidate?.error?.code ?? "";

  if (name.includes("Timeout") || name === "AbortError") {
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

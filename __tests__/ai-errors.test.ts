import { describe, expect, it, vi } from "vitest";
import {
  getSafeAiProviderMetadata,
  logAiProviderFailure,
  toPublicAiError,
} from "@/lib/ai/errors";

describe("AI provider error messages", () => {
  it("maps timeouts, rate limits, and refusals to actionable safe messages", () => {
    expect(toPublicAiError({ name: "APIConnectionTimeoutError" })).toMatchObject({
      code: "provider_timeout",
    });
    expect(toPublicAiError({ status: 429 })).toMatchObject({
      code: "provider_rate_limit",
    });
    expect(toPublicAiError(new Error("The AI provider declined to grade this submission."))).toMatchObject({
      code: "provider_refusal",
    });
  });

  it("explains when a recording contains no transcribable speech", () => {
    expect(toPublicAiError({ name: "AI_NoTranscriptGeneratedError" })).toEqual({
      code: "no_speech_detected",
      message: "No clear speech was detected. Record a longer response and try again.",
    });
  });

  it("never returns an unknown raw provider message", () => {
    const secretDetail = "upstream body with internal-token-123";
    const result = toPublicAiError(new Error(secretDetail));

    expect(result.code).toBe("provider_error");
    expect(result.message).not.toContain(secretDetail);
    expect(result.message).not.toContain("internal-token-123");
  });

  it("maps Gateway statusCode values without exposing provider bodies", () => {
    expect(toPublicAiError({ statusCode: 401 })).toMatchObject({
      code: "provider_configuration",
    });
    expect(toPublicAiError({ statusCode: 429 })).toMatchObject({
      code: "provider_rate_limit",
    });
    expect(toPublicAiError({ statusCode: 503 })).toMatchObject({
      code: "provider_unavailable",
    });
  });

  it("extracts and logs only bounded diagnostic identifiers", () => {
    const error = {
      name: "GatewayAuthenticationError",
      statusCode: 401,
      generationId: "gen_safe-123",
      message: "secret provider body token-live-123",
      cause: {
        responseHeaders: { "x-request-id": "req_safe-456" },
        responseBody: "private transcript and token-live-123",
      },
    };

    expect(getSafeAiProviderMetadata(error)).toMatchObject({
      name: "GatewayAuthenticationError",
      status: 401,
      requestId: "req_safe-456",
      generationId: "gen_safe-123",
    });

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logAiProviderFailure(
      { operation: "grading", route: "gateway", model: "openai/gpt-4o-mini" },
      error
    );

    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).toContain("req_safe-456");
    expect(serialized).toContain("gen_safe-123");
    expect(serialized).not.toContain("token-live-123");
    expect(serialized).not.toContain("private transcript");
    expect(serialized).not.toContain("secret provider body");
    log.mockRestore();
  });
});

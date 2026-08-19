import { describe, expect, it } from "vitest";
import { toPublicAiError } from "@/lib/ai/errors";

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

  it("never returns an unknown raw provider message", () => {
    const secretDetail = "upstream body with internal-token-123";
    const result = toPublicAiError(new Error(secretDetail));

    expect(result.code).toBe("provider_error");
    expect(result.message).not.toContain(secretDetail);
    expect(result.message).not.toContain("internal-token-123");
  });
});

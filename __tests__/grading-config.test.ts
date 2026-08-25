import { afterEach, describe, expect, it, vi } from "vitest";
import { getGradingConfig } from "@/lib/grading/config";

const KEYS = [
  "GRADING_MAX_OUTPUT_TOKENS",
  "AI_GRADING_MAX_OUTPUT_TOKENS",
  "GRADING_DEFAULT_PROVIDER",
  "GRADING_DEFAULT_MODEL",
  "GRADING_ESCALATION_PROVIDER",
  "GRADING_ESCALATION_MODEL",
  "AI_GRADING_PROVIDER",
  "AI_GRADING_MODEL",
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (typeof value === "undefined") delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
});

describe("grading launch configuration", () => {
  it("allows enough output for the required structured grading result by default", () => {
    delete process.env.GRADING_MAX_OUTPUT_TOKENS;
    delete process.env.AI_GRADING_MAX_OUTPUT_TOKENS;

    expect(getGradingConfig().maxOutputTokens).toBe(2_400);
  });

  it("keeps the provider-neutral override ahead of the legacy setting", () => {
    process.env.AI_GRADING_MAX_OUTPUT_TOKENS = "1800";
    process.env.GRADING_MAX_OUTPUT_TOKENS = "3200";

    expect(getGradingConfig().maxOutputTokens).toBe(3_200);
  });

  it("rejects stale launch overrides that are too small for the grading schema", () => {
    process.env.AI_GRADING_MAX_OUTPUT_TOKENS = "300";
    delete process.env.GRADING_MAX_OUTPUT_TOKENS;

    expect(getGradingConfig().maxOutputTokens).toBe(2_400);
  });

  it("honors explicit production models without silently changing cost or behavior", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.GRADING_DEFAULT_PROVIDER = "openai";
    process.env.GRADING_DEFAULT_MODEL = "gpt-5-nano";
    process.env.GRADING_ESCALATION_PROVIDER = "openai";
    process.env.GRADING_ESCALATION_MODEL = "gpt-5-mini";

    const config = getGradingConfig();

    expect(config.defaultModel).toEqual({ provider: "openai", model: "gpt-5-nano" });
    expect(config.escalationModel).toEqual({ provider: "openai", model: "gpt-5-mini" });
  });
});

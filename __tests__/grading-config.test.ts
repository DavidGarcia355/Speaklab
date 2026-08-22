import { afterEach, describe, expect, it } from "vitest";
import { getGradingConfig } from "@/lib/grading/config";

const KEYS = ["GRADING_MAX_OUTPUT_TOKENS", "AI_GRADING_MAX_OUTPUT_TOKENS"] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (typeof value === "undefined") delete process.env[key];
    else process.env[key] = value;
  }
});

describe("grading launch configuration", () => {
  it("allows enough output for the required structured grading result by default", () => {
    delete process.env.GRADING_MAX_OUTPUT_TOKENS;
    delete process.env.AI_GRADING_MAX_OUTPUT_TOKENS;

    expect(getGradingConfig().maxOutputTokens).toBe(1_200);
  });

  it("keeps the provider-neutral override ahead of the legacy setting", () => {
    process.env.AI_GRADING_MAX_OUTPUT_TOKENS = "900";
    process.env.GRADING_MAX_OUTPUT_TOKENS = "1400";

    expect(getGradingConfig().maxOutputTokens).toBe(1_400);
  });
});

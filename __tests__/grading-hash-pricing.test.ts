import { describe, expect, it } from "vitest";
import { createGradingCacheHash } from "@/lib/grading/hash";
import {
  BUILT_IN_MODEL_PRICING,
  estimateTokenCostMicrousd,
  modelPricingTableFromConfig,
  parseModelPricingTable,
  resolveModelPricing,
} from "@/lib/grading/pricing";

function hash(overrides: Partial<Parameters<typeof createGradingCacheHash>[0]> = {}) {
  return createGradingCacheHash({
    studentAnswer: "Plants use sunlight.",
    assignmentVersion: "assignment-v1",
    rubricVersion: "rubric-v1",
    promptVersion: "prompt-v1",
    modelConfig: {
      default: {
        provider: "openai",
        model: "gpt-5-nano",
        parameters: { temperature: 0, structured: true },
      },
      escalation: { provider: "openai", model: "gpt-5-mini" },
    },
    ...overrides,
  });
}

describe("grading cache identity", () => {
  it("uses normalized content and stable configuration ordering", () => {
    const reordered = hash({
      studentAnswer: " <p>Plants   use sunlight.</p> ",
      modelConfig: {
        default: {
          model: "gpt-5-nano",
          provider: "openai",
          parameters: { structured: true, temperature: 0 },
        },
        escalation: { model: "gpt-5-mini", provider: "openai" },
      },
    });
    expect(reordered).toBe(hash());
    expect(reordered).toMatch(/^[a-f0-9]{64}$/);
  });

  it("invalidates when content, versions, prompt, or model configuration changes", () => {
    const baseline = hash();
    expect(hash({ studentAnswer: "Plants use moonlight." })).not.toBe(baseline);
    expect(hash({ assignmentVersion: "assignment-v2" })).not.toBe(baseline);
    expect(hash({ rubricVersion: "rubric-v2" })).not.toBe(baseline);
    expect(hash({ promptVersion: "prompt-v2" })).not.toBe(baseline);
    expect(
      hash({ modelConfig: { default: { provider: "google", model: "gemini-2.5-flash-lite" } } })
    ).not.toBe(baseline);
  });
});

describe("grading token pricing", () => {
  it("includes current standard text rates for required cheap and escalation models", () => {
    expect(BUILT_IN_MODEL_PRICING).toMatchObject({
      "mock/mock-cheap": { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
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
        outputUsdPerMillionTokens: 0.4,
      },
      "google/gemini-2.5-flash": {
        inputUsdPerMillionTokens: 0.3,
        cachedInputUsdPerMillionTokens: 0.03,
        outputUsdPerMillionTokens: 2.5,
      },
    });
  });

  it("separates cached input and returns conservative integer micro-USD", () => {
    expect(
      estimateTokenCostMicrousd(
        { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 100 },
        {
          inputUsdPerMillionTokens: 0.05,
          cachedInputUsdPerMillionTokens: 0.005,
          outputUsdPerMillionTokens: 0.4,
        }
      )
    ).toEqual({
      uncachedInputTokens: 800,
      cachedInputTokens: 200,
      outputTokens: 100,
      inputMicrousd: 40,
      cachedInputMicrousd: 1,
      outputMicrousd: 40,
      totalMicrousd: 81,
      totalUsd: 0.000081,
    });
  });

  it("parses configurable provider/model prices and rejects inconsistent usage", () => {
    const table = parseModelPricingTable(
      JSON.stringify({
        "openai/gpt-5-nano": {
          inputUsdPerMillionTokens: 0.05,
          cachedInputUsdPerMillionTokens: 0.005,
          outputUsdPerMillionTokens: 0.4,
        },
      })
    );
    expect(resolveModelPricing(table, { provider: "OPENAI", model: "gpt-5-nano" })).toMatchObject({
      outputUsdPerMillionTokens: 0.4,
    });
    expect(() =>
      estimateTokenCostMicrousd(
        { inputTokens: 10, cachedInputTokens: 11, outputTokens: 0 },
        { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1 }
      )
    ).toThrow(/cannot exceed/i);
  });

  it("lets configuration replace a built-in price without changing grading code", () => {
    const table = modelPricingTableFromConfig(
      JSON.stringify({
        "openai/gpt-5-nano": {
          inputUsdPerMillionTokens: 9,
          outputUsdPerMillionTokens: 10,
        },
      })
    );
    expect(table["openai/gpt-5-nano"]).toMatchObject({
      inputUsdPerMillionTokens: 9,
      outputUsdPerMillionTokens: 10,
    });
    expect(table["google/gemini-2.5-flash-lite"]).toBeDefined();
  });
});

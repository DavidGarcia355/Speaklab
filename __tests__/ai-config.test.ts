import { afterEach, describe, expect, it } from "vitest";
import {
  assertAiProviderConfig,
  getAiConfig,
  isAiAccessConfigurationSafe,
  isAiTeacherDenied,
} from "@/lib/ai/config";

const KEYS = [
  "AI_GRADING_ENABLED",
  "AI_BULK_GRADING_ENABLED",
  "AI_ACCESS_MODE",
  "AI_TEACHER_DENYLIST",
  "AI_STUDENT_DATA_APPROVED",
  "AI_MONTHLY_BUDGET_USD",
  "AI_RESERVED_COST_USD_PER_GENERATION",
  "ALLOW_TEACHER_SELF_REGISTRATION",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (typeof value === "undefined") delete process.env[key];
    else process.env[key] = value;
  }
});

describe("AI launch configuration", () => {
  it("defaults to paid access and a conservative 200 dollar monthly reservation ceiling", () => {
    delete process.env.AI_ACCESS_MODE;
    delete process.env.AI_MONTHLY_BUDGET_USD;
    delete process.env.AI_RESERVED_COST_USD_PER_GENERATION;

    const config = getAiConfig();

    expect(config.accessMode).toBe("paid");
    expect(config.bulkEnabled).toBe(false);
    expect(config.monthlyBudgetUsd).toBe(200);
    expect(config.reservedCostUsdPerGeneration).toBe(0.04);
  });

  it("supports broad access with an emergency teacher denylist", () => {
    process.env.AI_ACCESS_MODE = "all";
    process.env.AI_TEACHER_DENYLIST = "blocked@example.com, SECOND@example.com";

    const config = getAiConfig();

    expect(config.accessMode).toBe("all");
    expect(isAiTeacherDenied("BLOCKED@example.com", config)).toBe(true);
    expect(isAiTeacherDenied("allowed@example.com", config)).toBe(false);
  });

  it("fails closed when production student-data approval has not been recorded", () => {
    const config = {
      ...getAiConfig(),
      enabled: true,
      isDev: false,
      studentDataApproved: false,
    };

    expect(() => assertAiProviderConfig(config)).toThrow(/AI_STUDENT_DATA_APPROVED/);
  });

  it("rejects broad AI access combined with open production registration", () => {
    process.env.ALLOW_TEACHER_SELF_REGISTRATION = "true";
    const config = {
      ...getAiConfig(),
      enabled: true,
      isDev: false,
      studentDataApproved: true,
      accessMode: "all" as const,
      transcriptionProvider: "mock" as const,
      gradingProvider: "mock" as const,
    };

    expect(isAiAccessConfigurationSafe(config)).toBe(false);
    expect(() => assertAiProviderConfig(config)).toThrow(/self-registration/);
  });
});

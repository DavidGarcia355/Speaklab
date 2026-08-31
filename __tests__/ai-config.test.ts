import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAiProviderConfig,
  getAiConfig,
  isAiAccessConfigurationSafe,
  isAiTeacherDenied,
  shouldUseAiGateway,
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
  "OPENAI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "AI_GATEWAY_ENABLED",
  "VERCEL_OIDC_TOKEN",
  "AI_TRANSCRIPTION_PROVIDER",
  "AI_TRANSCRIPTION_MODEL",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const originalVercel = process.env.VERCEL;

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (typeof value === "undefined") delete process.env[key];
    else process.env[key] = value;
  }
  if (typeof originalVercel === "undefined") delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  vi.unstubAllEnvs();
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

  it("honors the explicitly reviewed transcription model without silent substitution", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AI_TRANSCRIPTION_PROVIDER = "openai";
    process.env.AI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

    expect(getAiConfig().transcriptionModel).toBe("gpt-4o-mini-transcribe");
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

  it("accepts Vercel OIDC as hosted provider authentication", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    process.env.VERCEL = "1";
    process.env.VERCEL_OIDC_TOKEN = "test-oidc-token";
    const config = {
      ...getAiConfig(),
      enabled: true,
      isDev: false,
      studentDataApproved: true,
      accessMode: "paid" as const,
      transcriptionProvider: "openai" as const,
      gradingProvider: "openai" as const,
    };

    expect(shouldUseAiGateway()).toBe(true);
    expect(() => assertAiProviderConfig(config)).not.toThrow();
  });

  it("allows direct OpenAI credentials to bypass a blocked Vercel Gateway", () => {
    process.env.AI_GATEWAY_ENABLED = "false";
    process.env.OPENAI_API_KEY = "test-direct-key";
    process.env.VERCEL = "1";
    process.env.VERCEL_OIDC_TOKEN = "test-oidc-token";
    const config = {
      ...getAiConfig(),
      enabled: true,
      isDev: false,
      studentDataApproved: true,
      accessMode: "paid" as const,
      transcriptionProvider: "openai" as const,
      gradingProvider: "openai" as const,
    };

    expect(shouldUseAiGateway()).toBe(false);
    expect(() => assertAiProviderConfig(config)).not.toThrow();
  });

  it("does not silently bypass an explicitly enabled Gateway with a direct OpenAI key", () => {
    process.env.AI_GATEWAY_ENABLED = "true";
    process.env.OPENAI_API_KEY = "direct-key-that-must-not-be-used";
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL;
    delete process.env.VERCEL_OIDC_TOKEN;
    const config = {
      ...getAiConfig(),
      enabled: true,
      isDev: false,
      studentDataApproved: true,
      accessMode: "paid" as const,
      transcriptionProvider: "openai" as const,
      gradingProvider: "openai" as const,
    };

    expect(shouldUseAiGateway()).toBe(true);
    expect(() => assertAiProviderConfig(config)).toThrow(/Gateway credentials/);
  });

  it("fails closed without direct or gateway provider credentials", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL;
    delete process.env.VERCEL_OIDC_TOKEN;
    const config = {
      ...getAiConfig(),
      enabled: true,
      isDev: false,
      studentDataApproved: true,
      accessMode: "paid" as const,
      transcriptionProvider: "openai" as const,
      gradingProvider: "openai" as const,
    };

    expect(() => assertAiProviderConfig(config)).toThrow(/OPENAI_API_KEY/);
  });

  it("rejects broad AI access combined with open production registration", () => {
    process.env.ALLOW_TEACHER_SELF_REGISTRATION = "  TRUE\t";
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

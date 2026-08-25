import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/features/route";

vi.mock("@/lib/http", () => ({
  withApiHandler: async (_request: Request, handler: () => Promise<Response>) => handler(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function readFeatures() {
  const response = await GET(new Request("http://localhost/api/features"));
  return (await response.json()) as {
    aiGradingEnabled: boolean;
    aiBulkGradingEnabled: boolean;
  };
}

describe("AI feature readiness", () => {
  it("keeps both controls off when only the bulk flag is enabled", async () => {
    vi.stubEnv("AI_GRADING_ENABLED", "false");
    vi.stubEnv("AI_BULK_GRADING_ENABLED", "true");

    await expect(readFeatures()).resolves.toMatchObject({
      aiGradingEnabled: false,
      aiBulkGradingEnabled: false,
    });
  });

  it("hides AI when an OpenAI key or valid budget is missing", async () => {
    vi.stubEnv("AI_GRADING_ENABLED", "true");
    vi.stubEnv("AI_TRANSCRIPTION_PROVIDER", "openai");
    vi.stubEnv("AI_GRADING_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(readFeatures()).resolves.toMatchObject({ aiGradingEnabled: false });

    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "0");
    await expect(readFeatures()).resolves.toMatchObject({ aiGradingEnabled: false });
  });

  it("hides production AI until the student-data review is explicitly recorded", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_GRADING_ENABLED", "true");
    vi.stubEnv("AI_TRANSCRIPTION_PROVIDER", "mock");
    vi.stubEnv("AI_GRADING_PROVIDER", "mock");
    vi.stubEnv("AI_STUDENT_DATA_APPROVED", "false");

    await expect(readFeatures()).resolves.toMatchObject({
      aiGradingEnabled: false,
      aiBulkGradingEnabled: false,
    });
  });

  it("hides AI when the provider-neutral grading configuration cannot run", async () => {
    vi.stubEnv("AI_GRADING_ENABLED", "true");
    vi.stubEnv("AI_TRANSCRIPTION_PROVIDER", "mock");
    vi.stubEnv("AI_GRADING_PROVIDER", "mock");
    vi.stubEnv("GRADING_DEFAULT_PROVIDER", "google");
    vi.stubEnv("GOOGLE_API_KEY", "");

    await expect(readFeatures()).resolves.toMatchObject({
      aiGradingEnabled: false,
      aiBulkGradingEnabled: false,
    });
  });

  it("exposes single and bulk controls only when both are fully ready", async () => {
    vi.stubEnv("AI_GRADING_ENABLED", "true");
    vi.stubEnv("AI_BULK_GRADING_ENABLED", "true");
    vi.stubEnv("AI_TRANSCRIPTION_PROVIDER", "mock");
    vi.stubEnv("AI_GRADING_PROVIDER", "mock");
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "200");

    await expect(readFeatures()).resolves.toMatchObject({
      aiGradingEnabled: true,
      aiBulkGradingEnabled: true,
    });
  });

  it("fails closed for broad production access with open registration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_GRADING_ENABLED", "true");
    vi.stubEnv("AI_TRANSCRIPTION_PROVIDER", "mock");
    vi.stubEnv("AI_GRADING_PROVIDER", "mock");
    vi.stubEnv("AI_STUDENT_DATA_APPROVED", "reviewed-2026-08-25");
    vi.stubEnv("AI_ACCESS_MODE", "all");
    vi.stubEnv("ALLOW_TEACHER_SELF_REGISTRATION", "true");

    await expect(readFeatures()).resolves.toMatchObject({ aiGradingEnabled: false });
  });
});

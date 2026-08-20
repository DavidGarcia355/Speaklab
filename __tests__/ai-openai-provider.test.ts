import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAiConfig } from "@/lib/ai/config";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  parse: vi.fn(),
  transcribe: vi.fn(),
  toFile: vi.fn(async (_buffer: Buffer, name: string, options: { type: string }) => ({ name, ...options })),
  gatewayClient: vi.fn(),
  gatewayModel: vi.fn(() => "gateway-transcription-model"),
  gatewayTranscribe: vi.fn(),
}));

vi.mock("ai", () => ({
  transcribe: mocks.gatewayTranscribe,
}));

vi.mock("@ai-sdk/gateway", () => ({
  createGateway: (options: unknown) => {
    mocks.gatewayClient(options);
    return { transcriptionModel: mocks.gatewayModel };
  },
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) {
      mocks.client(options);
    }
    chat = { completions: { parse: mocks.parse } };
    audio = { transcriptions: { create: mocks.transcribe } };
  },
  toFile: mocks.toFile,
}));

vi.mock("openai/helpers/zod", () => ({
  zodResponseFormat: vi.fn(() => ({ type: "json_schema", json_schema: { name: "ai_grading_suggestion" } })),
}));

describe("OpenAI provider contract", () => {
  beforeEach(() => {
    process.env.AI_GRADING_ENABLED = "true";
    process.env.AI_TRANSCRIPTION_PROVIDER = "openai";
    process.env.AI_GRADING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_ENABLED;
    delete process.env.VERCEL;
    delete process.env.VERCEL_OIDC_TOKEN;
    mocks.parse.mockReset();
    mocks.transcribe.mockReset();
    mocks.toFile.mockClear();
    mocks.client.mockClear();
    mocks.gatewayClient.mockClear();
    mocks.gatewayModel.mockClear();
    mocks.gatewayTranscribe.mockReset();
  });

  it("uses strict parsed output, bounded tokens, and separates trusted instructions", async () => {
    mocks.parse.mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              suggestedScore: 8,
              rubricScores: [],
              feedback: "Draft feedback.",
              strengths: ["Relevant details."],
              improvements: ["Add one example."],
              evidence: ["Hola"],
              confidence: "medium",
              warnings: [],
              teacherAttention: "review",
            },
            refusal: null,
          },
        },
      ],
    });
    const { gradeTranscript } = await import("@/lib/ai/providers");

    const result = await gradeTranscript({
      config: getAiConfig(),
      description: "Introduce yourself.",
      instructions: "Speak in Spanish.",
      rubric: null,
      maxPoints: 10,
      transcript: "Hola, me llamo Alex.",
    });

    expect(result.suggestedScore).toBe(8);
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 120_000, maxRetries: 2 })
    );
    expect(mocks.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        store: false,
        max_tokens: 1200,
        response_format: expect.objectContaining({ type: "json_schema" }),
        messages: [
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user" }),
        ],
      })
    );
  });

  it("preserves OGG media typing for transcription", async () => {
    mocks.transcribe.mockResolvedValue({ text: "Hola", duration: 4, language: "es" });
    const { transcribeAudio } = await import("@/lib/ai/providers");

    await transcribeAudio({
      config: getAiConfig(),
      buffer: Buffer.from("synthetic"),
      contentType: "audio/ogg;codecs=opus",
    });

    expect(mocks.toFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "audio.ogg",
      { type: "audio/ogg;codecs=opus" }
    );
  });

  it("uses Vercel AI Gateway OIDC for production transcription", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_OIDC_TOKEN = "test-oidc-token";
    mocks.gatewayTranscribe.mockResolvedValue({
      text: "Hola",
      durationInSeconds: 4,
      language: "es",
    });
    const { transcribeAudio } = await import("@/lib/ai/providers");

    const result = await transcribeAudio({
      config: getAiConfig(),
      buffer: Buffer.from("synthetic"),
      contentType: "audio/webm",
    });

    expect(result).toMatchObject({ transcript: "Hola", detectedLanguage: "es", durationSeconds: 4 });
    expect(mocks.gatewayClient).toHaveBeenCalledWith({ apiKey: "test-oidc-token" });
    expect(mocks.gatewayModel).toHaveBeenCalledWith("openai/whisper-1");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("routes structured grading through the gateway model namespace", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_OIDC_TOKEN = "test-oidc-token";
    mocks.parse.mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              suggestedScore: 8,
              rubricScores: [],
              feedback: "Draft feedback.",
              strengths: ["Relevant details."],
              improvements: ["Add one example."],
              evidence: ["Hola"],
              confidence: "medium",
              warnings: [],
              teacherAttention: "review",
            },
            refusal: null,
          },
        },
      ],
    });
    const { gradeTranscript } = await import("@/lib/ai/providers");

    await gradeTranscript({
      config: getAiConfig(),
      description: "Introduce yourself.",
      instructions: "Speak in Spanish.",
      rubric: null,
      maxPoints: 10,
      transcript: "Hola, me llamo Alex.",
    });

    expect(mocks.client).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: "test-oidc-token",
        baseURL: "https://ai-gateway.vercel.sh/v1",
      })
    );
    expect(mocks.parse).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "openai/gpt-4o-mini" })
    );
  });

  it("uses direct OpenAI when the Gateway is explicitly disabled on Vercel", async () => {
    process.env.AI_GATEWAY_ENABLED = "false";
    process.env.VERCEL = "1";
    process.env.VERCEL_OIDC_TOKEN = "blocked-gateway-token";
    mocks.transcribe.mockResolvedValue({ text: "Hola", duration: 4, language: "es" });
    const { transcribeAudio } = await import("@/lib/ai/providers");

    await transcribeAudio({
      config: getAiConfig(),
      buffer: Buffer.from("synthetic"),
      contentType: "audio/webm",
    });

    expect(mocks.client).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: "test-key" })
    );
    expect(mocks.client).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ baseURL: "https://ai-gateway.vercel.sh/v1" })
    );
    expect(mocks.gatewayClient).not.toHaveBeenCalled();
  });
});

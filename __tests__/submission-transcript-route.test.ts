import { beforeEach, describe, expect, it, vi } from "vitest";

const testHttp = vi.hoisted(() => {
  class HttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { HttpError };
});

const mocks = vi.hoisted(() => ({
  requireTeacherEmail: vi.fn(),
  findOwnedSubmission: vi.fn(),
  findTranscript: vi.fn(),
  listAttempts: vi.fn(),
  getAiConfig: vi.fn(),
  assertTranscriptionConfig: vi.fn(),
  isTeacherDenied: vi.fn(),
  transcribeOne: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));
vi.mock("@/lib/db", () => ({
  findOwnedSubmissionForAiReview: mocks.findOwnedSubmission,
  findSubmissionTranscriptForOwner: mocks.findTranscript,
  listAiGradingAttemptsForSubmission: mocks.listAttempts,
}));
vi.mock("@/lib/ai/config", () => ({
  getAiConfig: mocks.getAiConfig,
  assertAiTranscriptionProviderConfig: mocks.assertTranscriptionConfig,
  isAiTeacherDenied: mocks.isTeacherDenied,
}));
vi.mock("@/lib/ai/transcript-one", () => ({
  transcribeOneSubmission: mocks.transcribeOne,
}));
vi.mock("@/lib/http", () => ({
  HttpError: testHttp.HttpError,
  withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof testHttp.HttpError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  },
}));

const teacherEmail = "teacher@example.com";
const ownedSubmission = {
  submissionId: "sub_1",
  assignmentId: "asg_1",
  assignmentTitle: "Speaking",
  audioBlobUrl: "private/sub_1.webm",
  description: "",
  instructions: "Speak.",
  targetLanguage: "Spanish",
  rubric: null,
  maxPoints: 10,
  // Standalone transcription remains available after manual grading.
  finalGrade: 8,
  finalGradeSource: "teacher",
  finalFeedback: "Teacher feedback.",
};
const saved = {
  id: "tr_1",
  submissionId: "sub_1",
  teacherEmail,
  semanticKey: "secret-semantic-key",
  transcriptCacheKey: "secret-cache-key",
  transcript: "Hola, esta es mi respuesta.",
  detectedLanguage: "Spanish",
  transcriptQuality: "good",
  durationSeconds: 8,
  transcriptionProvider: "openai",
  transcriptionModel: "gpt-4o-transcribe",
  estimatedCostMicrousd: 10,
  latencyMs: 20,
  createdAt: 100,
  updatedAt: 101,
};
const context = { params: Promise.resolve({ submissionId: "sub_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTeacherEmail.mockResolvedValue(teacherEmail);
  mocks.findOwnedSubmission.mockResolvedValue(ownedSubmission);
  mocks.findTranscript.mockResolvedValue(null);
  mocks.listAttempts.mockResolvedValue([]);
  mocks.getAiConfig.mockReturnValue({ enabled: true });
  mocks.isTeacherDenied.mockReturnValue(false);
});

describe("submission transcript route", () => {
  it("returns the canonical null item for an owned submission with no transcript", async () => {
    const { GET } = await import(
      "@/app/api/submissions/[submissionId]/transcript/route"
    );
    const response = await GET(
      new Request("https://tryhabla.com/api/submissions/sub_1/transcript"),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ item: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not expose a failed over-limit attempt as a free transcript", async () => {
    mocks.listAttempts.mockResolvedValueOnce([
      {
        transcript: "Provider transcript that was never delivered.",
        errorCode: "audio_too_long",
        detectedLanguage: "Spanish",
        transcriptQuality: "good",
        durationSeconds: 301,
        createdAt: 100,
        completedAt: 101,
      },
    ]);
    const { GET } = await import(
      "@/app/api/submissions/[submissionId]/transcript/route"
    );
    const response = await GET(
      new Request("https://tryhabla.com/api/submissions/sub_1/transcript"),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ item: null });
  });

  it("requires authentication and owner access", async () => {
    const { GET } = await import(
      "@/app/api/submissions/[submissionId]/transcript/route"
    );
    mocks.requireTeacherEmail.mockRejectedValueOnce(
      new testHttp.HttpError(401, "You'll need to sign in first."),
    );
    const unauthenticated = await GET(
      new Request("https://tryhabla.com/api/submissions/sub_1/transcript"),
      context,
    );
    expect(unauthenticated.status).toBe(401);

    mocks.findOwnedSubmission.mockResolvedValueOnce(null);
    const wrongOwner = await GET(
      new Request("https://tryhabla.com/api/submissions/sub_1/transcript"),
      context,
    );
    expect(wrongOwner.status).toBe(403);
    await expect(wrongOwner.json()).resolves.toEqual({
      error: "You don't have access to this submission.",
    });
    expect(mocks.findTranscript).not.toHaveBeenCalled();
  });

  it("processes a manually graded recording and exposes only the public item shape", async () => {
    mocks.transcribeOne.mockResolvedValue({
      status: "completed",
      item: saved,
      allowance: { remaining: 29 },
    });
    const { POST } = await import(
      "@/app/api/submissions/[submissionId]/transcript/route"
    );
    const response = await POST(
      new Request("https://tryhabla.com/api/submissions/sub_1/transcript", {
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      item: {
        transcript: saved.transcript,
        detectedLanguage: saved.detectedLanguage,
        transcriptQuality: saved.transcriptQuality,
        durationSeconds: saved.durationSeconds,
        createdAt: saved.createdAt,
      },
      allowance: { remaining: 29 },
    });
    expect(mocks.transcribeOne).toHaveBeenCalledWith({
      config: { enabled: true },
      teacherEmail,
      data: ownedSubmission,
    });
  });

  it.each([
    ["no_audio", 404],
    ["audio_too_large", 413],
    ["usage_limit_reached", 429],
    ["provider_rate_limit", 429],
    ["provider_spend_limit", 429],
  ])("preserves %s as HTTP %i", async (code, expectedStatus) => {
    mocks.transcribeOne.mockResolvedValue({
      status: "failed",
      code,
      message: "Safe operational message.",
    });
    const { POST } = await import(
      "@/app/api/submissions/[submissionId]/transcript/route"
    );
    const response = await POST(
      new Request("https://tryhabla.com/api/submissions/sub_1/transcript", {
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({
      error: "Safe operational message.",
    });
  });
});

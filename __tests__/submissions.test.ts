import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assignments/[assignmentId]/submissions/route";

const mocks = vi.hoisted(() => ({
  mockRequireSchoolStudentEmail: vi.fn(),
  mockUploadSubmissionAudio: vi.fn(),
  mockCreateSubmission: vi.fn(),
  mockFindAssignmentById: vi.fn(),
  mockEnforceSubmissionRateLimit: vi.fn(),
  mockParseOrThrow400: vi.fn(),
  mockParseAudioDataUrl: vi.fn(),
  mockGetEnv: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireSchoolStudentEmail: mocks.mockRequireSchoolStudentEmail,
}));

vi.mock("@/lib/audio-storage", () => ({
  uploadSubmissionAudio: mocks.mockUploadSubmissionAudio,
}));

vi.mock("@/lib/db", () => ({
  createSubmission: mocks.mockCreateSubmission,
  findAssignmentById: mocks.mockFindAssignmentById,
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceSubmissionRateLimit: mocks.mockEnforceSubmissionRateLimit,
}));

vi.mock("@/lib/validation", () => ({
  parseAudioDataUrl: mocks.mockParseAudioDataUrl,
  parseOrThrow400: mocks.mockParseOrThrow400,
  submissionCreateSchema: {},
}));

vi.mock("@/lib/env", () => ({
  getEnv: mocks.mockGetEnv,
}));

vi.mock("@/lib/http", async () => {
  class MockHttpError extends Error {
    status: number;
    fieldErrors?: Record<string, string[]>;

    constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
      super(message);
      this.status = status;
      this.fieldErrors = fieldErrors;
    }
  }

  return {
    HttpError: MockHttpError,
    withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        if (error instanceof MockHttpError) {
          return Response.json(
            error.fieldErrors
              ? { error: error.message, fieldErrors: error.fieldErrors }
              : { error: error.message },
            { status: error.status }
          );
        }
        throw error;
      }
    },
  };
});

describe("submission route domain enforcement", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    LOCAL_DEV_BYPASS_AUTH: process.env.LOCAL_DEV_BYPASS_AUTH,
    ENFORCE_STUDENT_DOMAIN: process.env.ENFORCE_STUDENT_DOMAIN,
    STUDENT_DOMAIN: process.env.STUDENT_DOMAIN,
  };

  beforeEach(() => {
    process.env = {
      ...process.env,
      NODE_ENV: "test",
      LOCAL_DEV_BYPASS_AUTH: "false",
      ENFORCE_STUDENT_DOMAIN: "false",
    };
    delete process.env.STUDENT_DOMAIN;

    mocks.mockRequireSchoolStudentEmail.mockReset();
    mocks.mockUploadSubmissionAudio.mockReset();
    mocks.mockCreateSubmission.mockReset();
    mocks.mockFindAssignmentById.mockReset();
    mocks.mockEnforceSubmissionRateLimit.mockReset();
    mocks.mockParseOrThrow400.mockReset();
    mocks.mockParseAudioDataUrl.mockReset();
    mocks.mockGetEnv.mockReset();

    mocks.mockRequireSchoolStudentEmail.mockResolvedValue("student@gmail.com");
    mocks.mockFindAssignmentById.mockResolvedValue({
      id: "asg_1",
      ownerEmail: "teacher@school.edu",
    });
    mocks.mockEnforceSubmissionRateLimit.mockResolvedValue(undefined);
    mocks.mockParseOrThrow400.mockResolvedValue({
      studentName: "Student One",
      audioData: "data:audio/webm;base64,AAAA",
    });
    mocks.mockParseAudioDataUrl.mockReturnValue({
      mimeType: "audio/webm",
      buffer: Buffer.from("audio"),
    });
    mocks.mockUploadSubmissionAudio.mockResolvedValue("https://blob.example/audio.webm");
    mocks.mockCreateSubmission.mockResolvedValue({
      id: "sub_1",
      assignmentId: "asg_1",
      studentName: "Student One",
      studentEmail: "student@gmail.com",
      audioBlobUrl: "https://blob.example/audio.webm",
      submittedAt: 1,
    });
    mocks.mockGetEnv.mockReturnValue({ isDev: false });
  });

  afterEach(() => {
    process.env = {
      ...process.env,
      NODE_ENV: originalEnv.NODE_ENV,
      LOCAL_DEV_BYPASS_AUTH: originalEnv.LOCAL_DEV_BYPASS_AUTH,
      ENFORCE_STUDENT_DOMAIN: originalEnv.ENFORCE_STUDENT_DOMAIN,
      STUDENT_DOMAIN: originalEnv.STUDENT_DOMAIN,
    };
  });

  function makeRequest() {
    return new Request("http://localhost/api/assignments/asg_1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentName: "Student One",
        audioData: "data:audio/webm;base64,AAAA",
      }),
    });
  }

  it("allows a valid student when domain restriction is disabled", async () => {
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });

    expect(response.status).toBe(201);
    expect(mocks.mockCreateSubmission).toHaveBeenCalledOnce();
  });

  it("blocks non-matching domains when ENFORCE_STUDENT_DOMAIN=true", async () => {
    process.env.ENFORCE_STUDENT_DOMAIN = "true";

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(data.error).toContain("configured school email domain");
    expect(mocks.mockUploadSubmissionAudio).not.toHaveBeenCalled();
    expect(mocks.mockCreateSubmission).not.toHaveBeenCalled();
  });

  it("passes non-matching domains when ENFORCE_STUDENT_DOMAIN=false", async () => {
    process.env.ENFORCE_STUDENT_DOMAIN = "false";

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });

    expect(response.status).toBe(201);
    expect(mocks.mockCreateSubmission).toHaveBeenCalledOnce();
  });

  it("uses STUDENT_DOMAIN when explicitly configured", async () => {
    process.env.ENFORCE_STUDENT_DOMAIN = "true";
    process.env.STUDENT_DOMAIN = "district.edu";

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns a clear error when blob upload fails in production", async () => {
    mocks.mockUploadSubmissionAudio.mockRejectedValue(new Error("blob down"));

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(data.error).toContain("upload your recording");
    expect(data.error).toContain("school network");
    expect(mocks.mockCreateSubmission).not.toHaveBeenCalled();
  });
});

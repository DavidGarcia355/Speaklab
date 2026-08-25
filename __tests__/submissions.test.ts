import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assignments/[assignmentId]/submissions/route";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  mockRequireSchoolStudentEmail: vi.fn(),
  mockAssertRecordingDuration: vi.fn(),
  mockUploadSubmissionAudio: vi.fn(),
  mockDeleteSubmissionAudio: vi.fn(),
  mockCountStudentSubmissions: vi.fn(),
  mockCreateSubmission: vi.fn(),
  mockFindAssignmentById: vi.fn(),
  mockIsStudentOnRoster: vi.fn(),
  mockUpsertRosterEntry: vi.fn(),
  mockEnforceSubmissionRateLimit: vi.fn(),
  mockParseOrThrow400: vi.fn(),
  mockParseAudioDataUrl: vi.fn(),
  mockGetEnv: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireSchoolStudentEmail: mocks.mockRequireSchoolStudentEmail,
}));

vi.mock("@/lib/audio-duration", () => ({
  assertRecordingDuration: mocks.mockAssertRecordingDuration,
}));

vi.mock("@/lib/audio-storage", () => ({
  uploadSubmissionAudio: mocks.mockUploadSubmissionAudio,
  deleteSubmissionAudio: mocks.mockDeleteSubmissionAudio,
}));

vi.mock("@/lib/db", () => ({
  countStudentSubmissions: mocks.mockCountStudentSubmissions,
  createSubmission: mocks.mockCreateSubmission,
  findAssignmentById: mocks.mockFindAssignmentById,
  isStudentOnRoster: mocks.mockIsStudentOnRoster,
  upsertRosterEntry: mocks.mockUpsertRosterEntry,
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
    REQUIRE_ROSTER_FOR_SUBMISSIONS: process.env.REQUIRE_ROSTER_FOR_SUBMISSIONS,
  };

  beforeEach(() => {
    process.env = {
      ...process.env,
      NODE_ENV: "test",
      LOCAL_DEV_BYPASS_AUTH: "false",
      ENFORCE_STUDENT_DOMAIN: "false",
      REQUIRE_ROSTER_FOR_SUBMISSIONS: "false",
    };
    delete process.env.STUDENT_DOMAIN;

    mocks.mockRequireSchoolStudentEmail.mockReset();
    mocks.mockAssertRecordingDuration.mockReset();
    mocks.mockUploadSubmissionAudio.mockReset();
    mocks.mockDeleteSubmissionAudio.mockReset();
    mocks.mockCountStudentSubmissions.mockReset();
    mocks.mockCreateSubmission.mockReset();
    mocks.mockFindAssignmentById.mockReset();
    mocks.mockIsStudentOnRoster.mockReset();
    mocks.mockUpsertRosterEntry.mockReset();
    mocks.mockEnforceSubmissionRateLimit.mockReset();
    mocks.mockParseOrThrow400.mockReset();
    mocks.mockParseAudioDataUrl.mockReset();
    mocks.mockGetEnv.mockReset();

    mocks.mockRequireSchoolStudentEmail.mockResolvedValue("student@gmail.com");
    mocks.mockAssertRecordingDuration.mockResolvedValue(59.9);
    mocks.mockFindAssignmentById.mockResolvedValue({
      id: "asg_1",
      classId: "class_1",
      ownerEmail: "teacher@school.edu",
      maxSubmissions: 0,
      maxRecordingSeconds: 60,
    });
    mocks.mockCountStudentSubmissions.mockResolvedValue(0);
    mocks.mockIsStudentOnRoster.mockResolvedValue(true);
    mocks.mockEnforceSubmissionRateLimit.mockResolvedValue(undefined);
    mocks.mockParseOrThrow400.mockReturnValue({
      studentName: "Student One",
      audioData: "data:audio/webm;base64,AAAA",
    });
    mocks.mockParseAudioDataUrl.mockReturnValue({
      mimeType: "audio/webm",
      buffer: Buffer.from("audio"),
    });
    mocks.mockUploadSubmissionAudio.mockResolvedValue("https://blob.example/audio.webm");
    mocks.mockDeleteSubmissionAudio.mockResolvedValue(undefined);
    mocks.mockCreateSubmission.mockResolvedValue({
      id: "sub_1",
      assignmentId: "asg_1",
      studentName: "Student One",
      studentEmail: "student@gmail.com",
      audioBlobUrl: "https://blob.example/audio.webm",
      submittedAt: 1,
    });
    mocks.mockUpsertRosterEntry.mockResolvedValue(undefined);
    mocks.mockGetEnv.mockReturnValue({ isDev: false });
  });

  afterEach(() => {
    process.env = {
      ...process.env,
      NODE_ENV: originalEnv.NODE_ENV,
      LOCAL_DEV_BYPASS_AUTH: originalEnv.LOCAL_DEV_BYPASS_AUTH,
      ENFORCE_STUDENT_DOMAIN: originalEnv.ENFORCE_STUDENT_DOMAIN,
      STUDENT_DOMAIN: originalEnv.STUDENT_DOMAIN,
      REQUIRE_ROSTER_FOR_SUBMISSIONS: originalEnv.REQUIRE_ROSTER_FOR_SUBMISSIONS,
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
    expect(mocks.mockAssertRecordingDuration).toHaveBeenCalledWith({
      buffer: Buffer.from("audio"),
      mimeType: "audio/webm",
      maxRecordingSeconds: 60,
    });
    expect(mocks.mockCreateSubmission).toHaveBeenCalledOnce();
  });

  it("rejects an over-limit low-bitrate recording before upload", async () => {
    mocks.mockAssertRecordingDuration.mockRejectedValue(
      new HttpError(400, "Validation failed.", {
        audioData: ["Recording must be 60 seconds or shorter."],
      })
    );

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });
    const data = (await response.json()) as { fieldErrors: { audioData: string[] } };

    expect(response.status).toBe(400);
    expect(data.fieldErrors.audioData).toContain("Recording must be 60 seconds or shorter.");
    expect(mocks.mockUploadSubmissionAudio).not.toHaveBeenCalled();
    expect(mocks.mockCreateSubmission).not.toHaveBeenCalled();
  });

  it("rejects unreadable duration metadata before upload", async () => {
    mocks.mockAssertRecordingDuration.mockRejectedValue(
      new HttpError(400, "Validation failed.", {
        audioData: ["We couldn't verify this recording's length."],
      })
    );

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.mockUploadSubmissionAudio).not.toHaveBeenCalled();
    expect(mocks.mockCreateSubmission).not.toHaveBeenCalled();
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

  it("fails closed when the production Blob store cannot accept private audio", async () => {
    mocks.mockUploadSubmissionAudio.mockRejectedValue(
      new Error("Vercel Blob: Cannot use private access on a public store.")
    );

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(data.error).toContain("upload your recording");
    expect(mocks.mockCreateSubmission).not.toHaveBeenCalled();
  });

  it("removes an uploaded private Blob when database persistence fails", async () => {
    mocks.mockUploadSubmissionAudio.mockResolvedValue("submissions/asg_1/orphan.webm");
    mocks.mockCreateSubmission.mockRejectedValue(new Error("database unavailable"));

    await expect(
      POST(makeRequest(), { params: Promise.resolve({ assignmentId: "asg_1" }) })
    ).rejects.toThrow("database unavailable");

    expect(mocks.mockDeleteSubmissionAudio).toHaveBeenCalledWith(
      "submissions/asg_1/orphan.webm"
    );
  });

  it("blocks submissions from students outside the roster when roster enforcement is enabled", async () => {
    process.env.REQUIRE_ROSTER_FOR_SUBMISSIONS = "true";
    mocks.mockIsStudentOnRoster.mockResolvedValue(false);

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(data.error).toContain("class roster");
    expect(mocks.mockUploadSubmissionAudio).not.toHaveBeenCalled();
    expect(mocks.mockCreateSubmission).not.toHaveBeenCalled();
  });
});

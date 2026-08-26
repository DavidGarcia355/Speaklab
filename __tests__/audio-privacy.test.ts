import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  blobPut: vi.fn(),
  blobGet: vi.fn(),
  blobDel: vi.fn(),
  requireTeacherEmail: vi.fn(),
  requireAuthenticatedEmail: vi.fn(),
  requireSchoolStudentEmail: vi.fn(),
  findSubmissionAccessById: vi.fn(),
  findStudentSubmissionAudioAccessById: vi.fn(),
  findAssignmentById: vi.fn(),
  isStudentOnRoster: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: mocks.blobPut,
  get: mocks.blobGet,
  del: mocks.blobDel,
}));

const originalAudioStoreId = process.env.AUDIO_BLOB_STORE_ID;
const originalAudioToken = process.env.AUDIO_READ_WRITE_TOKEN;
const originalVercel = process.env.VERCEL;
const originalEnforceStudentDomain = process.env.ENFORCE_STUDENT_DOMAIN;
const originalRequireRoster = process.env.REQUIRE_ROSTER_FOR_SUBMISSIONS;
const originalStudentDomain = process.env.STUDENT_DOMAIN;
const originalLocalBypass = process.env.LOCAL_DEV_BYPASS_AUTH;

function restoreEnv(name: string, value: string | undefined) {
  if (typeof value === "undefined") delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  restoreEnv("AUDIO_BLOB_STORE_ID", originalAudioStoreId);
  restoreEnv("AUDIO_READ_WRITE_TOKEN", originalAudioToken);
  restoreEnv("VERCEL", originalVercel);
  restoreEnv("ENFORCE_STUDENT_DOMAIN", originalEnforceStudentDomain);
  restoreEnv("REQUIRE_ROSTER_FOR_SUBMISSIONS", originalRequireRoster);
  restoreEnv("STUDENT_DOMAIN", originalStudentDomain);
  restoreEnv("LOCAL_DEV_BYPASS_AUTH", originalLocalBypass);
});

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
  requireAuthenticatedEmail: mocks.requireAuthenticatedEmail,
  requireSchoolStudentEmail: mocks.requireSchoolStudentEmail,
}));

vi.mock("@/lib/db", () => ({
  findSubmissionAccessById: mocks.findSubmissionAccessById,
  findStudentSubmissionAudioAccessById: mocks.findStudentSubmissionAudioAccessById,
  findAssignmentById: mocks.findAssignmentById,
  isStudentOnRoster: mocks.isStudentOnRoster,
}));

vi.mock("@/lib/http", async () => {
  class MockHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return {
    HttpError: MockHttpError,
    withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        if (error instanceof MockHttpError) {
          return Response.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
    },
  };
});

describe("private-only audio storage", () => {
  beforeEach(() => {
    mocks.blobPut.mockReset();
    mocks.blobDel.mockReset();
    process.env.AUDIO_BLOB_STORE_ID = "store_audio_test";
    process.env.VERCEL = "1";
    delete process.env.AUDIO_READ_WRITE_TOKEN;
  });

  it("uploads submission audio with private access", async () => {
    const { uploadSubmissionAudio } = await import("@/lib/audio-storage");
    mocks.blobPut.mockResolvedValue({ pathname: "submissions/asg/sub.webm" });

    const result = await uploadSubmissionAudio({
      assignmentId: "asg_1",
      submissionId: "sub_1",
      mimeType: "audio/webm",
      buffer: Buffer.from("audio"),
    });

    expect(result).toBe("submissions/asg/sub.webm");
    expect(mocks.blobPut).toHaveBeenCalledWith(
      expect.stringMatching(/^submissions\/asg_1\/sub_1-/),
      Buffer.from("audio"),
      expect.objectContaining({
        access: "private",
        contentType: "audio/webm",
        addRandomSuffix: false,
        storeId: "store_audio_test",
      })
    );
  });

  it("fails before upload when the dedicated private store is not configured", async () => {
    const { uploadSubmissionAudio } = await import("@/lib/audio-storage");
    delete process.env.AUDIO_BLOB_STORE_ID;

    await expect(
      uploadSubmissionAudio({
        assignmentId: "asg_1",
        submissionId: "sub_1",
        mimeType: "audio/webm",
        buffer: Buffer.from("audio"),
      })
    ).rejects.toThrow(/AUDIO_BLOB_STORE_ID/);

    expect(mocks.blobPut).not.toHaveBeenCalled();
  });

  it("does not retry with public access when private upload fails", async () => {
    const { uploadSubmissionAudio } = await import("@/lib/audio-storage");
    mocks.blobPut.mockRejectedValue(new Error("Cannot use private access on a public store"));

    await expect(
      uploadSubmissionAudio({
        assignmentId: "asg_1",
        submissionId: "sub_1",
        mimeType: "audio/webm",
        buffer: Buffer.from("audio"),
      })
    ).rejects.toThrow("Cannot use private access");

    expect(mocks.blobPut).toHaveBeenCalledTimes(1);
    expect(mocks.blobPut.mock.calls[0]?.[2]).toMatchObject({ access: "private" });
  });
});

describe("private worksheet storage and authorized delivery", () => {
  beforeEach(() => {
    mocks.blobPut.mockReset();
    mocks.blobGet.mockReset();
    mocks.requireAuthenticatedEmail.mockReset();
    mocks.findAssignmentById.mockReset();
    mocks.isStudentOnRoster.mockReset();
    mocks.requireAuthenticatedEmail.mockResolvedValue("teacher@example.com");
    mocks.isStudentOnRoster.mockResolvedValue(false);
    process.env.AUDIO_BLOB_STORE_ID = "store_audio_test";
    process.env.VERCEL = "1";
    process.env.ENFORCE_STUDENT_DOMAIN = "false";
    process.env.REQUIRE_ROSTER_FOR_SUBMISSIONS = "false";
    process.env.LOCAL_DEV_BYPASS_AUTH = "false";
    delete process.env.AUDIO_READ_WRITE_TOKEN;
    delete process.env.STUDENT_DOMAIN;
  });

  it("uploads only signature-validated worksheets with private access", async () => {
    const { uploadAssignmentAttachment } = await import("@/lib/attachment-storage");
    mocks.blobPut.mockResolvedValue({
      pathname: "assignment-attachments/asg_1/file.pdf",
    });
    const pdf = Buffer.from("%PDF-1.7\n%%EOF", "ascii");

    const result = await uploadAssignmentAttachment({
      assignmentId: "asg_1",
      fileName: "My Worksheet.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });

    expect(result).toBe("assignment-attachments/asg_1/file.pdf");
    expect(mocks.blobPut).toHaveBeenCalledWith(
      expect.stringMatching(/^assignment-attachments\/asg_1\//),
      pdf,
      expect.objectContaining({
        access: "private",
        contentType: "application/pdf",
        storeId: "store_audio_test",
      })
    );

    await expect(
      uploadAssignmentAttachment({
        assignmentId: "asg_1",
        fileName: "fake.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not a pdf"),
      })
    ).rejects.toThrow(/contents/);
    expect(mocks.blobPut).toHaveBeenCalledTimes(1);
  });

  async function callAttachmentRoute(assignmentId = "asg_1") {
    const { GET } = await import("@/app/api/assignments/[assignmentId]/attachment/route");
    return GET(new Request(`http://localhost/api/assignments/${assignmentId}/attachment`), {
      params: Promise.resolve({ assignmentId }),
    });
  }

  function privateAssignment() {
    return {
      id: "asg_1",
      classId: "class_1",
      ownerEmail: "teacher@example.com",
      attachmentName: "worksheet.pdf",
      attachmentUrl: "assignment-attachments/asg_1/file.pdf",
      attachmentContentType: "application/pdf",
    };
  }

  it("serves a private worksheet to its teacher through the proxy", async () => {
    mocks.findAssignmentById.mockResolvedValue(privateAssignment());
    mocks.blobGet.mockResolvedValue({
      statusCode: 200,
      stream: new Response("%PDF-1.7").body,
      blob: { contentType: "application/pdf", size: 8 },
    });

    const response = await callAttachmentRoute();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mocks.blobGet).toHaveBeenCalledWith(
      "assignment-attachments/asg_1/file.pdf",
      expect.objectContaining({ access: "private", storeId: "store_audio_test" })
    );
  });

  it("allows signed-in students from open assignment links without a roster lookup", async () => {
    mocks.findAssignmentById.mockResolvedValue(privateAssignment());
    mocks.requireAuthenticatedEmail.mockResolvedValue("student@example.com");
    mocks.blobGet.mockResolvedValue({
      statusCode: 200,
      stream: new Response("%PDF-1.7").body,
      blob: { contentType: "application/pdf", size: 8 },
    });

    const response = await callAttachmentRoute();

    expect(response.status).toBe(200);
    expect(mocks.isStudentOnRoster).not.toHaveBeenCalled();
  });

  it("requires roster membership when submission links are roster-restricted", async () => {
    process.env.REQUIRE_ROSTER_FOR_SUBMISSIONS = "true";
    mocks.findAssignmentById.mockResolvedValue(privateAssignment());
    mocks.requireAuthenticatedEmail.mockResolvedValue("student@example.com");
    mocks.blobGet.mockResolvedValue({
      statusCode: 200,
      stream: new Response("%PDF-1.7").body,
      blob: { contentType: "application/pdf", size: 8 },
    });

    const denied = await callAttachmentRoute();
    expect(denied.status).toBe(403);
    expect(mocks.blobGet).not.toHaveBeenCalled();

    mocks.isStudentOnRoster.mockResolvedValue(true);
    const allowed = await callAttachmentRoute();
    expect(allowed.status).toBe(200);
    expect(mocks.isStudentOnRoster).toHaveBeenCalledWith("class_1", "student@example.com");
  });

  it("applies the same configured student-domain rule as submissions", async () => {
    process.env.ENFORCE_STUDENT_DOMAIN = "true";
    process.env.STUDENT_DOMAIN = "school.example";
    mocks.findAssignmentById.mockResolvedValue(privateAssignment());
    mocks.blobGet.mockResolvedValue({
      statusCode: 200,
      stream: new Response("%PDF-1.7").body,
      blob: { contentType: "application/pdf", size: 8 },
    });

    mocks.requireAuthenticatedEmail.mockResolvedValue("student@outside.example");
    const denied = await callAttachmentRoute();
    expect(denied.status).toBe(403);
    expect(mocks.blobGet).not.toHaveBeenCalled();

    mocks.requireAuthenticatedEmail.mockResolvedValue("student@school.example");
    const allowed = await callAttachmentRoute();
    expect(allowed.status).toBe(200);
    expect(mocks.isStudentOnRoster).not.toHaveBeenCalled();
  });

  it("returns only a proxy URL from the public assignment endpoint", async () => {
    mocks.findAssignmentById.mockResolvedValue({
      ...privateAssignment(),
      className: "Spanish 1",
      title: "Speaking check",
      description: "",
      instructions: "Respond.",
      targetLanguage: "Spanish",
      maxPoints: 10,
      maxSubmissions: 1,
      maxRecordingSeconds: 60,
      rubric: null,
      createdAt: 1,
    });
    const { GET } = await import("@/app/api/student/assignments/[assignmentId]/route");
    const response = await GET(new Request("http://localhost/api/student/assignments/asg_1"), {
      params: Promise.resolve({ assignmentId: "asg_1" }),
    });
    const body = (await response.json()) as { item: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.item.attachmentUrl).toBe("/api/assignments/asg_1/attachment");
    expect(body.item.ownerEmail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("file.pdf");
  });
});

describe("audio playback authorization and legacy handling", () => {
  beforeEach(() => {
    mocks.blobGet.mockReset();
    mocks.requireTeacherEmail.mockReset();
    mocks.findSubmissionAccessById.mockReset();
    mocks.requireTeacherEmail.mockResolvedValue("teacher@example.com");
    process.env.AUDIO_BLOB_STORE_ID = "store_audio_test";
    process.env.VERCEL = "1";
  });

  async function callAudioRoute(submissionId = "sub_1") {
    const { GET } = await import("@/app/api/submissions/[submissionId]/audio/route");
    return GET(new Request("http://localhost/api/submissions/sub_1/audio"), {
      params: Promise.resolve({ submissionId }),
    });
  }

  it("serves legacy data-url audio only after teacher authorization", async () => {
    mocks.findSubmissionAccessById.mockResolvedValue({
      id: "sub_1",
      studentEmail: "student@example.com",
      audioBlobUrl: `data:audio/webm;base64,${Buffer.from("audio").toString("base64")}`,
    });

    const response = await callAudioRoute();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("audio");
    expect(mocks.findSubmissionAccessById).toHaveBeenCalledWith("sub_1", "teacher@example.com");
  });

  it("serves legacy data-url audio with quoted multi-codec metadata", async () => {
    mocks.findSubmissionAccessById.mockResolvedValue({
      id: "sub_1",
      studentEmail: "student@example.com",
      audioBlobUrl: `data:audio/webm;codecs="opus,pcm";base64,${Buffer.from("audio").toString("base64")}`,
    });

    const response = await callAudioRoute();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/webm");
    expect(await response.text()).toBe("audio");
  });

  it("denies unrelated teachers when the submission lookup fails", async () => {
    mocks.findSubmissionAccessById.mockResolvedValue(null);

    const response = await callAudioRoute();
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(data.error).toContain("access");
  });

  it("returns not found when the private blob is missing", async () => {
    mocks.findSubmissionAccessById.mockResolvedValue({
      id: "sub_1",
      studentEmail: "student@example.com",
      audioBlobUrl: "submissions/asg/sub.webm",
    });
    mocks.blobGet.mockResolvedValue({ statusCode: 404 });

    const response = await callAudioRoute();

    expect(response.status).toBe(404);
  });

  it("serves private audio from the dedicated store with no-sniff headers", async () => {
    mocks.findSubmissionAccessById.mockResolvedValue({
      id: "sub_1",
      studentEmail: "student@example.com",
      audioBlobUrl: "submissions/asg/sub.webm",
    });
    mocks.blobGet.mockResolvedValue({
      statusCode: 200,
      stream: new Response("audio").body,
      blob: { contentType: "audio/webm" },
    });

    const response = await callAudioRoute();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mocks.blobGet).toHaveBeenCalledWith(
      "submissions/asg/sub.webm",
      expect.objectContaining({
        access: "private",
        storeId: "store_audio_test",
      })
    );
  });

  it("blocks public blob URLs instead of proxying unsafe legacy storage", async () => {
    mocks.findSubmissionAccessById.mockResolvedValue({
      id: "sub_1",
      studentEmail: "student@example.com",
      audioBlobUrl: "https://abc.public.blob.vercel-storage.com/submissions/asg/sub.webm",
    });

    const response = await callAudioRoute();
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(410);
    expect(data.error).toContain("migration");
    expect(mocks.blobGet).not.toHaveBeenCalled();
  });
});

describe("student oral-portfolio audio authorization", () => {
  beforeEach(() => {
    mocks.blobGet.mockReset();
    mocks.requireSchoolStudentEmail.mockReset();
    mocks.findStudentSubmissionAudioAccessById.mockReset();
    mocks.requireSchoolStudentEmail.mockResolvedValue("student@example.com");
    process.env.AUDIO_BLOB_STORE_ID = "store_audio_test";
    process.env.VERCEL = "1";
  });

  async function callStudentAudioRoute(submissionId = "sub_1") {
    const { GET } = await import("@/app/api/student/submissions/[submissionId]/audio/route");
    return GET(new Request(`http://localhost/api/student/submissions/${submissionId}/audio`), {
      params: Promise.resolve({ submissionId }),
    });
  }

  it("streams a student's own active private recording", async () => {
    mocks.findStudentSubmissionAudioAccessById.mockResolvedValue({
      id: "sub_1",
      studentEmail: "student@example.com",
      audioBlobUrl: "submissions/asg/sub.webm",
    });
    mocks.blobGet.mockResolvedValue({
      statusCode: 200,
      stream: new Response("audio").body,
      blob: { contentType: "audio/webm" },
    });

    const response = await callStudentAudioRoute();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mocks.findStudentSubmissionAudioAccessById).toHaveBeenCalledWith(
      "sub_1",
      "student@example.com"
    );
  });

  it("does not reveal another student's recording when an ID is guessed", async () => {
    mocks.requireSchoolStudentEmail.mockResolvedValue("other-student@example.com");
    mocks.findStudentSubmissionAudioAccessById.mockResolvedValue(null);

    const response = await callStudentAudioRoute("sub_someone_else");
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Audio not found.");
    expect(mocks.findStudentSubmissionAudioAccessById).toHaveBeenCalledWith(
      "sub_someone_else",
      "other-student@example.com"
    );
    expect(mocks.blobGet).not.toHaveBeenCalled();
  });

  it("denies unauthenticated playback before looking up a submission", async () => {
    const { HttpError } = await import("@/lib/http");
    mocks.requireSchoolStudentEmail.mockRejectedValue(
      new HttpError(401, "You'll need to sign in first.")
    );

    const response = await callStudentAudioRoute();

    expect(response.status).toBe(401);
    expect(mocks.findStudentSubmissionAudioAccessById).not.toHaveBeenCalled();
    expect(mocks.blobGet).not.toHaveBeenCalled();
  });
});

describe("AI audio data-url compatibility", () => {
  it("decodes legacy data URLs with quoted multi-codec metadata", async () => {
    const { fetchAuthorizedAudioBuffer } = await import("@/lib/ai/audio");

    const result = await fetchAuthorizedAudioBuffer(
      `data:audio/webm;codecs="opus,pcm";base64,${Buffer.from("audio").toString("base64")}`
    );

    expect(result.contentType).toBe("audio/webm");
    expect(result.storageMode).toBe("legacy-data-url");
    expect(result.buffer.toString()).toBe("audio");
  });
});

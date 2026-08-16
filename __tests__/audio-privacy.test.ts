import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  blobPut: vi.fn(),
  blobGet: vi.fn(),
  requireTeacherEmail: vi.fn(),
  findSubmissionAccessById: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: mocks.blobPut,
  get: mocks.blobGet,
}));

vi.mock("@/lib/authz", () => ({
  requireTeacherEmail: mocks.requireTeacherEmail,
}));

vi.mock("@/lib/db", () => ({
  findSubmissionAccessById: mocks.findSubmissionAccessById,
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
      })
    );
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

describe("audio playback authorization and legacy handling", () => {
  beforeEach(() => {
    mocks.blobGet.mockReset();
    mocks.requireTeacherEmail.mockReset();
    mocks.findSubmissionAccessById.mockReset();
    mocks.requireTeacherEmail.mockResolvedValue("teacher@example.com");
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

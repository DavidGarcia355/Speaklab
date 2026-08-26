import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  del: vi.fn(),
}));

const originalAudioStoreId = process.env.AUDIO_BLOB_STORE_ID;
const originalVercel = process.env.VERCEL;

afterAll(() => {
  if (typeof originalAudioStoreId === "undefined") delete process.env.AUDIO_BLOB_STORE_ID;
  else process.env.AUDIO_BLOB_STORE_ID = originalAudioStoreId;
  if (typeof originalVercel === "undefined") delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

vi.mock("@vercel/blob", () => {
  class MockBlobNotFoundError extends Error {}

  return {
    BlobNotFoundError: MockBlobNotFoundError,
    del: mocks.del,
  };
});

describe("blob deletion", () => {
  beforeEach(() => {
    mocks.del.mockReset();
    process.env.AUDIO_BLOB_STORE_ID = "store_audio_test";
    process.env.VERCEL = "1";
  });

  it("treats an already-missing blob as successfully gone for idempotent retries", async () => {
    const { BlobNotFoundError } = await import("@vercel/blob");
    const { deleteBlobObjects } = await import("@/lib/blob-deletion");
    mocks.del.mockRejectedValueOnce(new BlobNotFoundError());

    const result = await deleteBlobObjects(["submissions/asg/already-deleted.webm"]);

    expect(result).toEqual({
      attempted: 1,
      deleted: 0,
      alreadyMissing: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it("reports provider failures without exposing deletion targets", async () => {
    const { deleteBlobObjects } = await import("@/lib/blob-deletion");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.del.mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await deleteBlobObjects(
      ["submissions/asg/private-student-audio.webm"],
      { objectClass: "audio" }
    );

    expect(result).toEqual({
      attempted: 1,
      deleted: 0,
      alreadyMissing: 0,
      failed: 1,
      skipped: 0,
    });
    expect(warn).toHaveBeenCalledWith(
      "Blob deletion failed during cleanup",
      expect.objectContaining({
        targetKind: "pathname",
        errorName: "Error",
        objectClass: "audio",
      })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-student-audio");
  });

  it("routes private audio to its store while preserving legacy public deletion", async () => {
    const { deleteBlobObjects } = await import("@/lib/blob-deletion");
    mocks.del.mockResolvedValue(undefined);
    const publicUrl =
      "https://legacy.public.blob.vercel-storage.com/submissions/asg/legacy.webm";

    const result = await deleteBlobObjects(
      [publicUrl, "submissions/asg/private.webm", "data:audio/webm;base64,AAAA"],
      { objectClass: "audio" }
    );

    expect(result).toMatchObject({ attempted: 2, deleted: 2, skipped: 1 });
    expect(mocks.del).toHaveBeenNthCalledWith(1, publicUrl, undefined);
    expect(mocks.del).toHaveBeenNthCalledWith(
      2,
      "submissions/asg/private.webm",
      expect.objectContaining({ storeId: "store_audio_test" })
    );
  });

  it("routes private worksheet cleanup to the dedicated private store", async () => {
    const { deleteBlobObjects } = await import("@/lib/blob-deletion");
    mocks.del.mockResolvedValue(undefined);

    await deleteBlobObjects(
      ["assignment-attachments/asg_1/worksheet.pdf"],
      { objectClass: "attachment" }
    );

    expect(mocks.del).toHaveBeenCalledWith(
      "assignment-attachments/asg_1/worksheet.pdf",
      expect.objectContaining({ storeId: "store_audio_test" })
    );
  });
});

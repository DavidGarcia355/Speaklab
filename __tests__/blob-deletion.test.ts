import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  del: vi.fn(),
}));

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

    const result = await deleteBlobObjects(["submissions/asg/private-student-audio.webm"]);

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
        errorMessage: "provider unavailable",
      })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-student-audio");
  });
});

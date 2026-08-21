import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  listStorageObjectsForHardDeleteBefore: vi.fn(),
  hardDeleteSoftDeletedBefore: vi.fn(),
  deleteBlobObjects: vi.fn(),
  flushPendingAiBillingUsage: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: mocks.getEnv,
}));

vi.mock("@/lib/db", () => ({
  listStorageObjectsForHardDeleteBefore: mocks.listStorageObjectsForHardDeleteBefore,
  hardDeleteSoftDeletedBefore: mocks.hardDeleteSoftDeletedBefore,
}));

vi.mock("@/lib/blob-deletion", () => ({
  deleteBlobObjects: mocks.deleteBlobObjects,
}));

vi.mock("@/lib/billing", () => ({
  flushPendingAiBillingUsage: mocks.flushPendingAiBillingUsage,
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

describe("cleanup cron route", () => {
  beforeEach(() => {
    mocks.getEnv.mockReset();
    mocks.listStorageObjectsForHardDeleteBefore.mockReset();
    mocks.hardDeleteSoftDeletedBefore.mockReset();
    mocks.deleteBlobObjects.mockReset();
    mocks.flushPendingAiBillingUsage.mockReset();
    mocks.flushPendingAiBillingUsage.mockResolvedValue({ attempted: 0, reported: 0, failed: 0 });
    mocks.getEnv.mockReturnValue({ cronSecret: "cron-secret" });
    mocks.listStorageObjectsForHardDeleteBefore.mockResolvedValue({
      audioBlobUrls: ["submissions/asg/sub.webm"],
      attachmentUrls: ["assignment-attachments/asg/file.pdf"],
    });
    mocks.hardDeleteSoftDeletedBefore.mockResolvedValue({
      submissionsDeleted: 1,
      assignmentsDeleted: 1,
      classesDeleted: 0,
    });
    mocks.deleteBlobObjects.mockResolvedValue({
      attempted: 1,
      deleted: 1,
      alreadyMissing: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("requires the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/cleanup/route");

    const response = await GET(new Request("http://localhost/api/cron/cleanup"));

    expect(response.status).toBe(403);
    expect(mocks.hardDeleteSoftDeletedBefore).not.toHaveBeenCalled();
    expect(mocks.deleteBlobObjects).not.toHaveBeenCalled();
  });

  it("deletes eligible blobs before hard-deleting records and returns a non-PII summary", async () => {
    const { GET } = await import("@/app/api/cron/cleanup/route");

    const response = await GET(
      new Request("http://localhost/api/cron/cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );
    const data = (await response.json()) as {
      ok: boolean;
      submissionsDeleted: number;
      audioObjects: { deleted: number };
      attachmentObjects: { deleted: number };
    };

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      submissionsDeleted: 1,
      audioObjects: { deleted: 1 },
      attachmentObjects: { deleted: 1 },
    });
    expect(JSON.stringify(data)).not.toContain("student");
    expect(mocks.deleteBlobObjects).toHaveBeenCalledWith(
      ["submissions/asg/sub.webm"],
      { objectClass: "audio" }
    );
    expect(mocks.deleteBlobObjects).toHaveBeenCalledWith(
      ["assignment-attachments/asg/file.pdf"],
      { objectClass: "attachment" }
    );
    expect(mocks.deleteBlobObjects.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.hardDeleteSoftDeletedBefore.mock.invocationCallOrder[0]
    );
  });

  it("returns a retryable failure and preserves database references when any blob deletion fails", async () => {
    mocks.deleteBlobObjects
      .mockResolvedValueOnce({
        attempted: 1,
        deleted: 0,
        alreadyMissing: 0,
        failed: 1,
        skipped: 0,
      })
      .mockResolvedValueOnce({
        attempted: 1,
        deleted: 1,
        alreadyMissing: 0,
        failed: 0,
        skipped: 0,
      });
    const { GET } = await import("@/app/api/cron/cleanup/route");

    const response = await GET(
      new Request("http://localhost/api/cron/cleanup", {
        headers: { "x-cron-secret": "cron-secret" },
      })
    );
    const data = (await response.json()) as {
      ok: boolean;
      error: string;
      audioObjects: { failed: number };
      attachmentObjects: { failed: number };
    };

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(data).toMatchObject({
      ok: false,
      error: expect.stringContaining("deferred for retry"),
      audioObjects: { failed: 1 },
      attachmentObjects: { failed: 0 },
    });
    expect(JSON.stringify(data)).not.toContain("student");
    expect(mocks.hardDeleteSoftDeletedBefore).not.toHaveBeenCalled();
  });
});

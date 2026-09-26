import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ head: vi.fn(), get: vi.fn(), reserve: vi.fn() }));
vi.mock("@vercel/blob", () => ({ head: mocks.head, get: mocks.get, issueSignedToken: vi.fn(), presignUrl: vi.fn() }));
vi.mock("@/lib/db", () => ({ reserveVideoResources: mocks.reserve }));
vi.mock("@/lib/audio-blob", () => ({ getPrivateBlobCommandOptions: () => ({ storeId: "test" }) }));
import { streamVideo, videoByteRange, verifyVideoUpload } from "@/lib/video-storage";

describe("private video storage", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.reserve.mockResolvedValue(true);
    mocks.head.mockResolvedValue({ pathname: "videos/test.webm", contentType: "video/webm", size: 2000 });
  });
  it.each(["bytes=1-0", "bytes=2000-", "bytes=-0", "bytes=0-2,4-6", "anything", "bytes=-"])("rejects invalid range %s", header => {
    expect(videoByteRange(header, 2000)).toBeNull();
  });
  it("handles suffix and open-ended ranges", () => {
    expect(videoByteRange("bytes=-100", 2000)).toEqual({ start: 1900, end: 1999, partial: true });
    expect(videoByteRange("bytes=100-", 2000)).toEqual({ start: 100, end: 1999, partial: true });
  });
  it("stops before storage access when the request budget is exhausted", async () => {
    mocks.reserve.mockResolvedValue(false);
    await expect(streamVideo(new Request("https://example.com/video"), "videos/test.webm", "teacher@example.com")).rejects.toMatchObject({ status: 429 });
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("streams ranges without exposing signed storage URLs", async () => {
    mocks.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(100)); c.close(); } }),
      headers: new Headers({ "content-range": "bytes 0-99/2000" }) });
    const response = await streamVideo(new Request("https://example.com/video", { headers: { range: "bytes=0-99" } }), "videos/test.webm", "teacher@example.com");
    expect(response.status).toBe(206); expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.arrayBuffer()).byteLength).toBe(100);
    expect(mocks.reserve).toHaveBeenLastCalledWith(expect.objectContaining({ bytes: 2000, requests: 0 }));
  });
  it("refuses oversized or mismatched objects before downloading", async () => {
    mocks.head.mockResolvedValue({ pathname: "videos/test.webm", contentType: "text/html", size: 2000 });
    await expect(verifyVideoUpload("videos/test.webm", 120, "teacher@example.com")).rejects.toMatchObject({ status: 400 });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

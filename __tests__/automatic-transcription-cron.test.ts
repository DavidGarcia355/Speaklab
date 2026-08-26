import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  processJobs: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/lib/ai/automatic-transcription", () => ({
  processAutomaticTranscriptionJobs: mocks.processJobs,
}));
vi.mock("@/lib/http", () => ({
  withApiHandler: async (_request: Request, handler: () => Promise<Response>) => handler(),
}));

import { GET } from "@/app/api/cron/automatic-transcription/route";

describe("automatic transcription cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnv.mockReturnValue({ cronSecret: "cron-secret" });
    mocks.processJobs.mockResolvedValue({
      claimed: 1,
      completed: 1,
      retried: 0,
      paused: 0,
      failed: 0,
      cancelled: 0,
    });
  });

  it("rejects missing or incorrect secrets before claiming student work", async () => {
    const missing = await GET(new Request("https://tryhabla.com/api/cron/automatic-transcription"));
    const incorrect = await GET(new Request("https://tryhabla.com/api/cron/automatic-transcription", {
      headers: { authorization: "Bearer wrong-secret" },
    }));

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(mocks.processJobs).not.toHaveBeenCalled();
  });

  it.each([
    ["authorization", "Bearer cron-secret"],
    ["x-cron-secret", "cron-secret"],
  ])("accepts an authorized scheduler request and returns a private summary", async (headerName, headerValue) => {
    const response = await GET(new Request(
      "https://tryhabla.com/api/cron/automatic-transcription",
      { headers: { [headerName]: headerValue } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.processJobs).toHaveBeenCalledWith({ limit: 2 });
    await expect(response.json()).resolves.toMatchObject({ claimed: 1, completed: 1 });
  });
});

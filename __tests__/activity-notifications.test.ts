import { afterEach, describe, expect, it, vi } from "vitest";
import { trackActivity } from "@/lib/activity";

vi.mock("@/lib/db", () => ({
  logActivityEvent: vi.fn().mockResolvedValue(undefined),
  findTeacherFunnelRowByEmail: vi.fn(),
}));

describe("legacy activity tracking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never performs request-path Discord delivery", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await trackActivity("teacher_upgraded", "private-teacher@example.com");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

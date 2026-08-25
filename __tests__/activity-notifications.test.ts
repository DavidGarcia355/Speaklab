import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyDiscordActivity, notifyDiscordFeedback } from "@/lib/activity";

vi.mock("@/lib/db", () => ({
  logActivityEvent: vi.fn().mockResolvedValue(undefined),
  findTeacherFunnelRowByEmail: vi.fn(),
}));

describe("Discord activity notifications", () => {
  const originalWebhook = process.env.DISCORD_WEBHOOK_URL;

  beforeEach(() => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook";
  });

  afterEach(() => {
    if (typeof originalWebhook === "undefined") delete process.env.DISCORD_WEBHOOK_URL;
    else process.env.DISCORD_WEBHOOK_URL = originalWebhook;
    vi.unstubAllGlobals();
  });

  it("never sends contact or account PII to Discord", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    notifyDiscordActivity("teacher_upgraded", "private-teacher@example.com");
    notifyDiscordFeedback({
      name: "Private Person",
      email: "private-contact@example.com",
      school: "Private School",
      role: "Teacher",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payloads = fetchMock.mock.calls.map((call) => String(call[1]?.body ?? "")).join(" ");
    expect(payloads).toContain("admin dashboard");
    expect(payloads).not.toContain("Private Person");
    expect(payloads).not.toContain("private-teacher@example.com");
    expect(payloads).not.toContain("private-contact@example.com");
    expect(payloads).not.toContain("Private School");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminEmail: vi.fn(),
  inspectTryHablaDiscordHq: vi.fn(),
  rebuildTryHablaDiscordHq: vi.fn(),
  sendTryHablaHqLaunchMessage: vi.fn(),
  verifyTryHablaDiscordHq: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdminEmail: mocks.requireAdminEmail }));
vi.mock("@/lib/admin-alerts/discord-bot", () => ({
  TRYHABLA_DISCORD_HQ_LAYOUT: [{ name: "📈 LIVE", channels: [] }],
  discordBotErrorStatus: () => null,
  inspectTryHablaDiscordHq: mocks.inspectTryHablaDiscordHq,
  rebuildTryHablaDiscordHq: mocks.rebuildTryHablaDiscordHq,
  sendTryHablaHqLaunchMessage: mocks.sendTryHablaHqLaunchMessage,
  verifyTryHablaDiscordHq: mocks.verifyTryHablaDiscordHq,
}));

describe("Discord HQ admin route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.requireAdminEmail.mockReset().mockResolvedValue({
      allowed: true,
      email: "founder@tryhabla.com",
    });
    mocks.inspectTryHablaDiscordHq.mockReset().mockResolvedValue({ configured: false });
    mocks.rebuildTryHablaDiscordHq.mockReset().mockResolvedValue({ createdChannels: [] });
    mocks.sendTryHablaHqLaunchMessage.mockReset().mockResolvedValue({ channelName: "company-log" });
    mocks.verifyTryHablaDiscordHq.mockReset().mockResolvedValue({ verifiedChannels: [] });
  });

  it("requires an authenticated TryHabla admin", async () => {
    mocks.requireAdminEmail.mockResolvedValue({ allowed: false, email: "" });
    const { GET } = await import("@/app/api/admin/discord-hq/route");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.inspectTryHablaDiscordHq).not.toHaveBeenCalled();
  });

  it("reports the non-secret HQ connection and layout status", async () => {
    const { GET } = await import("@/app/api/admin/discord-hq/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: { configured: false },
    });
  });

  it("requires same-origin, action-specific confirmation before rebuilding", async () => {
    const { POST } = await import("@/app/api/admin/discord-hq/route");
    const wrongOrigin = await POST(new Request("https://tryhabla.com/api/admin/discord-hq", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ action: "rebuild", confirmation: "REBUILD_TRYHABLA_HQ" }),
    }));
    const wrongConfirmation = await POST(new Request("https://tryhabla.com/api/admin/discord-hq", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://tryhabla.com" },
      body: JSON.stringify({ action: "rebuild", confirmation: "yes" }),
    }));

    expect(wrongOrigin.status).toBe(403);
    expect(wrongConfirmation.status).toBe(400);
    expect(mocks.rebuildTryHablaDiscordHq).not.toHaveBeenCalled();
  });

  it("executes the explicit rebuild and keeps other controls separate", async () => {
    const { POST } = await import("@/app/api/admin/discord-hq/route");
    const response = await POST(new Request("https://tryhabla.com/api/admin/discord-hq", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://tryhabla.com" },
      body: JSON.stringify({
        action: "rebuild",
        confirmation: "REBUILD_TRYHABLA_HQ",
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.rebuildTryHablaDiscordHq).toHaveBeenCalledTimes(1);
    expect(mocks.verifyTryHablaDiscordHq).not.toHaveBeenCalled();
    expect(mocks.sendTryHablaHqLaunchMessage).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TRYHABLA_DISCORD_HQ_LAYOUT,
  discordBotErrorStatus,
  getDiscordHqChannelName,
  rebuildTryHablaDiscordHq,
} from "@/lib/admin-alerts/discord-bot";

const originalBotToken = process.env.DISCORD_BOT_TOKEN;
const originalGuildId = process.env.DISCORD_GUILD_ID;
const GUILD_ID = "123456789012345678";

afterEach(() => {
  vi.restoreAllMocks();
  if (originalBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
  else process.env.DISCORD_BOT_TOKEN = originalBotToken;
  if (originalGuildId === undefined) delete process.env.DISCORD_GUILD_ID;
  else process.env.DISCORD_GUILD_ID = originalGuildId;
});

describe("TryHabla Discord HQ", () => {
  it("defines the exact founder HQ hierarchy and event routing", () => {
    expect(TRYHABLA_DISCORD_HQ_LAYOUT.map((category) => ({
      name: category.name,
      channels: category.channels.map((channel) => channel.name),
    }))).toEqual([
      { name: "📈 LIVE", channels: ["habla-pulse", "revenue", "milestones", "scoreboard"] },
      { name: "💼 GROWTH", channels: ["sales-leads", "marketing"] },
      { name: "🧠 BUILD", channels: ["product-ideas", "dev-shipping"] },
      { name: "🛠 OPS", channels: ["incidents", "system-health"] },
      { name: "🏢 HQ", channels: ["founder-chat", "company-log"] },
    ]);
    expect(getDiscordHqChannelName("traction", "teacher.signed_up")).toBe("habla-pulse");
    expect(getDiscordHqChannelName("revenue", "school.lead")).toBe("sales-leads");
    expect(getDiscordHqChannelName("traction", "release.deployed")).toBe("dev-shipping");
    expect(getDiscordHqChannelName("incidents", "incident")).toBe("incidents");
  });

  it("deletes old channels child-first and recreates only the HQ layout", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token-that-is-long-enough-for-tests";
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let createdId = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ method, path: url.pathname, body });
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bot bot-token-that-is-long-enough-for-tests",
      );

      if (method === "GET" && url.pathname === `/api/v10/guilds/${GUILD_ID}`) {
        return Response.json({ id: GUILD_ID, name: "TryHabla" });
      }
      if (method === "GET" && url.pathname === `/api/v10/guilds/${GUILD_ID}/channels`) {
        return Response.json([
          { id: "old-category", name: "OLD", type: 4 },
          { id: "old-text", name: "general", type: 0, parent_id: "old-category" },
        ]);
      }
      if (method === "DELETE" && url.pathname.startsWith("/api/v10/channels/")) {
        return new Response(null, { status: 204 });
      }
      if (method === "POST" && url.pathname === `/api/v10/guilds/${GUILD_ID}/channels`) {
        createdId += 1;
        return Response.json({ id: `created-${createdId}`, ...body });
      }
      throw new Error(`Unexpected Discord request: ${method} ${url.pathname}`);
    });

    const result = await rebuildTryHablaDiscordHq(fetchMock);

    const deleteCalls = calls.filter((call) => call.method === "DELETE");
    expect(deleteCalls.map((call) => call.path)).toEqual([
      "/api/v10/channels/old-text",
      "/api/v10/channels/old-category",
    ]);
    const createCalls = calls.filter((call) => call.method === "POST");
    expect(createCalls.filter((call) => call.body?.type === 4)).toHaveLength(5);
    expect(createCalls.filter((call) => call.body?.type === 0)).toHaveLength(12);
    expect(result.createdChannels).toHaveLength(12);
    expect(calls.findIndex((call) => call.method === "POST")).toBeGreaterThan(
      calls.map((call) => call.method).lastIndexOf("DELETE"),
    );
  });

  it("refuses to manage an explicitly configured non-TryHabla server", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-token-that-is-long-enough-for-tests";
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: GUILD_ID, name: "Personal Server" }),
    );

    const error = await rebuildTryHablaDiscordHq(fetchMock).catch((caught) => caught);
    expect(error).toMatchObject({ message: "discord_guild_mismatch" });
    expect(discordBotErrorStatus(error)).toMatchObject({
      status: 409,
      code: "discord_guild_mismatch",
    });
  });
});

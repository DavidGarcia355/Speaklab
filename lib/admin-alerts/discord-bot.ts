import "server-only";

import type { AdminAlertDestination } from "@/lib/db";
import type { DiscordWebhookPayload } from "@/lib/admin-alerts/format";

const DISCORD_API = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 5_000;

const CHANNELS: Record<AdminAlertDestination, { name: string; category: string; topic: string }> = {
  traction: {
    name: "habla-pulse",
    category: "📈 LIVE",
    topic: "Teacher signups, activations, first classes, assignments, recordings, and AI wins.",
  },
  revenue: {
    name: "revenue",
    category: "📈 LIVE",
    topic: "Paid teachers, renewals, payment events, limits, and school-plan intent.",
  },
  milestones: {
    name: "milestones",
    category: "📈 LIVE",
    topic: "TryHabla achievements and company milestones.",
  },
  pulse: {
    name: "scoreboard",
    category: "📈 LIVE",
    topic: "Daily and weekly founder scoreboard for TryHabla.",
  },
  incidents: {
    name: "incidents",
    category: "🛠 OPS",
    topic: "Only things that actually need founder attention.",
  },
};

const EXTRA_CHANNELS = [
  {
    name: "product-ideas",
    category: "🧠 BUILD",
    topic: "Dump product ideas here from your phone. Keep the founder brain out of Notes.",
  },
  {
    name: "sales-leads",
    category: "💼 GROWTH",
    topic: "School and department opportunities worth following up on.",
  },
] as const;

type DiscordGuild = { id: string; name: string };
type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
};

class DiscordBotError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status = 500, retryAfterMs?: number) {
    super(message);
    this.name = "DiscordBotError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function token(source: NodeJS.ProcessEnv = process.env) {
  return source.DISCORD_BOT_TOKEN?.trim() || "";
}

function configuredGuildId(source: NodeJS.ProcessEnv = process.env) {
  const value = source.DISCORD_GUILD_ID?.trim() || "";
  return /^\d{16,32}$/.test(value) ? value : "";
}

export function isDiscordBotDeliveryConfigured(source: NodeJS.ProcessEnv = process.env) {
  return token(source).length > 20;
}

function normalizedGuildName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function discordFetch(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  botToken: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${DISCORD_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bot ${botToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (response.ok) return response;
    let retryAfterMs: number | undefined;
    if (response.status === 429) {
      try {
        const payload = await response.clone().json() as { retry_after?: unknown };
        const seconds = Number(payload.retry_after);
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1_000);
      } catch {
        // Header fallback below.
      }
      if (retryAfterMs === undefined) {
        const seconds = Number(response.headers.get("retry-after"));
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1_000);
      }
    }
    throw new DiscordBotError("discord_bot_request_failed", response.status, retryAfterMs);
  } catch (error) {
    if (error instanceof DiscordBotError) throw error;
    throw new DiscordBotError(
      controller.signal.aborted ? "discord_bot_timeout" : "discord_bot_network_error",
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveGuildId(fetchImpl: typeof fetch, botToken: string) {
  const explicit = configuredGuildId();
  if (explicit) return explicit;

  const response = await discordFetch("/users/@me/guilds", { method: "GET" }, fetchImpl, botToken);
  const guilds = await response.json() as DiscordGuild[];
  const tryHablaGuilds = guilds.filter((guild) => normalizedGuildName(guild.name) === "tryhabla");
  if (tryHablaGuilds.length === 1) return tryHablaGuilds[0]!.id;
  if (guilds.length === 1) return guilds[0]!.id;
  throw new DiscordBotError("discord_guild_ambiguous", 409);
}

async function listGuildChannels(fetchImpl: typeof fetch, botToken: string, guildId: string) {
  const response = await discordFetch(`/guilds/${guildId}/channels`, { method: "GET" }, fetchImpl, botToken);
  return await response.json() as DiscordChannel[];
}

async function createGuildChannel(
  fetchImpl: typeof fetch,
  botToken: string,
  guildId: string,
  body: Record<string, unknown>,
) {
  const response = await discordFetch(
    `/guilds/${guildId}/channels`,
    { method: "POST", body: JSON.stringify(body) },
    fetchImpl,
    botToken,
  );
  return await response.json() as DiscordChannel;
}

async function ensureCategory(
  channels: DiscordChannel[],
  name: string,
  fetchImpl: typeof fetch,
  botToken: string,
  guildId: string,
) {
  const existing = channels.find((channel) => channel.type === 4 && channel.name === name);
  if (existing) return existing;
  const created = await createGuildChannel(fetchImpl, botToken, guildId, { name, type: 4 });
  channels.push(created);
  return created;
}

async function ensureTextChannel(
  channels: DiscordChannel[],
  spec: { name: string; category: string; topic: string },
  fetchImpl: typeof fetch,
  botToken: string,
  guildId: string,
) {
  const existing = channels.find((channel) => channel.type === 0 && channel.name === spec.name);
  if (existing) return existing;
  const category = await ensureCategory(channels, spec.category, fetchImpl, botToken, guildId);
  const created = await createGuildChannel(fetchImpl, botToken, guildId, {
    name: spec.name,
    type: 0,
    parent_id: category.id,
    topic: spec.topic,
  });
  channels.push(created);
  return created;
}

export async function ensureTryHablaDiscordHq(fetchImpl: typeof fetch = fetch) {
  const botToken = token();
  if (!isDiscordBotDeliveryConfigured()) throw new DiscordBotError("discord_bot_missing", 503);
  const guildId = await resolveGuildId(fetchImpl, botToken);
  const channels = await listGuildChannels(fetchImpl, botToken, guildId);

  const specs = [
    ...Object.values(CHANNELS),
    ...EXTRA_CHANNELS,
  ];
  for (const spec of specs) {
    await ensureTextChannel(channels, spec, fetchImpl, botToken, guildId);
  }

  return {
    guildId,
    channelNames: specs.map((spec) => spec.name),
  };
}

export async function sendDiscordBotAlert(input: {
  destination: AdminAlertDestination;
  payload: DiscordWebhookPayload;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const botToken = token();
  if (!isDiscordBotDeliveryConfigured()) throw new DiscordBotError("discord_bot_missing", 503);

  // First real founder alert turns a blank server into the TryHabla HQ layout.
  await ensureTryHablaDiscordHq(fetchImpl);

  const guildId = await resolveGuildId(fetchImpl, botToken);
  const channels = await listGuildChannels(fetchImpl, botToken, guildId);
  const spec = CHANNELS[input.destination];
  const channel = await ensureTextChannel(channels, spec, fetchImpl, botToken, guildId);
  return discordFetch(
    `/channels/${channel.id}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        embeds: input.payload.embeds,
        allowed_mentions: input.payload.allowed_mentions,
      }),
    },
    fetchImpl,
    botToken,
  );
}

export function discordBotErrorStatus(error: unknown) {
  return error instanceof DiscordBotError
    ? { status: error.status, retryAfterMs: error.retryAfterMs, code: error.message }
    : null;
}

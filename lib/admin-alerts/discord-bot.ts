import "server-only";

import type { AdminAlertDestination } from "@/lib/db";
import type { DiscordWebhookPayload } from "@/lib/admin-alerts/format";

const DISCORD_API = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 8_000;
const TRYHABLA_GUILD_NAME = "tryhabla";

type HqChannelSpec = Readonly<{ name: string; topic: string }>;
type HqCategorySpec = Readonly<{
  name: string;
  channels: readonly HqChannelSpec[];
}>;

export const TRYHABLA_DISCORD_HQ_LAYOUT: readonly HqCategorySpec[] = [
  {
    name: "📈 LIVE",
    channels: [
      { name: "habla-pulse", topic: "Teacher signups, activations, first classes, assignments, recordings, and AI wins." },
      { name: "revenue", topic: "Paid subscriptions, renewals, failed payments, refunds, and recurring revenue wins." },
      { name: "milestones", topic: "Company achievements, MRR unlocks, and meaningful growth milestones." },
      { name: "scoreboard", topic: "Daily and weekly founder scoreboard for TryHabla." },
    ],
  },
  {
    name: "💼 GROWTH",
    channels: [
      { name: "sales-leads", topic: "School and department opportunities worth following up on." },
      { name: "marketing", topic: "Campaign planning, positioning, distribution, and growth experiments." },
    ],
  },
  {
    name: "🧠 BUILD",
    channels: [
      { name: "product-ideas", topic: "Founder product ideas, customer insight, and problems worth solving." },
      { name: "dev-shipping", topic: "Production deployments, releases, and meaningful product shipments." },
    ],
  },
  {
    name: "🛠 OPS",
    channels: [
      { name: "incidents", topic: "Critical TryHabla problems that require founder attention." },
      { name: "system-health", topic: "Operational checks, provider health, and infrastructure verification." },
    ],
  },
  {
    name: "🏢 HQ",
    channels: [
      { name: "founder-chat", topic: "Private founder command room for decisions and coordination." },
      { name: "company-log", topic: "Permanent record of major TryHabla company and HQ events." },
    ],
  },
] as const;

export type TryHablaHqChannelName =
  (typeof TRYHABLA_DISCORD_HQ_LAYOUT)[number]["channels"][number]["name"];

const DESTINATION_CHANNELS: Record<AdminAlertDestination, TryHablaHqChannelName> = {
  traction: "habla-pulse",
  revenue: "revenue",
  milestones: "milestones",
  pulse: "scoreboard",
  incidents: "incidents",
};

const EVENT_CHANNEL_OVERRIDES: Readonly<Record<string, TryHablaHqChannelName>> = {
  "school.lead": "sales-leads",
  "release.deployed": "dev-shipping",
};

export function getDiscordHqChannelName(
  destination: AdminAlertDestination,
  eventType?: string,
): TryHablaHqChannelName {
  return (eventType && EVENT_CHANNEL_OVERRIDES[eventType]) || DESTINATION_CHANNELS[destination];
}

type DiscordGuild = { id: string; name: string };
type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  position?: number;
  topic?: string | null;
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

async function resolveGuild(fetchImpl: typeof fetch, botToken: string): Promise<DiscordGuild> {
  const explicit = configuredGuildId();
  if (explicit) {
    const response = await discordFetch(`/guilds/${explicit}`, { method: "GET" }, fetchImpl, botToken);
    const guild = await response.json() as DiscordGuild;
    if (normalizedGuildName(guild.name) !== TRYHABLA_GUILD_NAME) {
      throw new DiscordBotError("discord_guild_mismatch", 409);
    }
    return guild;
  }

  const response = await discordFetch("/users/@me/guilds", { method: "GET" }, fetchImpl, botToken);
  const guilds = await response.json() as DiscordGuild[];
  const matches = guilds.filter(
    (guild) => normalizedGuildName(guild.name) === TRYHABLA_GUILD_NAME,
  );
  if (matches.length === 1) return matches[0]!;
  throw new DiscordBotError("discord_guild_ambiguous", 409);
}

async function listGuildChannels(fetchImpl: typeof fetch, botToken: string, guildId: string) {
  const response = await discordFetch(
    `/guilds/${guildId}/channels`,
    { method: "GET" },
    fetchImpl,
    botToken,
  );
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

async function updateGuildChannel(
  fetchImpl: typeof fetch,
  botToken: string,
  channelId: string,
  body: Record<string, unknown>,
) {
  const response = await discordFetch(
    `/channels/${channelId}`,
    { method: "PATCH", body: JSON.stringify(body) },
    fetchImpl,
    botToken,
  );
  return await response.json() as DiscordChannel;
}

async function deleteGuildChannel(
  fetchImpl: typeof fetch,
  botToken: string,
  channelId: string,
) {
  await discordFetch(`/channels/${channelId}`, { method: "DELETE" }, fetchImpl, botToken);
}

async function ensureCategory(
  channels: DiscordChannel[],
  spec: HqCategorySpec,
  position: number,
  fetchImpl: typeof fetch,
  botToken: string,
  guildId: string,
) {
  const existing = channels.find((channel) => channel.type === 4 && channel.name === spec.name);
  if (existing) return existing;
  const created = await createGuildChannel(fetchImpl, botToken, guildId, {
    name: spec.name,
    type: 4,
    position,
  });
  channels.push(created);
  return created;
}

async function ensureTextChannel(
  channels: DiscordChannel[],
  spec: HqChannelSpec,
  category: DiscordChannel,
  position: number,
  fetchImpl: typeof fetch,
  botToken: string,
  guildId: string,
) {
  const existing = channels.find((channel) => channel.type === 0 && channel.name === spec.name);
  if (existing) {
    if (
      existing.parent_id !== category.id
      || existing.topic !== spec.topic
    ) {
      const updated = await updateGuildChannel(fetchImpl, botToken, existing.id, {
        parent_id: category.id,
        topic: spec.topic,
      });
      Object.assign(existing, updated);
    }
    return existing;
  }
  const created = await createGuildChannel(fetchImpl, botToken, guildId, {
    name: spec.name,
    type: 0,
    parent_id: category.id,
    position,
    topic: spec.topic,
  });
  channels.push(created);
  return created;
}

async function ensureLayout(
  channels: DiscordChannel[],
  fetchImpl: typeof fetch,
  botToken: string,
  guildId: string,
) {
  for (const [categoryPosition, categorySpec] of TRYHABLA_DISCORD_HQ_LAYOUT.entries()) {
    const category = await ensureCategory(
      channels,
      categorySpec,
      categoryPosition,
      fetchImpl,
      botToken,
      guildId,
    );
    for (const [channelPosition, channelSpec] of categorySpec.channels.entries()) {
      await ensureTextChannel(
        channels,
        channelSpec,
        category,
        channelPosition,
        fetchImpl,
        botToken,
        guildId,
      );
    }
  }
}

function desiredChannelNames() {
  return TRYHABLA_DISCORD_HQ_LAYOUT.flatMap((category) =>
    category.channels.map((channel) => channel.name)
  );
}

export async function inspectTryHablaDiscordHq(fetchImpl: typeof fetch = fetch) {
  const botToken = token();
  if (!isDiscordBotDeliveryConfigured()) {
    return {
      configured: false,
      guildId: null,
      presentChannels: [] as string[],
      missingChannels: desiredChannelNames(),
      obsoleteChannels: [] as string[],
    };
  }
  const guild = await resolveGuild(fetchImpl, botToken);
  const channels = await listGuildChannels(fetchImpl, botToken, guild.id);
  const desiredNames = new Set([
    ...TRYHABLA_DISCORD_HQ_LAYOUT.map((category) => category.name),
    ...desiredChannelNames(),
  ]);
  const presentChannels = channels
    .filter((channel) => channel.type === 0 && desiredNames.has(channel.name))
    .map((channel) => channel.name);
  return {
    configured: true,
    guildId: guild.id,
    guildName: guild.name,
    presentChannels,
    missingChannels: desiredChannelNames().filter((name) => !presentChannels.includes(name)),
    obsoleteChannels: channels
      .filter((channel) => !desiredNames.has(channel.name))
      .map((channel) => channel.name),
  };
}

export async function ensureTryHablaDiscordHq(fetchImpl: typeof fetch = fetch) {
  const botToken = token();
  if (!isDiscordBotDeliveryConfigured()) throw new DiscordBotError("discord_bot_missing", 503);
  const guild = await resolveGuild(fetchImpl, botToken);
  const channels = await listGuildChannels(fetchImpl, botToken, guild.id);
  await ensureLayout(channels, fetchImpl, botToken, guild.id);
  return { guildId: guild.id, channelNames: desiredChannelNames() };
}

export async function rebuildTryHablaDiscordHq(fetchImpl: typeof fetch = fetch) {
  const botToken = token();
  if (!isDiscordBotDeliveryConfigured()) throw new DiscordBotError("discord_bot_missing", 503);
  const guild = await resolveGuild(fetchImpl, botToken);
  const existing = await listGuildChannels(fetchImpl, botToken, guild.id);
  const deletionOrder = [...existing].sort((left, right) =>
    Number(left.type === 4) - Number(right.type === 4)
  );
  for (const channel of deletionOrder) {
    await deleteGuildChannel(fetchImpl, botToken, channel.id);
  }

  const created: DiscordChannel[] = [];
  await ensureLayout(created, fetchImpl, botToken, guild.id);
  return {
    guildId: guild.id,
    deletedChannels: deletionOrder.map((channel) => channel.name),
    createdChannels: desiredChannelNames(),
  };
}

async function findHqTextChannel(
  channelName: TryHablaHqChannelName,
  fetchImpl: typeof fetch,
  botToken: string,
  guildId: string,
) {
  const channels = await listGuildChannels(fetchImpl, botToken, guildId);
  const channel = channels.find(
    (candidate) => candidate.type === 0 && candidate.name === channelName,
  );
  if (!channel) throw new DiscordBotError("discord_channel_missing", 404);
  return channel;
}

async function postHqMessage(input: {
  channelName: TryHablaHqChannelName;
  body: Record<string, unknown>;
  fetchImpl: typeof fetch;
  botToken: string;
  guildId: string;
}) {
  const channel = await findHqTextChannel(
    input.channelName,
    input.fetchImpl,
    input.botToken,
    input.guildId,
  );
  const response = await discordFetch(
    `/channels/${channel.id}/messages`,
    { method: "POST", body: JSON.stringify(input.body) },
    input.fetchImpl,
    input.botToken,
  );
  const message = await response.json() as { id?: unknown };
  return { channelName: input.channelName, messageId: String(message.id || "") };
}

export async function sendDiscordBotAlert(input: {
  destination: AdminAlertDestination;
  eventType?: string;
  payload: DiscordWebhookPayload;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const botToken = token();
  if (!isDiscordBotDeliveryConfigured()) throw new DiscordBotError("discord_bot_missing", 503);
  const ensured = await ensureTryHablaDiscordHq(fetchImpl);
  return postHqMessage({
    channelName: getDiscordHqChannelName(input.destination, input.eventType),
    body: {
      ...(input.payload.content ? { content: input.payload.content } : {}),
      embeds: input.payload.embeds,
      allowed_mentions: input.payload.allowed_mentions,
    },
    fetchImpl,
    botToken,
    guildId: ensured.guildId,
  });
}

function controlEmbed(title: string, description: string, color: number) {
  return {
    title,
    description,
    color,
    footer: { text: "TryHabla Founder HQ" },
    timestamp: new Date().toISOString(),
  };
}

export async function sendTryHablaHqLaunchMessage(fetchImpl: typeof fetch = fetch) {
  const botToken = token();
  if (!isDiscordBotDeliveryConfigured()) throw new DiscordBotError("discord_bot_missing", 503);
  const ensured = await ensureTryHablaDiscordHq(fetchImpl);
  return postHqMessage({
    channelName: "company-log",
    body: {
      content: "🎮 **TRYHABLA HQ ONLINE**",
      embeds: [controlEmbed(
        "Founder command center connected",
        "Real product, growth, revenue, milestone, scoreboard, and incident signals are now routed through Habla Pulse.",
        0xf97316,
      )],
      allowed_mentions: { parse: [] },
    },
    fetchImpl,
    botToken,
    guildId: ensured.guildId,
  });
}

export async function verifyTryHablaDiscordHq(fetchImpl: typeof fetch = fetch) {
  const botToken = token();
  if (!isDiscordBotDeliveryConfigured()) throw new DiscordBotError("discord_bot_missing", 503);
  const ensured = await ensureTryHablaDiscordHq(fetchImpl);
  const results = [];
  for (const category of TRYHABLA_DISCORD_HQ_LAYOUT) {
    for (const channel of category.channels) {
      results.push(await postHqMessage({
        channelName: channel.name,
        body: {
          embeds: [controlEmbed(
            `✅ #${channel.name} connected`,
            "HQ routing verification passed. This is a controlled test message, not a production business event.",
            0x22c55e,
          )],
          allowed_mentions: { parse: [] },
        },
        fetchImpl,
        botToken,
        guildId: ensured.guildId,
      }));
    }
  }
  return { verifiedChannels: results };
}

export function discordBotErrorStatus(error: unknown) {
  return error instanceof DiscordBotError
    ? { status: error.status, retryAfterMs: error.retryAfterMs, code: error.message }
    : null;
}

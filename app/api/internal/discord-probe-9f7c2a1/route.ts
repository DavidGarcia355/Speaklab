import { NextResponse } from "next/server";
import {
  isAdminAlertDeliveryEnabled,
  resolveAdminAlertsEnvironment,
  resolveDiscordWebhookUrl,
} from "@/lib/admin-alerts/config";
import {
  ensureTryHablaDiscordHq,
  isDiscordBotDeliveryConfigured,
} from "@/lib/admin-alerts/discord-bot";

export const runtime = "nodejs";

const PROBE_KEY = "hqp_7dc4c5f2b18f4fa1";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== PROBE_KEY) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const environment = resolveAdminAlertsEnvironment();
  const enabled = isAdminAlertDeliveryEnabled();
  const bot = isDiscordBotDeliveryConfigured();

  if (bot) {
    try {
      const hq = await ensureTryHablaDiscordHq();
      return NextResponse.json({ ok: true, mode: "bot", enabled, environment, hq });
    } catch {
      return NextResponse.json({ ok: false, mode: "bot", enabled, environment }, { status: 502 });
    }
  }

  try {
    const webhook = resolveDiscordWebhookUrl("traction", environment);
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "Habla Pulse",
        avatar_url: "https://tryhabla.com/tryhabla-auth-logo.svg",
        allowed_mentions: { parse: [] },
        embeds: [{
          title: "🎮 TRYHABLA HQ ONLINE",
          description: "Habla Pulse is connected. Founder mode is waking up.",
          color: 0xf97316,
          fields: [
            { name: "Status", value: "Live", inline: true },
            { name: "Next", value: "Signups, activations, revenue, milestones", inline: true },
          ],
          footer: { text: "TryHabla HQ" },
          timestamp: new Date().toISOString(),
        }],
      }),
      cache: "no-store",
      redirect: "error",
    });
    return NextResponse.json({
      ok: response.ok,
      mode: "webhook",
      enabled,
      environment,
      discordStatus: response.status,
    }, { status: response.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false, mode: "none", enabled, environment }, { status: 503 });
  }
}

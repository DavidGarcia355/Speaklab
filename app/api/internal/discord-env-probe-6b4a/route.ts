import { NextResponse } from "next/server";

export const runtime = "nodejs";

const KEY = "dprobe_6b4a_9c31";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== KEY) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const names = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_APPLICATION_ID",
    "DISCORD_GUILD_ID",
    "DISCORD_ADMIN_WEBHOOK_URL",
    "DISCORD_WEBHOOK_URL",
    "DISCORD_TRACTION_WEBHOOK_URL",
    "DISCORD_REVENUE_WEBHOOK_URL",
    "DISCORD_MILESTONES_WEBHOOK_URL",
    "DISCORD_PULSE_WEBHOOK_URL",
    "DISCORD_INCIDENTS_WEBHOOK_URL",
  ] as const;

  return NextResponse.json({
    ok: true,
    present: Object.fromEntries(names.map((name) => [name, Boolean(process.env[name]?.trim())])),
  });
}

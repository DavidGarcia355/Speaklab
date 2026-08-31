import { NextResponse } from "next/server";

import { requireAdminEmail } from "@/lib/admin";
import {
  TRYHABLA_DISCORD_HQ_LAYOUT,
  discordBotErrorStatus,
  inspectTryHablaDiscordHq,
  rebuildTryHablaDiscordHq,
  sendTryHablaHqLaunchMessage,
  verifyTryHablaDiscordHq,
} from "@/lib/admin-alerts/discord-bot";

export const runtime = "nodejs";

async function requireAdmin() {
  const admin = await requireAdminEmail();
  if (!admin.allowed) {
    return {
      admin,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { admin, response: null };
}

function invalidOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

function hqError(error: unknown) {
  const botError = discordBotErrorStatus(error);
  if (botError) {
    const status = botError.status >= 400 && botError.status < 600
      ? botError.status
      : 503;
    return NextResponse.json(
      { error: "Discord HQ operation failed.", code: botError.code },
      { status },
    );
  }
  console.error("Discord HQ operation failed", { code: "discord_hq_operation_failed" });
  return NextResponse.json(
    { error: "Discord HQ operation failed.", code: "discord_hq_operation_failed" },
    { status: 503 },
  );
}

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const status = await inspectTryHablaDiscordHq();
    return NextResponse.json({
      ok: true,
      layout: TRYHABLA_DISCORD_HQ_LAYOUT,
      status,
    });
  } catch (error) {
    return hqError(error);
  }
}

export async function POST(request: Request) {
  const { admin, response } = await requireAdmin();
  if (response) return response;
  if (invalidOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let body: { action?: unknown; confirmation?: unknown };
  try {
    body = await request.json() as { action?: unknown; confirmation?: unknown };
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";
  const expectedConfirmation = {
    rebuild: "REBUILD_TRYHABLA_HQ",
    verify: "VERIFY_TRYHABLA_HQ",
    launch: "LAUNCH_TRYHABLA_HQ",
  }[action];
  if (!expectedConfirmation || confirmation !== expectedConfirmation) {
    return NextResponse.json({ error: "Discord HQ confirmation did not match." }, { status: 400 });
  }

  try {
    const result = action === "rebuild"
      ? await rebuildTryHablaDiscordHq()
      : action === "verify"
        ? await verifyTryHablaDiscordHq()
        : await sendTryHablaHqLaunchMessage();
    console.info("Discord HQ operation completed", {
      action,
      adminEmail: admin.email,
    });
    return NextResponse.json({ ok: true, action, result });
  } catch (error) {
    return hqError(error);
  }
}

import { NextResponse } from "next/server";

import { requireAdminEmail } from "@/lib/admin";
import {
  getWelcomeBackCampaignPreview,
  sendWelcomeBackCampaign,
} from "@/lib/marketing-email";

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

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    const preview = await getWelcomeBackCampaignPreview();
    return NextResponse.json(preview);
  } catch (error) {
    console.error("Failed to preview welcome-back campaign", error);
    return NextResponse.json({ error: "Unable to load campaign preview." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { admin, response } = await requireAdmin();
  if (response) return response;

  try {
    const body = (await request.json()) as { confirmation?: unknown };
    if (body.confirmation !== "SEND_WELCOME_BACK_2026") {
      return NextResponse.json({ error: "Campaign confirmation did not match." }, { status: 400 });
    }

    const result = await sendWelcomeBackCampaign();
    console.info("Welcome-back campaign sent", {
      adminEmail: admin.email,
      recipientCount: result.recipientCount,
      batchCount: result.batchCount,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Failed to send welcome-back campaign", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send campaign." },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import {
  isReasonableEmail,
  unsubscribeMarketingEmail,
} from "@/lib/marketing-unsubscribe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email : "";

    if (!isReasonableEmail(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    await unsubscribeMarketingEmail(email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Marketing unsubscribe failed", error);
    return NextResponse.json(
      { error: "We couldn't process that request. Please try again." },
      { status: 500 }
    );
  }
}

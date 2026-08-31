import { NextResponse } from "next/server";

import {
  unsubscribeMarketingEmail,
  verifyMarketingUnsubscribeToken,
} from "@/lib/marketing-unsubscribe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const email = url.searchParams.get("email") || "";
    const token = url.searchParams.get("token") || "";

    if (!verifyMarketingUnsubscribeToken(email, token)) {
      return NextResponse.json({ error: "Invalid unsubscribe link." }, { status: 400 });
    }

    let browserConfirmation = false;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      browserConfirmation = form.get("source") === "browser";
    }

    await unsubscribeMarketingEmail(email);

    if (browserConfirmation) {
      return NextResponse.redirect(new URL("/unsubscribe?status=done", request.url), 303);
    }

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Marketing unsubscribe failed", error);
    return NextResponse.json(
      { error: "We couldn't process that request. Please try again." },
      { status: 500 }
    );
  }
}

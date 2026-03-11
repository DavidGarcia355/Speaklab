import { NextResponse } from "next/server";
import { createFeedbackMessage } from "@/lib/db";
import { getClientIp, withApiHandler } from "@/lib/http";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { feedbackCreateSchema, parseOrThrow400 } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    await enforceAuthRateLimit(`feedback:${getClientIp(request)}`);
    const body = parseOrThrow400(feedbackCreateSchema, await request.json());
    const item = await createFeedbackMessage({
      name: body.name ?? "",
      email: body.email,
      school: body.school ?? "",
      role: body.role ?? "",
      message: body.message ?? "",
    });
    return NextResponse.json({ item }, { status: 201 });
  });
}

import { NextResponse } from "next/server";
import { enqueueSchoolLeadAlert } from "@/lib/admin-alert-lifecycle";
import { createFeedbackMessage } from "@/lib/db";
import { sendFeedbackNotification } from "@/lib/email";
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
    void sendFeedbackNotification({
      name: body.name ?? "",
      email: body.email,
      school: body.school ?? "",
      role: body.role ?? "",
      message: body.message ?? "",
    });
    if (body.intent === "schools" || body.intent === "school-pilot") {
      await enqueueSchoolLeadAlert({
        feedbackId: item.id,
      });
    }
    return NextResponse.json({ item }, { status: 201 });
  });
}

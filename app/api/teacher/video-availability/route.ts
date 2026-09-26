import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { getAiReviewAllowanceSummary, getVideoUsageSummary } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { isVideoTeacherApproved, videoAiEnabled, videoFeatureEnabled } from "@/lib/video-policy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const email = await requireTeacherEmail();
    const approved = videoFeatureEnabled() && isVideoTeacherApproved(email);
    const allowance = approved ? await getAiReviewAllowanceSummary({ teacherEmail: email }) : null;
    const enabled = approved && allowance?.status === "teacher_period";
    const usage = enabled ? await getVideoUsageSummary(email) : null;
    return NextResponse.json({ enabled, aiEnabled: enabled && videoAiEnabled(), usage,
      monthlyLimit: 200, maxBytes: 20 * 1024 * 1024 });
  });
}

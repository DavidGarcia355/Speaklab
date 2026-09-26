import "server-only";
import { getAiReviewAllowanceSummary } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { isVideoTeacherApproved, videoAiEnabled, videoFeatureEnabled } from "@/lib/video-policy";

export async function assertVideoAssignmentAllowed(input: {
  teacherEmail: string;
  videoMode: "off" | "optional" | "required";
  autoGradeVideo: boolean;
}) {
  if (input.videoMode === "off") {
    if (input.autoGradeVideo) throw new HttpError(400, "Turn on video before automatic video grading.");
    return;
  }
  if (!videoFeatureEnabled()) throw new HttpError(503, "Video is awaiting school and provider privacy approval.");
  if (!isVideoTeacherApproved(input.teacherEmail)) {
    throw new HttpError(403, "This school's video authorization has not been recorded.");
  }
  const allowance = await getAiReviewAllowanceSummary({ teacherEmail: input.teacherEmail });
  if (allowance.status !== "teacher_period") {
    throw new HttpError(403, "Video requires an active $20 Teacher subscription.");
  }
  if (input.autoGradeVideo && !videoAiEnabled()) {
    throw new HttpError(503, "Automatic video grading is awaiting privacy approval.");
  }
}

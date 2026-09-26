import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { cancelVideoUpload, countStudentSubmissions, findAssignmentById, reserveVideoUpload } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { enforceSubmissionRateLimit } from "@/lib/rate-limit";
import { enforceStudentAssignmentAccessPolicy } from "@/lib/student-assignment-access";
import { submissionLimitReachedMessage } from "@/lib/submission-errors";
import { authorizeVideoPut } from "@/lib/video-storage";
import { VIDEO_MAX_BYTES, isVideoTeacherApproved, videoFeatureEnabled } from "@/lib/video-policy";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  return withApiHandler(request, async () => {
    if (!videoFeatureEnabled()) throw new HttpError(503, "Video is waiting for school privacy approval.");
    const { assignmentId } = await context.params;
    const assignment = await findAssignmentById(assignmentId);
    if (!assignment || assignment.videoMode === "off") throw new HttpError(404, "Video assignment not found.");
    if (!isVideoTeacherApproved(assignment.ownerEmail)) throw new HttpError(403, "Video is not approved for this school.");
    const studentEmail = await requireSchoolStudentEmail();
    await enforceStudentAssignmentAccessPolicy({ classId: assignment.classId,
      ownerEmail: assignment.ownerEmail, studentEmail });
    await enforceSubmissionRateLimit(studentEmail);
    if (assignment.maxSubmissions > 0 &&
        (await countStudentSubmissions(assignmentId, studentEmail)) >= assignment.maxSubmissions) {
      throw new HttpError(403, submissionLimitReachedMessage(assignment.maxSubmissions));
    }
    const parsed = z.object({
      contentType: z.enum(["video/webm", "video/mp4"]),
      uploadId: z.string().uuid(),
      size: z.number().int().min(1000).max(VIDEO_MAX_BYTES),
    }).safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "Video must be WebM or MP4 and at most 20 MB.");
    const reservation = await reserveVideoUpload({ assignmentId,
      teacherEmail: assignment.ownerEmail, studentEmail, contentType: parsed.data.contentType, uploadId: parsed.data.uploadId });
    if (!reservation) throw new HttpError(403, "The Teacher video allowance is unavailable or used up for this billing period.");
    let uploadUrl: string;
    try {
      uploadUrl = await authorizeVideoPut(reservation.pathname, parsed.data.contentType);
    } catch (error) {
      await cancelVideoUpload(reservation.id, studentEmail);
      throw error;
    }
    return NextResponse.json({ reservationId: reservation.id, uploadUrl });
  });
}

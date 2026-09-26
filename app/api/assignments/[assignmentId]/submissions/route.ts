import { NextResponse } from "next/server";
import { enqueueFirstRecordingReceivedAlert } from "@/lib/admin-alert-lifecycle";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { storeRecording } from "@/lib/store-recording";
import {
  countStudentSubmissions,
  findAssignmentById,
  findTeacherFunnelRowByEmail,
  findVideoUploadReservation,
  findCompletedVideoSubmission,
  hasVideoAudioAccommodation,
  upsertRosterEntry,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { enforceSubmissionRateLimit } from "@/lib/rate-limit";
import { enforceStudentAssignmentAccessPolicy } from "@/lib/student-assignment-access";
import { parseOrThrow400, submissionCreateSchema } from "@/lib/validation";
import {
  submissionLimitReachedMessage,
} from "@/lib/submission-errors";
import { verifyVideoUpload } from "@/lib/video-storage";
import { isVideoTeacherApproved, videoFeatureEnabled } from "@/lib/video-policy";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    const { assignmentId } = await context.params;
    const assignment = await findAssignmentById(assignmentId);
    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const studentEmail = await requireSchoolStudentEmail();
    await enforceStudentAssignmentAccessPolicy({
      classId: assignment.classId,
      ownerEmail: assignment.ownerEmail,
      studentEmail,
    });

    await enforceSubmissionRateLimit(studentEmail);

    const body = parseOrThrow400(submissionCreateSchema.partial({ audioData: true }), await request.json());
    if (body.videoReservationId) {
      const existing = await findCompletedVideoSubmission(body.videoReservationId, assignmentId, studentEmail);
      if (existing) return NextResponse.json({ item: existing });
    }

    if (assignment.maxSubmissions > 0) {
      const existing = await countStudentSubmissions(assignmentId, studentEmail);
      if (existing >= assignment.maxSubmissions) {
        throw new HttpError(403, submissionLimitReachedMessage(assignment.maxSubmissions));
      }
    }

    if (assignment.videoMode === "required" && !body.videoReservationId &&
        !await hasVideoAudioAccommodation(assignmentId, studentEmail)) {
      throw new HttpError(400, "This assignment requires a video response.");
    }
    let videoBlobUrl: string | undefined;
    let verifiedAudio: Awaited<ReturnType<typeof verifyVideoUpload>> | undefined;
    if (body.videoReservationId) {
      if (!videoFeatureEnabled() || !isVideoTeacherApproved(assignment.ownerEmail) || assignment.videoMode === "off") {
        throw new HttpError(403, "Video is not available for this assignment.");
      }
      const reservation = await findVideoUploadReservation(body.videoReservationId, studentEmail);
      if (!reservation || reservation.assignmentId !== assignmentId ||
          reservation.periodEnd <= Date.now() || reservation.createdAt <= Date.now() - 60 * 60_000) {
        throw new HttpError(403, "Video upload authorization expired. Upload again.");
      }
      verifiedAudio = await verifyVideoUpload(reservation.pathname, assignment.maxRecordingSeconds, assignment.ownerEmail);
      videoBlobUrl = reservation.pathname;
    }
    const studentName = body.studentName ?? "";
    const created = await storeRecording({
      assignmentId, studentName, studentEmail, audioData: body.audioData ?? "",
      maxRecordingSeconds: assignment.maxRecordingSeconds,
      videoBlobUrl, videoReservationId: body.videoReservationId, verifiedAudio,
    }).catch(async (error: unknown) => {
      if (body.videoReservationId) {
        const existing = await findCompletedVideoSubmission(body.videoReservationId, assignmentId, studentEmail);
        if (existing) return { ...existing, submittedAt: Number(existing.submittedAt) };
      }
      throw error;
    });

    let teacherJoinedAt: number | undefined;
    try {
      const teacher = await findTeacherFunnelRowByEmail(assignment.ownerEmail);
      teacherJoinedAt = teacher?.joinedAt;
    } catch {
      console.warn("Admin alert activation lookup failed", {
        code: "admin_alert_activation_lookup_failed",
      });
    }
    await enqueueFirstRecordingReceivedAlert({
      teacherEmail: assignment.ownerEmail,
      teacherJoinedAt,
      assignmentCreatedAt: assignment.createdAt,
      recordingCreatedAt: created.submittedAt,
    });

    upsertRosterEntry({
      classId: assignment.classId,
      studentEmail,
      studentName,
      addedBy: "submission",
    }).catch((error: unknown) => {
      console.error("roster upsert failed", error);
    });

    return NextResponse.json({ item: created }, { status: 201 });
  });
}

import { NextResponse } from "next/server";
import { enqueueFirstRecordingReceivedAlert } from "@/lib/admin-alert-lifecycle";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { storeRecording } from "@/lib/store-recording";
import {
  countStudentSubmissions,
  findAssignmentById,
  findTeacherFunnelRowByEmail,
  upsertRosterEntry,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { enforceSubmissionRateLimit } from "@/lib/rate-limit";
import { enforceStudentAssignmentAccessPolicy } from "@/lib/student-assignment-access";
import { parseOrThrow400, submissionCreateSchema } from "@/lib/validation";
import {
  submissionLimitReachedMessage,
} from "@/lib/submission-errors";

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

    if (assignment.maxSubmissions > 0) {
      const existing = await countStudentSubmissions(assignmentId, studentEmail);
      if (existing >= assignment.maxSubmissions) {
        throw new HttpError(403, submissionLimitReachedMessage(assignment.maxSubmissions));
      }
    }

    const body = parseOrThrow400(submissionCreateSchema, await request.json());
    const studentName = body.studentName ?? "";
    const created = await storeRecording({
      assignmentId, studentName, studentEmail, audioData: body.audioData,
      maxRecordingSeconds: assignment.maxRecordingSeconds,
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

import { NextResponse } from "next/server";
import { enqueueFirstRecordingReceivedAlert } from "@/lib/admin-alert-lifecycle";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { assertRecordingDuration } from "@/lib/audio-duration";
import { deleteSubmissionAudio, uploadSubmissionAudio } from "@/lib/audio-storage";
import {
  countStudentSubmissions,
  createSubmission,
  findAssignmentById,
  findTeacherFunnelRowByEmail,
  upsertRosterEntry,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { enforceSubmissionRateLimit } from "@/lib/rate-limit";
import { enforceStudentAssignmentAccessPolicy } from "@/lib/student-assignment-access";
import { getEnv } from "@/lib/env";
import { parseAudioDataUrl, parseOrThrow400, submissionCreateSchema } from "@/lib/validation";
import {
  DuplicateSubmissionError,
  SubmissionLimitReachedError,
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
    const parsedAudio = parseAudioDataUrl(body.audioData);
    await assertRecordingDuration({
      buffer: parsedAudio.buffer,
      mimeType: parsedAudio.mimeType,
      maxRecordingSeconds: assignment.maxRecordingSeconds,
    });
    const submissionId = `sub_${crypto.randomUUID()}`;
    let audioBlobUrl = "";
    try {
      audioBlobUrl = await uploadSubmissionAudio({
        assignmentId,
        submissionId,
        mimeType: parsedAudio.mimeType,
        buffer: parsedAudio.buffer,
      });
    } catch (error) {
      if (getEnv().isDev) {
        // Local development can keep working without cloud storage. Production
        // must fail closed rather than place student audio in Turso or a public store.
        audioBlobUrl = body.audioData;
      } else {
        console.warn("Audio upload failed for submission upload", {
          assignmentId,
          errorName: error instanceof Error ? error.name : "unknown",
        });
        throw new HttpError(
          503,
          "We couldn't upload your recording right now. If you're on a school network, try opening this link on your phone or switching connections."
        );
      }
    }

    let created: Awaited<ReturnType<typeof createSubmission>>;
    try {
      created = await createSubmission({
        id: submissionId,
        assignmentId,
        studentName,
        studentEmail,
        audioBlobUrl,
      });
    } catch (error) {
      try {
        await deleteSubmissionAudio(audioBlobUrl);
      } catch (cleanupError) {
        console.error("Compensating audio deletion failed", {
          assignmentId,
          errorName: cleanupError instanceof Error ? cleanupError.name : "unknown",
        });
      }
      if (error instanceof SubmissionLimitReachedError) {
        throw new HttpError(403, error.message);
      }
      if (error instanceof DuplicateSubmissionError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }

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

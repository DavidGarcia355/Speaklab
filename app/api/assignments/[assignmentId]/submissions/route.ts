import { NextResponse } from "next/server";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { uploadSubmissionAudio } from "@/lib/audio-storage";
import { createSubmission, findAssignmentById } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { enforceSubmissionRateLimit } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import { parseAudioDataUrl, parseOrThrow400, submissionCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

function emailDomain(email: string) {
  const [, domain = ""] = email.toLowerCase().split("@");
  return domain.trim();
}

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
    const ownerDomain = emailDomain(assignment.ownerEmail);
    const studentDomain = emailDomain(studentEmail);
    const bypassEnabled =
      process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true";
    if (!bypassEnabled && ownerDomain && ownerDomain !== studentDomain) {
      throw new HttpError(
        403,
        "This class only accepts submissions from the teacher's school email domain."
      );
    }

    await enforceSubmissionRateLimit(studentEmail);

    const body = parseOrThrow400(submissionCreateSchema, await request.json());
    const studentName = body.studentName ?? "";
    const parsedAudio = parseAudioDataUrl(body.audioData);
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
        // Local dev fallback when Blob is not configured.
        audioBlobUrl = body.audioData;
      } else {
        throw error;
      }
    }

    const created = await createSubmission({
      assignmentId,
      studentName,
      studentEmail,
      audioBlobUrl,
    });
    return NextResponse.json({ item: created }, { status: 201 });
  });
}

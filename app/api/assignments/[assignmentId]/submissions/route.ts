import { NextResponse } from "next/server";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { uploadSubmissionAudio } from "@/lib/audio-storage";
import { createSubmission, findAssignmentById } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { enforceSubmissionRateLimit } from "@/lib/rate-limit";
import { parseAudioDataUrl, parseOrThrow400, submissionCreateSchema } from "@/lib/validation";

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
    await enforceSubmissionRateLimit(studentEmail);

    const body = parseOrThrow400(submissionCreateSchema, await request.json());
    const studentName = body.studentName ?? "";
    const parsedAudio = parseAudioDataUrl(body.audioData);
    const submissionId = `sub_${crypto.randomUUID()}`;
    const audioBlobUrl = await uploadSubmissionAudio({
      assignmentId,
      submissionId,
      mimeType: parsedAudio.mimeType,
      buffer: parsedAudio.buffer,
    });

    const created = await createSubmission({
      assignmentId,
      studentName,
      studentEmail,
      audioBlobUrl,
    });
    return NextResponse.json({ item: created }, { status: 201 });
  });
}

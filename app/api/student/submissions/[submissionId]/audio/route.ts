import { requireSchoolStudentEmail } from "@/lib/authz";
import { findStudentSubmissionAudioAccessById } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { createSubmissionAudioResponse } from "@/lib/submission-audio-response";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    const studentEmail = await requireSchoolStudentEmail();
    const { submissionId } = await context.params;
    const found = await findStudentSubmissionAudioAccessById(submissionId, studentEmail);
    if (!found) {
      throw new HttpError(404, "Audio not found.");
    }

    return createSubmissionAudioResponse({
      submissionId,
      audioBlobUrl: found.audioBlobUrl,
    });
  });
}

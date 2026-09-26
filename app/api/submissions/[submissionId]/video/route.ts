import { requireTeacherEmail } from "@/lib/authz";
import { findSubmissionAccessById } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { streamVideo } from "@/lib/video-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  return withApiHandler(request, async () => {
    const email = await requireTeacherEmail();
    const { submissionId } = await context.params;
    const found = await findSubmissionAccessById(submissionId, email);
    if (!found?.videoBlobUrl) throw new HttpError(404, "Video not found.");
    return streamVideo(request, found.videoBlobUrl, found.ownerEmail);
  });
}

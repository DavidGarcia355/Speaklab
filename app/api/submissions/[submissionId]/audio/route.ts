import { isTeacherEmail, requireAuthenticatedEmail } from "@/lib/authz";
import { findSubmissionAccessById } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

function decodeLegacyDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new HttpError(500, "Something went wrong.");
  }
  return {
    contentType: match[1],
    body: Buffer.from(match[2], "base64"),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const { submissionId } = await context.params;
    const found = await findSubmissionAccessById(submissionId);
    if (!found) {
      throw new HttpError(404, "Submission not found.");
    }

    const allowed = isTeacherEmail(email) || email.toLowerCase() === found.studentEmail.toLowerCase();
    if (!allowed) {
      throw new HttpError(403, "You are not allowed to access this audio.");
    }

    if (!found.audioBlobUrl) {
      throw new HttpError(404, "Audio not found.");
    }

    if (found.audioBlobUrl.startsWith("data:audio/")) {
      const legacy = decodeLegacyDataUrl(found.audioBlobUrl);
      return new Response(legacy.body, {
        status: 200,
        headers: {
          "Content-Type": legacy.contentType,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const upstream = await fetch(found.audioBlobUrl, { cache: "no-store" });
    if (!upstream.ok) {
      throw new HttpError(404, "Audio not found.");
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "private, no-store",
      },
    });
  });
}

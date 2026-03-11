import { requireAuthenticatedEmail } from "@/lib/authz";
import { findSubmissionAccessById } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

function decodeLegacyDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new HttpError(500, "Something went wrong - try refreshing the page.");
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

    let found = await findSubmissionAccessById(submissionId, email);
    if (!found) {
      const ownSubmission = await findSubmissionAccessById(submissionId);
      if (!ownSubmission || ownSubmission.studentEmail.toLowerCase() !== email.toLowerCase()) {
        throw new HttpError(403, "You don't have access to this page.");
      }
      found = ownSubmission;
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

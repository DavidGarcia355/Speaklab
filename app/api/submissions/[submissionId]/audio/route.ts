import { get } from "@vercel/blob";
import { requireTeacherEmail } from "@/lib/authz";
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

function normalizeBlobReference(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^\/+/, "");

  try {
    const url = new URL(trimmed);
    return url.pathname.replace(/^\/+/, "");
  } catch {
    return trimmed;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    const email = await requireTeacherEmail();
    const { submissionId } = await context.params;
    const found = await findSubmissionAccessById(submissionId, email);
    if (!found) {
      throw new HttpError(403, "You don't have access to this page.");
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

    const blobReference = normalizeBlobReference(found.audioBlobUrl);
    const upstream = await get(blobReference, {
      access: "private",
      useCache: false,
    });
    if (!upstream || upstream.statusCode !== 200 || !upstream.stream) {
      throw new HttpError(404, "Audio not found.");
    }

    return new Response(upstream.stream, {
      status: 200,
      headers: {
        "Content-Type": upstream.blob.contentType || "application/octet-stream",
        "Cache-Control": "private, no-store",
      },
    });
  });
}

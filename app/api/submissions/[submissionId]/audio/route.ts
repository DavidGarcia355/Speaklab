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

function resolveBlobFetchTarget(value: string): {
  reference: string;
  mode: "public-url" | "private-blob";
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      reference: "",
      mode: "private-blob",
    };
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      reference: trimmed.replace(/^\/+/, ""),
      mode: "private-blob",
    };
  }

  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    if (hostname.endsWith(".public.blob.vercel-storage.com")) {
      return {
        reference: trimmed,
        mode: "public-url",
      };
    }

    return {
      reference: trimmed,
      mode: "private-blob",
    };
  } catch {
    return {
      reference: trimmed,
      mode: "private-blob",
    };
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

    const blobTarget = resolveBlobFetchTarget(found.audioBlobUrl);
    if (blobTarget.mode === "public-url") {
      const upstream = await fetch(blobTarget.reference, {
        cache: "no-store",
      });
      if (!upstream.ok || !upstream.body) {
        throw new HttpError(404, "Audio not found.");
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": "private, no-store",
        },
      });
    }

    const upstream = await get(blobTarget.reference, {
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

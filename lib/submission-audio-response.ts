import "server-only";
import { get } from "@vercel/blob";
import { getAudioBlobCommandOptions } from "@/lib/audio-blob";
import { HttpError } from "@/lib/http";
import { parseAudioDataUrl } from "@/lib/validation";

function decodeLegacyDataUrl(dataUrl: string) {
  try {
    const parsed = parseAudioDataUrl(dataUrl);
    return {
      contentType: parsed.mimeType,
      body: parsed.buffer,
    };
  } catch {
    throw new HttpError(500, "Something went wrong - try refreshing the page.");
  }
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

export async function createSubmissionAudioResponse(input: {
  submissionId: string;
  audioBlobUrl: string;
}) {
  if (!input.audioBlobUrl) {
    throw new HttpError(404, "Audio not found.");
  }

  if (input.audioBlobUrl.startsWith("data:audio/")) {
    const legacy = decodeLegacyDataUrl(input.audioBlobUrl);
    return new Response(new Uint8Array(legacy.body), {
      status: 200,
      headers: {
        "Content-Type": legacy.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const blobTarget = resolveBlobFetchTarget(input.audioBlobUrl);
  if (blobTarget.mode === "public-url") {
    console.warn("Blocked playback for public student-audio Blob URL", {
      submissionId: input.submissionId,
    });
    throw new HttpError(410, "Audio storage needs migration before playback.");
  }

  const upstream = await get(blobTarget.reference, {
    access: "private",
    useCache: false,
    ...getAudioBlobCommandOptions(),
  });
  if (!upstream || upstream.statusCode !== 200 || !upstream.stream) {
    throw new HttpError(404, "Audio not found.");
  }

  return new Response(upstream.stream, {
    status: 200,
    headers: {
      "Content-Type": upstream.blob.contentType || "application/octet-stream",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

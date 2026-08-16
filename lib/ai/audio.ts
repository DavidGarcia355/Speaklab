import "server-only";
import { get } from "@vercel/blob";
import { HttpError } from "@/lib/http";

export const AI_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function fetchAuthorizedAudioBuffer(
  audioBlobUrl: string
): Promise<{ buffer: Buffer; contentType: string; storageMode: "legacy-data-url" | "private-blob" }> {
  if (audioBlobUrl.startsWith("data:audio/")) {
    const match = audioBlobUrl.match(/^data:([a-z0-9/+.-]+)(?:;[a-z0-9=_.-]+)*;base64,([a-z0-9+/=]+)$/i);
    if (!match) throw new HttpError(500, "Could not decode legacy audio data.");
    return {
      buffer: Buffer.from(match[2], "base64"),
      contentType: match[1],
      storageMode: "legacy-data-url",
    };
  }

  const trimmed = audioBlobUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const hostname = new URL(trimmed).hostname.toLowerCase();
      if (hostname.endsWith(".public.blob.vercel-storage.com")) {
        throw new HttpError(410, "Audio storage needs migration before AI grading.");
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
    }
  }

  const reference = trimmed.replace(/^\/+/, "");
  const blob = await get(reference, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    throw new HttpError(404, "Audio not found.");
  }
  const arrayBuffer = await new Response(blob.stream).arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > AI_MAX_AUDIO_BYTES) {
    throw new HttpError(413, "Audio file is too large to transcribe (max 25 MB).");
  }
  return {
    buffer,
    contentType: blob.blob.contentType ?? "application/octet-stream",
    storageMode: "private-blob",
  };
}

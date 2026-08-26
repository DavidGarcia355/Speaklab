import "server-only";
import { get } from "@vercel/blob";
import { getAudioBlobCommandOptions } from "@/lib/audio-blob";
import { HttpError } from "@/lib/http";
import { parseAudioDataUrl } from "@/lib/validation";

export const AI_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function fetchAuthorizedAudioBuffer(
  audioBlobUrl: string
): Promise<{ buffer: Buffer; contentType: string; storageMode: "legacy-data-url" | "private-blob" }> {
  if (audioBlobUrl.startsWith("data:audio/")) {
    let parsed: ReturnType<typeof parseAudioDataUrl>;
    try {
      parsed = parseAudioDataUrl(audioBlobUrl);
    } catch {
      throw new HttpError(500, "Could not decode legacy audio data.");
    }
    return {
      buffer: parsed.buffer,
      contentType: parsed.mimeType,
      storageMode: "legacy-data-url",
    };
  }

  const trimmed = audioBlobUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const hostname = new URL(trimmed).hostname.toLowerCase();
      if (hostname.endsWith(".public.blob.vercel-storage.com")) {
        throw new HttpError(410, "Audio storage needs migration before AI processing.");
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
    }
  }

  const reference = trimmed.replace(/^\/+/, "");
  const blob = await get(reference, {
    access: "private",
    useCache: false,
    ...getAudioBlobCommandOptions(),
  });
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

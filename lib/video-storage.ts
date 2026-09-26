import "server-only";
import { get, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { extractVideoAudio } from "@/lib/video-media";
import { reserveVideoResources } from "@/lib/db";
import { getPrivateBlobCommandOptions } from "@/lib/audio-blob";
import { HttpError } from "@/lib/http";
import { VIDEO_MAX_BYTES, isVideoContentType } from "@/lib/video-policy";

export async function authorizeVideoPut(pathname: string, contentType: "video/webm" | "video/mp4") {
  const expiry = Date.now() + 10 * 60_000;
  const token = await issueSignedToken({
    pathname, operations: ["put"], validUntil: expiry,
    allowedContentTypes: [contentType], maximumSizeInBytes: VIDEO_MAX_BYTES,
    ...getPrivateBlobCommandOptions(),
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put", pathname, access: "private", validUntil: expiry,
    allowedContentTypes: [contentType], maximumSizeInBytes: VIDEO_MAX_BYTES,
    addRandomSuffix: false, allowOverwrite: false,
  });
  return presignedUrl;
}

export async function verifyVideoUpload(pathname: string, maxSeconds: number, teacherEmail: string) {
  if (!await reserveVideoResources({ teacherEmail, kind: "validation", bytes: VIDEO_MAX_BYTES, requests: 1 })) {
    throw new HttpError(429, "Video processing allowance reached. Ask your teacher for help.");
  }
  const options = getPrivateBlobCommandOptions();
  const metadata = await head(pathname, options);
  if (metadata.pathname !== pathname || !isVideoContentType(metadata.contentType) ||
      metadata.size < 1000 || metadata.size > VIDEO_MAX_BYTES) {
    throw new HttpError(400, "The video file is invalid or exceeds 20 MB.");
  }
  const object = await get(pathname, { access: "private", useCache: false, ...options });
  if (!object?.stream || object.statusCode !== 200) throw new HttpError(404, "Video upload not found.");
  const buffer = Buffer.from(await new Response(object.stream).arrayBuffer());
  if (buffer.byteLength !== metadata.size) throw new HttpError(400, "The video upload is incomplete.");
  return extractVideoAudio(buffer, metadata.contentType, maxSeconds);
}

export function videoByteRange(header: string | null, size: number) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size
    ? { start, end, partial: true } : null;
}

/** Same-origin streaming: no reusable storage capability is exposed to the browser. */
export async function streamVideo(request: Request, pathname: string, teacherEmail: string) {
  const reserve = (bytes: number, requests: number) => reserveVideoResources({ teacherEmail, kind: "playback", bytes, requests });
  if (!await reserve(0, 1)) throw new HttpError(429, "Video playback allowance reached. Contact your teacher.");
  const options = getPrivateBlobCommandOptions();
  const metadata = await head(pathname, options);
  if (metadata.pathname !== pathname || !isVideoContentType(metadata.contentType) || metadata.size > VIDEO_MAX_BYTES) {
    throw new HttpError(404, "Video not found.");
  }
  const range = videoByteRange(request.headers.get("range"), metadata.size);
  if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${metadata.size}`, "Cache-Control": "private, no-store" } });
  const size = range.end - range.start + 1;
  // Reserve the whole object in case an upstream ignores Range. Never refund failed requests.
  if (!await reserve(metadata.size, 0)) throw new HttpError(429, "Video playback allowance reached. Contact your teacher.");
  const object = await get(pathname, { access: "private", ...options, abortSignal: request.signal,
    headers: range.partial ? { Range: `bytes=${range.start}-${range.end}` } : {} });
  if (!object?.stream) throw new HttpError(404, "Video not found.");
  const expected = `bytes ${range.start}-${range.end}/${metadata.size}`;
  if (range.partial && object.headers.get("content-range") !== expected) {
    await object.stream.cancel();
    throw new HttpError(503, "Video seeking is unavailable. Please try again.");
  }
  return new Response(object.stream, { status: range.partial ? 206 : 200, headers: {
    "Content-Type": metadata.contentType, "Content-Length": String(size), "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    ...(range.partial ? { "Content-Range": expected } : {}),
  } });
}

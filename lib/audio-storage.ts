import "server-only";
import { put } from "@vercel/blob";

export async function uploadSubmissionAudio(input: {
  assignmentId: string;
  submissionId: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const extMap: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
  };
  const ext = extMap[input.mimeType] ?? "bin";
  const key = `submissions/${input.assignmentId}/${input.submissionId}-${crypto.randomUUID()}.${ext}`;
  const result = await put(key, input.buffer, {
    access: "public",
    contentType: input.mimeType,
    addRandomSuffix: false,
  });
  return result.url;
}


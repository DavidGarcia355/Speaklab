import "server-only";
import { del, put } from "@vercel/blob";
import { getAudioBlobCommandOptions } from "@/lib/audio-blob";

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
    access: "private",
    contentType: input.mimeType,
    addRandomSuffix: false,
    ...getAudioBlobCommandOptions(),
  });
  return result.pathname;
}

export async function deleteSubmissionAudio(reference: string) {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith("data:")) return;
  const target = /^https?:\/\//i.test(trimmed) ? trimmed : trimmed.replace(/^\/+/, "");
  await del(target, getAudioBlobCommandOptions());
}

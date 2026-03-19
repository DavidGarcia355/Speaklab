import "server-only";
import { put } from "@vercel/blob";

function isPublicStoreAccessError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Cannot use private access on a public store")
  );
}

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
  try {
    const result = await put(key, input.buffer, {
      access: "private",
      contentType: input.mimeType,
      addRandomSuffix: false,
    });
    return result.pathname;
  } catch (error) {
    if (!isPublicStoreAccessError(error)) {
      throw error;
    }

    // Public blob store fallback: log a warning so the operator knows to migrate
    // to a private store. Student audio should not be publicly accessible long-term.
    console.warn(
      "SECURITY: Blob store is public — student audio will be publicly accessible. " +
      "Migrate to a private Vercel Blob store as soon as possible."
    );
    const result = await put(key, input.buffer, {
      access: "public",
      contentType: input.mimeType,
      addRandomSuffix: false,
    });
    return result.url;
  }
}

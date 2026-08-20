import "server-only";
import { BlobNotFoundError, del } from "@vercel/blob";

function toDeletionTarget(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.replace(/^\/+/, "");
}

export async function deleteBlobObjects(values: string[]) {
  const targets = Array.from(
    new Set(values.map(toDeletionTarget).filter((value): value is string => Boolean(value)))
  );
  let deleted = 0;
  let alreadyMissing = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      await del(target);
      deleted++;
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        alreadyMissing++;
        continue;
      }

      failed++;
      console.warn("Blob deletion failed during cleanup", {
        targetKind: /^https?:\/\//i.test(target) ? "url" : "pathname",
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return {
    attempted: targets.length,
    deleted,
    alreadyMissing,
    failed,
    skipped: values.length - targets.length,
  };
}

import "server-only";
import { BlobNotFoundError, del } from "@vercel/blob";
import { getAudioBlobCommandOptions } from "@/lib/audio-blob";

export type BlobObjectClass = "audio" | "attachment";

function toDeletionTarget(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.replace(/^\/+/, "");
}

function isLegacyPublicBlobUrl(target: string) {
  if (!/^https?:\/\//i.test(target)) return false;
  try {
    return new URL(target).hostname.toLowerCase().endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function deleteBlobObjects(
  values: string[],
  options: { objectClass?: BlobObjectClass } = {}
) {
  const targets = Array.from(
    new Set(values.map(toDeletionTarget).filter((value): value is string => Boolean(value)))
  );
  let deleted = 0;
  let alreadyMissing = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const commandOptions =
        options.objectClass === "audio" && !isLegacyPublicBlobUrl(target)
          ? getAudioBlobCommandOptions()
          : undefined;
      await del(target, commandOptions);
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
        objectClass: options.objectClass ?? "attachment",
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

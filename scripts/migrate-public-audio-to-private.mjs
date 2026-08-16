// One-off migration: re-upload student submission audio that is still sitting
// on public Vercel Blob URLs (from before private-storage was enforced) as
// private blobs, then point the submission row at the new private key.
//
// Run with production credentials loaded, e.g.:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... BLOB_READ_WRITE_TOKEN=... node scripts/migrate-public-audio-to-private.mjs
//
// Safe to re-run: only touches rows whose audio_blob_url still matches
// *.public.blob.vercel-storage.com.

import { createClient } from "@libsql/client";
import { put, del } from "@vercel/blob";

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();
if (!tursoUrl || !tursoToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are both required.");
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
  console.error("BLOB_READ_WRITE_TOKEN is required.");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");

const client = createClient({ url: tursoUrl, authToken: tursoToken });

function isPublicBlobUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).hostname.toLowerCase().endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function extFromContentType(contentType) {
  const map = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
  };
  return map[contentType] ?? "bin";
}

async function main() {
  const result = await client.execute(
    `SELECT id, assignment_id as assignmentId, audio_blob_url as audioBlobUrl
     FROM submissions
     WHERE deleted_at IS NULL
       AND COALESCE(audio_blob_url, '') <> ''`
  );

  const rows = result.rows.filter((row) => isPublicBlobUrl(String(row.audioBlobUrl)));
  console.log(`Found ${rows.length} submission(s) with a public Blob URL.`);

  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    const id = String(row.id);
    const assignmentId = String(row.assignmentId);
    const publicUrl = String(row.audioBlobUrl);

    try {
      const response = await fetch(publicUrl);
      if (!response.ok || !response.body) {
        throw new Error(`fetch failed with status ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const buffer = Buffer.from(await response.arrayBuffer());

      if (dryRun) {
        console.log(`[dry-run] Would migrate ${id} (${buffer.length} bytes, ${contentType})`);
        continue;
      }

      const key = `submissions/${assignmentId}/${id}-${crypto.randomUUID()}.${extFromContentType(contentType)}`;
      const uploaded = await put(key, buffer, {
        access: "private",
        contentType,
        addRandomSuffix: false,
      });

      await client.execute({
        sql: `UPDATE submissions SET audio_blob_url = ? WHERE id = ?`,
        args: [uploaded.pathname, id],
      });

      await del(publicUrl).catch((error) => {
        console.warn(`  (kept old public blob for ${id}, delete failed: ${error.message})`);
      });

      console.log(`Migrated ${id} -> ${uploaded.pathname}`);
      migrated += 1;
    } catch (error) {
      console.error(`Failed to migrate ${id}: ${error instanceof Error ? error.message : error}`);
      failed += 1;
    }
  }

  console.log(`\nDone. Migrated ${migrated}, failed ${failed}, skipped ${rows.length - migrated - failed}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

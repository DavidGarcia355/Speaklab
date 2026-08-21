import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { deleteBlobObjects } from "@/lib/blob-deletion";
import { hardDeleteSoftDeletedBefore, listStorageObjectsForHardDeleteBefore } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { HttpError, withApiHandler } from "@/lib/http";
import { flushPendingAiBillingUsage } from "@/lib/billing";

export const runtime = "nodejs";

function safeEquals(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isAuthorized(request: Request) {
  const header = request.headers.get("authorization") || "";
  const xSecret = request.headers.get("x-cron-secret") || "";
  const expected = getEnv().cronSecret;
  if (!expected) return false;
  return safeEquals(header, `Bearer ${expected}`) || safeEquals(xSecret, expected);
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    if (!isAuthorized(request)) {
      throw new HttpError(403, "You don't have access to this page.");
    }

    const billingUsage = await flushPendingAiBillingUsage(100).catch((error) => {
      console.error("Stripe usage retry failed", error);
      return { attempted: 0, reported: 0, failed: 1 };
    });

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const storageObjects = await listStorageObjectsForHardDeleteBefore(cutoff);
    const [audioObjects, attachmentObjects] = await Promise.all([
      deleteBlobObjects(storageObjects.audioBlobUrls, { objectClass: "audio" }),
      deleteBlobObjects(storageObjects.attachmentUrls, { objectClass: "attachment" }),
    ]);

    if (audioObjects.failed > 0 || attachmentObjects.failed > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Storage cleanup was incomplete. Database cleanup was deferred for retry.",
          audioObjects,
          attachmentObjects,
          billingUsage,
        },
        {
          status: 503,
          headers: { "Retry-After": "300" },
        }
      );
    }

    const result = await hardDeleteSoftDeletedBefore(cutoff);
    return NextResponse.json({
      ok: true,
      ...result,
      audioObjects,
      attachmentObjects,
      billingUsage,
    });
  });
}

import { NextResponse } from "next/server";
import { hardDeleteSoftDeletedBefore } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

function isAuthorized(request: Request) {
  const header = request.headers.get("authorization") || "";
  const xSecret = request.headers.get("x-cron-secret") || "";
  const expected = getEnv().cronSecret;
  return header === `Bearer ${expected}` || xSecret === expected;
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    if (!isAuthorized(request)) {
      throw new HttpError(403, "You don't have access to this page.");
    }

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = await hardDeleteSoftDeletedBefore(cutoff);
    return NextResponse.json({ ok: true, ...result });
  });
}

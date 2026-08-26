import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processAutomaticTranscriptionJobs } from "@/lib/ai/automatic-transcription";
import { getEnv } from "@/lib/env";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 800;

function safeEquals(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function isAuthorized(request: Request) {
  const expected = getEnv().cronSecret;
  if (!expected) return false;
  return safeEquals(request.headers.get("authorization") ?? "", `Bearer ${expected}`)
    || safeEquals(request.headers.get("x-cron-secret") ?? "", expected);
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const summary = await processAutomaticTranscriptionJobs({ limit: 2 });
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

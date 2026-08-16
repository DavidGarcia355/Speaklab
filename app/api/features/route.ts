import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () =>
    NextResponse.json({
      aiGradingEnabled: process.env.AI_GRADING_ENABLED === "true",
      aiTranscriptionProvider: process.env.AI_TRANSCRIPTION_PROVIDER || "openai",
      aiGradingProvider: process.env.AI_GRADING_PROVIDER || "ollama",
      localAiTestMode:
        process.env.NODE_ENV !== "production" &&
        process.env.AI_TRANSCRIPTION_PROVIDER === "mock" &&
        process.env.AI_GRADING_PROVIDER === "mock",
      localAuthBypassEnabled:
        process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true",
    })
  );
}

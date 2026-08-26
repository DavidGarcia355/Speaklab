import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  findOwnedSubmissionForAiReview,
  findSubmissionTranscriptForOwner,
  listAiGradingAttemptsForSubmission,
  type SubmissionTranscriptRow,
} from "@/lib/db";
import {
  assertAiTranscriptionProviderConfig,
  getAiConfig,
  isAiTeacherDenied,
} from "@/lib/ai/config";
import { transcribeOneSubmission } from "@/lib/ai/transcript-one";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

type PublicTranscript = {
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: string;
  durationSeconds: number;
  createdAt: number;
};

function publicTranscript(item: SubmissionTranscriptRow): PublicTranscript {
  return {
    transcript: item.transcript,
    detectedLanguage: item.detectedLanguage,
    transcriptQuality: item.transcriptQuality,
    durationSeconds: item.durationSeconds,
    createdAt: item.createdAt,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { submissionId } = await context.params;
    const owned = await findOwnedSubmissionForAiReview(submissionId, teacherEmail);
    if (!owned) throw new HttpError(403, "You don't have access to this submission.");

    const saved = await findSubmissionTranscriptForOwner(submissionId, teacherEmail);
    if (saved) {
      return NextResponse.json(
        { item: publicTranscript(saved) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    // Results created before standalone transcript persistence remain readable
    // without turning this GET into a mutation.
    const attempts = await listAiGradingAttemptsForSubmission(submissionId, teacherEmail, 5);
    const prior = attempts.find(
      (attempt) => attempt.transcript.trim() && !attempt.errorCode.trim(),
    );
    const item: PublicTranscript | null = prior
      ? {
          transcript: prior.transcript,
          detectedLanguage: prior.detectedLanguage,
          transcriptQuality: prior.transcriptQuality,
          durationSeconds: prior.durationSeconds,
          createdAt: prior.completedAt ?? prior.createdAt,
        }
      : null;
    return NextResponse.json(
      { item },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  return withApiHandler(request, async () => {
    const config = getAiConfig();
    if (!config.enabled) throw new HttpError(404, "Transcription is not available.");
    try {
      assertAiTranscriptionProviderConfig(config);
    } catch {
      throw new HttpError(503, "Transcription is not fully configured.");
    }

    const teacherEmail = await requireTeacherEmail();
    if (isAiTeacherDenied(teacherEmail, config)) {
      throw new HttpError(403, "Transcription is not available for this account.");
    }
    const { submissionId } = await context.params;
    const data = await findOwnedSubmissionForAiReview(submissionId, teacherEmail);
    if (!data) throw new HttpError(403, "You don't have access to this submission.");

    const outcome = await transcribeOneSubmission({ config, teacherEmail, data });
    if (outcome.status === "failed") {
      const status =
        outcome.code === "audio_too_long" || outcome.code === "audio_too_large"
          ? 413
          : outcome.code === "no_speech_detected"
            ? 422
            : outcome.code === "ai_review_limit_reached" ||
                outcome.code === "provider_budget_exhausted" ||
                outcome.code === "usage_limit_reached" ||
                outcome.code === "provider_rate_limit" ||
                outcome.code === "provider_spend_limit"
              ? 429
              : outcome.code === "billing_sync_required" ||
                  outcome.code === "ai_review_in_progress" ||
                  outcome.code === "saved_review_unavailable" ||
                  outcome.code === "result_not_delivered" ||
                  outcome.code === "audio_storage_migration_required"
                ? 409
                : outcome.code === "no_audio"
                  ? 404
                  : 502;
      throw new HttpError(status, outcome.message);
    }

    return NextResponse.json(
      {
        item: publicTranscript(outcome.item),
        ...(outcome.allowance ? { allowance: outcome.allowance } : {}),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

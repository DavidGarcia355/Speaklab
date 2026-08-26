import { NextResponse } from "next/server";
import { enqueueSuccessfulAiReviewAlerts } from "@/lib/admin-alert-lifecycle";
import { requireTeacherEmail } from "@/lib/authz";
import {
  countAiAttemptsForSubmission,
  countAiAttemptsForTeacherSince,
  countAiAttemptsSince,
  findTeacherFunnelRowByEmail,
  findOwnedSubmissionForAiReview,
  findSubmissionForAiGrade,
  getAiReviewAllowanceSummary,
  hasAudioTooLongFailure,
  latestAiAttemptCreatedAt,
  listAiGradingAttemptsForSubmission,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { assertAiProviderConfig, getAiConfig, isAiTeacherDenied, isLocalMockAi } from "@/lib/ai/config";
import { gradeOneSubmission } from "@/lib/ai/grade-one";
import { assertGradingProviderConfiguration, getGradingConfig } from "@/lib/grading/config";

export const runtime = "nodejs";

function publicAttempt(attempt: Awaited<ReturnType<typeof listAiGradingAttemptsForSubmission>>[number]) {
  return {
    id: attempt.id,
    status: attempt.status,
    transcript: attempt.transcript,
    detectedLanguage: attempt.detectedLanguage,
    transcriptQuality: attempt.transcriptQuality,
    durationSeconds: attempt.durationSeconds,
    suggestedScore: attempt.suggestedScore,
    rubricScores: attempt.rubricScores,
    feedback: attempt.feedback,
    strengths: attempt.strengths,
    improvements: attempt.improvements,
    evidence: attempt.evidence,
    confidence: attempt.confidence,
    warnings: attempt.warnings,
    teacherAttention: attempt.teacherAttention,
    errorMessage: attempt.errorMessage,
    createdAt: attempt.createdAt,
    completedAt: attempt.completedAt,
  };
}

async function assertAttemptLimits(input: {
  submissionId: string;
  teacherEmail: string;
  maxGenerationsPerSubmission: number;
  cooldownSeconds: number;
  dailyTeacherLimit: number;
  dailyGlobalLimit: number;
}) {
  const perSubmission = await countAiAttemptsForSubmission(input.submissionId, input.teacherEmail);
  if (perSubmission >= input.maxGenerationsPerSubmission) {
    throw new HttpError(429, "AI generation limit reached for this submission.");
  }

  const latest = await latestAiAttemptCreatedAt(input.submissionId, input.teacherEmail);
  if (latest && Date.now() - latest < input.cooldownSeconds * 1000) {
    throw new HttpError(429, "Please wait before regenerating an AI suggestion.");
  }

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const daily = await countAiAttemptsForTeacherSince(input.teacherEmail, since);
  if (daily >= input.dailyTeacherLimit) {
    throw new HttpError(429, "Daily AI generation limit reached.");
  }

  const globalDaily = await countAiAttemptsSince(since);
  if (globalDaily >= input.dailyGlobalLimit) {
    throw new HttpError(429, "Daily AI generation limit reached for the whole app. Try again tomorrow.");
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    const config = getAiConfig();
    if (!config.enabled) throw new HttpError(404, "AI grading is not available.");
    const teacherEmail = await requireTeacherEmail();
    const { submissionId } = await context.params;
    const [attempts, allowance] = await Promise.all([
      listAiGradingAttemptsForSubmission(submissionId, teacherEmail, 5),
      config.accessMode === "paid" && !isLocalMockAi(config)
        ? getAiReviewAllowanceSummary({ teacherEmail })
        : Promise.resolve(null),
    ]);
    return NextResponse.json({
      items: attempts.map(publicAttempt),
      latest: attempts[0] ? publicAttempt(attempts[0]) : null,
      allowance,
    });
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    const config = getAiConfig();
    if (!config.enabled) throw new HttpError(404, "AI grading is not available.");
    try {
      assertAiProviderConfig(config);
      assertGradingProviderConfiguration(getGradingConfig());
    } catch {
      throw new HttpError(503, "AI grading is not fully configured.");
    }

    const teacherEmail = await requireTeacherEmail();
    if (isAiTeacherDenied(teacherEmail, config)) {
      throw new HttpError(403, "AI grading is not available for this account.");
    }
    const { submissionId } = await context.params;
    const requestBody = request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as { enhanced?: unknown } | null)
      : null;
    const enhanced = requestBody?.enhanced === true;
    const gradeCandidate = await findSubmissionForAiGrade(submissionId, teacherEmail);
    const retryCandidate = gradeCandidate
      ? null
      : await findOwnedSubmissionForAiReview(submissionId, teacherEmail);
    const data =
      gradeCandidate ??
      (retryCandidate &&
      retryCandidate.finalGrade !== null &&
      retryCandidate.finalGradeSource === "ai"
        ? retryCandidate
        : null);
    if (!data) throw new HttpError(403, "You don't have access to this submission.");
    if (!data.audioBlobUrl) throw new HttpError(404, "No audio found for this submission.");

    // A graded row is admitted only so gradeOneSubmission can verify an exact,
    // already-consumed semantic retry. It must never reserve provider budget or
    // be allowed through the ordinary regeneration path.
    if (data.finalGrade === null) {
      await assertAttemptLimits({
        submissionId,
        teacherEmail,
        maxGenerationsPerSubmission: config.maxGenerationsPerSubmission,
        cooldownSeconds: config.cooldownSeconds,
        dailyTeacherLimit: config.dailyTeacherLimit,
        dailyGlobalLimit: config.dailyGlobalLimit,
      });

      if (await hasAudioTooLongFailure(submissionId)) {
        throw new HttpError(413, "This recording is longer than the AI grading limit and can't be graded.");
      }

    }

    const wasAlreadyGraded = data.finalGrade !== null;
    const outcome = await gradeOneSubmission({ config, teacherEmail, data, enhanced });
    if (outcome.status === "skipped") {
      throw new HttpError(
        outcome.reason === "audio_too_long" ? 413 : 404,
        outcome.reason === "audio_too_long"
          ? "This recording is longer than the AI grading limit and can't be graded."
          : "No audio found for this submission."
      );
    }
    if (outcome.status === "failed") {
      const resultWasWithheld = outcome.code === "result_not_delivered";
      const failedBeforeAttempt = [
        "billing_sync_required",
        "ai_review_limit_reached",
        "ai_review_in_progress",
        "review_identity_unavailable",
        "saved_review_unavailable",
        "submission_already_graded",
        "provider_budget_exhausted",
        "usage_limit_reached",
        "provider_rate_limit",
        "provider_spend_limit",
      ].includes(outcome.code);
      const attempts = resultWasWithheld || failedBeforeAttempt
        ? []
        : await listAiGradingAttemptsForSubmission(submissionId, teacherEmail, 1);
      return NextResponse.json(
        {
          attempt: attempts[0] ? publicAttempt(attempts[0]) : null,
          error: outcome.message,
        },
        {
          status:
            outcome.code === "no_speech_detected"
              ? 422
              : outcome.code === "ai_review_limit_reached"
                ? 429
                : outcome.code === "provider_budget_exhausted"
                  ? 429
                : outcome.code === "usage_limit_reached" ||
                    outcome.code === "provider_rate_limit" ||
                    outcome.code === "provider_spend_limit"
                  ? 429
                : outcome.code === "billing_sync_required" ||
                    outcome.code === "ai_review_in_progress" ||
                    outcome.code === "saved_review_unavailable"
                  ? 409
                  : outcome.code === "submission_already_graded"
                    ? 409
              : resultWasWithheld
                ? 409
                : 502,
        }
      );
    }
    const usableNewReview =
      !wasAlreadyGraded &&
      outcome.attempt.suggestedScore !== null &&
      outcome.teacherAttention !== "unable_to_grade" &&
      outcome.attempt.resultSource !== "allowance_duplicate";
    if (usableNewReview) {
      try {
        const [teacher, allowance] = await Promise.all([
          findTeacherFunnelRowByEmail(teacherEmail),
          config.accessMode === "paid" && !isLocalMockAi(config)
            ? getAiReviewAllowanceSummary({ teacherEmail })
            : Promise.resolve(null),
        ]);
        await enqueueSuccessfulAiReviewAlerts({
          teacherEmail,
          teacherJoinedAt: teacher?.joinedAt ?? outcome.attempt.createdAt,
          durationSeconds: outcome.attempt.durationSeconds,
          estimatedCostMicrousd: outcome.attempt.estimatedCostMicrousd,
          allowance,
          completedAt: outcome.attempt.completedAt ?? outcome.attempt.createdAt,
        });
      } catch {
        console.warn("Admin alert lifecycle check failed", {
          code: "ai_review_lifecycle_check_failed",
        });
      }
    }
    return NextResponse.json({
      attempt: publicAttempt(outcome.attempt),
      gradeApplied: outcome.gradeApplied,
    });
  });
}

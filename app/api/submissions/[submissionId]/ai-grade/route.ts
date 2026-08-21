import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  countAiAttemptsForSubmission,
  countAiAttemptsForTeacherSince,
  countAiAttemptsSince,
  findSubmissionForAiGrade,
  getUserHasAiAccess,
  hasAudioTooLongFailure,
  latestAiAttemptCreatedAt,
  listAiGradingAttemptsForSubmission,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { reserveGenerationBudget } from "@/lib/ai/budget";
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
    transcriptionProvider: attempt.transcriptionProvider,
    gradingProvider: attempt.gradingProvider,
    transcriptionModel: attempt.transcriptionModel,
    gradingModel: attempt.gradingModel,
    errorMessage: attempt.errorMessage,
    cacheHit: attempt.cacheHit,
    inputTokens: attempt.inputTokens,
    cachedInputTokens: attempt.cachedInputTokens,
    outputTokens: attempt.outputTokens,
    latencyMs: attempt.latencyMs,
    retries: attempt.retries,
    escalated: attempt.escalated,
    escalationReason: attempt.escalationReason,
    estimatedCostUsd: attempt.estimatedCostMicrousd / 1_000_000,
    promptVersion: attempt.promptVersion,
    resultSource: attempt.resultSource,
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
  context: { params: Promise<{ submissionId: string }> | { submissionId: string } }
) {
  return withApiHandler(request, async () => {
    const config = getAiConfig();
    if (!config.enabled) throw new HttpError(404, "AI grading is not available.");
    const teacherEmail = await requireTeacherEmail();
    const { submissionId } = await context.params;
    const attempts = await listAiGradingAttemptsForSubmission(submissionId, teacherEmail, 5);
    return NextResponse.json({ items: attempts.map(publicAttempt), latest: attempts[0] ? publicAttempt(attempts[0]) : null });
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> | { submissionId: string } }
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
    if (!isLocalMockAi(config) && config.accessMode === "paid") {
      const hasAiAccess = await getUserHasAiAccess(teacherEmail);
      if (!hasAiAccess) throw new HttpError(402, "AI grading requires an active AI billing plan.");
    }

    const { submissionId } = await context.params;
    const requestBody = request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as { enhanced?: unknown } | null)
      : null;
    const enhanced = requestBody?.enhanced === true;
    const data = await findSubmissionForAiGrade(submissionId, teacherEmail);
    if (!data) throw new HttpError(403, "You don't have access to this submission.");
    if (!data.audioBlobUrl) throw new HttpError(404, "No audio found for this submission.");

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

    if (!isLocalMockAi(config)) {
      const reserved = await reserveGenerationBudget({ config });
      if (!reserved) {
        throw new HttpError(429, "The monthly AI usage limit has been reached. Try again next month.");
      }
    }

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
      const attempts = await listAiGradingAttemptsForSubmission(submissionId, teacherEmail, 1);
      return NextResponse.json(
        {
          attempt: attempts[0] ? publicAttempt(attempts[0]) : null,
          error: outcome.message,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      attempt: publicAttempt(outcome.attempt),
      gradeApplied: outcome.gradeApplied,
    });
  });
}

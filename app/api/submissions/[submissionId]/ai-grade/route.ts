import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  countAiAttemptsForSubmission,
  countAiAttemptsForTeacherSince,
  countAiAttemptsSince,
  createAiGradingAttempt,
  findSubmissionForAiGrade,
  getUserIsPaid,
  hasAudioTooLongFailure,
  latestAiAttemptCreatedAt,
  listAiGradingAttemptsForSubmission,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { fetchAuthorizedAudioBuffer } from "@/lib/ai/audio";
import { reserveGenerationBudget } from "@/lib/ai/budget";
import { assertAiProviderConfig, getAiConfig, isAiTeacherDenied, isLocalMockAi } from "@/lib/ai/config";
import { toPublicAiError } from "@/lib/ai/errors";
import { gradeTranscript, transcribeAudio } from "@/lib/ai/providers";

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
    } catch {
      throw new HttpError(503, "AI grading is not fully configured.");
    }

    const teacherEmail = await requireTeacherEmail();
    if (isAiTeacherDenied(teacherEmail, config)) {
      throw new HttpError(403, "AI grading is not available for this account.");
    }
    if (!isLocalMockAi(config) && config.accessMode === "paid") {
      const isPaid = await getUserIsPaid(teacherEmail);
      if (!isPaid) throw new HttpError(402, "AI grading requires a paid plan.");
    }

    const { submissionId } = await context.params;
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

    try {
      const audio =
        config.transcriptionProvider === "mock"
          ? { buffer: Buffer.from("mock audio"), contentType: "audio/webm" }
          : await fetchAuthorizedAudioBuffer(data.audioBlobUrl);
      const transcript = await transcribeAudio({
        config,
        buffer: audio.buffer,
        contentType: audio.contentType,
      });

      if (transcript.durationSeconds > config.maxAudioSeconds) {
        await createAiGradingAttempt({
          submissionId,
          teacherEmail,
          status: "failed",
          transcript: transcript.transcript,
          detectedLanguage: transcript.detectedLanguage,
          transcriptQuality: transcript.quality,
          durationSeconds: transcript.durationSeconds,
          suggestedScore: null,
          rubricScores: [],
          feedback: "",
          strengths: [],
          improvements: [],
          evidence: [],
          confidence: "low",
          warnings: [],
          teacherAttention: "unable_to_grade",
          transcriptionProvider: config.transcriptionProvider,
          gradingProvider: config.gradingProvider,
          transcriptionModel: config.transcriptionModel,
          gradingModel: config.gradingModel,
          errorCode: "audio_too_long",
          errorMessage: `Audio is ${transcript.durationSeconds}s, which exceeds the ${config.maxAudioSeconds}s AI grading limit.`,
        });
        return NextResponse.json(
          { error: "This recording is longer than the AI grading limit and can't be graded." },
          { status: 413 }
        );
      }

      const suggestion = await gradeTranscript({
        config,
        description: data.description,
        instructions: data.instructions,
        rubric: data.rubric,
        maxPoints: data.maxPoints,
        transcript: transcript.transcript,
      });
      const attempt = await createAiGradingAttempt({
        submissionId,
        teacherEmail,
        status: "completed",
        transcript: transcript.transcript,
        detectedLanguage: transcript.detectedLanguage,
        transcriptQuality: transcript.quality,
        durationSeconds: transcript.durationSeconds,
        suggestedScore: suggestion.suggestedScore,
        rubricScores: suggestion.rubricScores,
        feedback: suggestion.feedback,
        strengths: suggestion.strengths,
        improvements: suggestion.improvements,
        evidence: suggestion.evidence,
        confidence: suggestion.confidence,
        warnings: suggestion.warnings,
        teacherAttention: suggestion.teacherAttention,
        transcriptionProvider: config.transcriptionProvider,
        gradingProvider: config.gradingProvider,
        transcriptionModel: config.transcriptionModel,
        gradingModel: config.gradingModel,
      });
      return NextResponse.json({ attempt: publicAttempt(attempt) });
    } catch (error) {
      const publicError = toPublicAiError(error);
      const failed = await createAiGradingAttempt({
        submissionId,
        teacherEmail,
        status: "failed",
        transcript: "",
        detectedLanguage: "",
        transcriptQuality: "",
        durationSeconds: 0,
        suggestedScore: null,
        rubricScores: [],
        feedback: "",
        strengths: [],
        improvements: [],
        evidence: [],
        confidence: "low",
        warnings: [],
        teacherAttention: "unable_to_grade",
        transcriptionProvider: config.transcriptionProvider,
        gradingProvider: config.gradingProvider,
        transcriptionModel: config.transcriptionModel,
        gradingModel: config.gradingModel,
        errorCode: publicError.code,
        errorMessage: publicError.message,
      });
      return NextResponse.json({ attempt: publicAttempt(failed), error: publicError.message }, { status: 502 });
    }
  });
}

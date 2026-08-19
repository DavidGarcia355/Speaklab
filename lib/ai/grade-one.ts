import "server-only";
import {
  createAiGradingAttempt,
  hasAudioTooLongFailure,
  type SubmissionForAiGradeRow,
} from "@/lib/db";
import { fetchAuthorizedAudioBuffer } from "@/lib/ai/audio";
import type { AiConfig } from "@/lib/ai/config";
import { toPublicAiError } from "@/lib/ai/errors";
import { gradeTranscript, transcribeAudio } from "@/lib/ai/providers";

export type GradeOneOutcome =
  | { status: "completed"; attemptId: string; teacherAttention: string; confidence: string }
  | { status: "skipped"; reason: "audio_too_long" | "no_audio" }
  | { status: "failed"; message: string };

/**
 * Produces one AI suggestion for one submission and records the attempt.
 *
 * This deliberately never writes to submissions.grade -- a suggestion is a
 * draft a teacher approves, not a grade. Both the single-submission route and
 * the bulk run share this so they cannot drift apart on that guarantee.
 */
export async function gradeOneSubmission(input: {
  config: AiConfig;
  teacherEmail: string;
  data: SubmissionForAiGradeRow;
}): Promise<GradeOneOutcome> {
  const { config, teacherEmail, data } = input;
  const submissionId = data.submissionId;

  if (!data.audioBlobUrl) return { status: "skipped", reason: "no_audio" };
  if (await hasAudioTooLongFailure(submissionId)) {
    return { status: "skipped", reason: "audio_too_long" };
  }

  const providerMeta = {
    transcriptionProvider: config.transcriptionProvider,
    gradingProvider: config.gradingProvider,
    transcriptionModel: config.transcriptionModel,
    gradingModel: config.gradingModel,
  };

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
        ...providerMeta,
        errorCode: "audio_too_long",
        errorMessage: `Audio is ${transcript.durationSeconds}s, which exceeds the ${config.maxAudioSeconds}s AI grading limit.`,
      });
      return { status: "skipped", reason: "audio_too_long" };
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
      ...providerMeta,
    });

    return {
      status: "completed",
      attemptId: attempt.id,
      teacherAttention: suggestion.teacherAttention,
      confidence: suggestion.confidence,
    };
  } catch (error) {
    const publicError = toPublicAiError(error);
    await createAiGradingAttempt({
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
      ...providerMeta,
      errorCode: publicError.code,
      errorMessage: publicError.message,
    });
    return { status: "failed", message: publicError.message };
  }
}

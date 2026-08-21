import "server-only";
import { createHash } from "node:crypto";
import {
  applyAiGradeToSubmission,
  createAiGradingAttempt,
  hasAudioTooLongFailure,
  markAiGradingAttemptBillingRequired,
  type AiGradingAttemptRow,
  type SubmissionForAiGradeRow,
} from "@/lib/db";
import { fetchAuthorizedAudioBuffer } from "@/lib/ai/audio";
import type { AiConfig } from "@/lib/ai/config";
import { toPublicAiError } from "@/lib/ai/errors";
import { transcribeAudio } from "@/lib/ai/providers";
import { runDirectAudioGradingPipeline } from "@/lib/grading/audio-pipeline";
import { getGradingConfig } from "@/lib/grading/config";
import {
  gradingResultToLegacySuggestion,
  legacyAssignmentToGradingAssignment,
  transcriptGradingInput,
} from "@/lib/grading/legacy-adapter";
import { runGradingPipeline } from "@/lib/grading/pipeline";
import { estimateTranscriptionCostMicrousd } from "@/lib/grading/pricing";
import { routeAudioGrading } from "@/lib/grading/routing";
import { createDatabaseGradingStore } from "@/lib/grading/store";
import { recordDeliveredAiUsageSafely } from "@/lib/billing";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";

const GEMINI_AUDIO_TOKENS_PER_SECOND = 32;

export type GradeOneOutcome =
  | {
      status: "completed";
      attemptId: string;
      attempt: AiGradingAttemptRow;
      teacherAttention: string;
      confidence: string;
      gradeApplied: boolean;
    }
  | { status: "skipped"; reason: "audio_too_long" | "no_audio" }
  | { status: "failed"; message: string };

type CachedTranscript = {
  kind: "transcript-v1";
  transcript: string;
  detectedLanguage: string;
  quality: string;
  durationSeconds: number;
};

function transcriptCacheKey(buffer: Buffer, contentType: string, provider: string, model: string) {
  return createHash("sha256")
    .update("transcript-v1\0", "utf8")
    .update(contentType.toLowerCase(), "utf8")
    .update("\0", "utf8")
    .update(provider, "utf8")
    .update("\0", "utf8")
    .update(model, "utf8")
    .update("\0", "utf8")
    .update(buffer)
    .digest("hex");
}

function parseCachedTranscript(value: unknown): CachedTranscript | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<CachedTranscript>;
  return item.kind === "transcript-v1" &&
    typeof item.transcript === "string" &&
    typeof item.detectedLanguage === "string" &&
    typeof item.quality === "string" &&
    typeof item.durationSeconds === "number"
    ? (item as CachedTranscript)
    : null;
}

async function saveTooLongAttempt(input: {
  data: SubmissionForAiGradeRow;
  teacherEmail: string;
  config: AiConfig;
  transcript: CachedTranscript;
  provider: string;
  model: string;
  costMicrousd?: number;
  latencyMs?: number;
}) {
  await createAiGradingAttempt({
    submissionId: input.data.submissionId,
    teacherEmail: input.teacherEmail,
    status: "failed",
    transcript: input.transcript.transcript,
    detectedLanguage: input.transcript.detectedLanguage,
    transcriptQuality: input.transcript.quality,
    durationSeconds: input.transcript.durationSeconds,
    suggestedScore: null,
    rubricScores: [],
    feedback: "",
    strengths: [],
    improvements: [],
    evidence: [],
    confidence: "low",
    warnings: [],
    teacherAttention: "unable_to_grade",
    transcriptionProvider: input.provider,
    gradingProvider: input.provider,
    transcriptionModel: input.model,
    gradingModel: input.model,
    errorCode: "audio_too_long",
    errorMessage: `Audio is ${input.transcript.durationSeconds}s, which exceeds the ${input.config.maxAudioSeconds}s AI grading limit.`,
    estimatedCostMicrousd: input.costMicrousd,
    latencyMs: input.latencyMs,
    resultSource: "failed",
  });
}

async function applyCompletedAiGrade(input: {
  data: SubmissionForAiGradeRow;
  teacherEmail: string;
  suggestion: {
    suggestedScore: number | null;
    rubricScores: AiGradingAttemptRow["rubricScores"];
    feedback: string;
    teacherAttention: string;
    autoApplicable: boolean;
  };
}) {
  if (
    input.data.finalGrade !== null ||
    input.suggestion.suggestedScore === null ||
    input.suggestion.teacherAttention === "unable_to_grade" ||
    !input.suggestion.autoApplicable
  ) {
    return false;
  }

  const rubricScores = input.data.rubric ? input.suggestion.rubricScores : null;
  if (
    input.data.rubric &&
    rubricScores?.length !== input.data.rubric.criteria.length
  ) {
    return false;
  }

  try {
    const updated = await applyAiGradeToSubmission(input.data.submissionId, input.teacherEmail, {
      grade: input.suggestion.suggestedScore,
      feedback: input.suggestion.feedback,
      rubricScores,
    });
    return Boolean(updated);
  } catch (error) {
    console.error("AI result was created but could not be applied to the submission", error);
    return false;
  }
}

function geminiAudioDurationSeconds(audioInputTokens: number) {
  if (!Number.isSafeInteger(audioInputTokens) || audioInputTokens <= 0) return 0;
  return audioInputTokens / GEMINI_AUDIO_TOKENS_PER_SECOND;
}

async function markAttemptBillableAfterApply(attemptId: string, teacherEmail: string) {
  try {
    return await markAiGradingAttemptBillingRequired({
      attemptId,
      ownerEmail: teacherEmail,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
    });
  } catch (error) {
    console.error("AI grade was applied but its billing marker could not be saved", error);
    return false;
  }
}

/**
 * Produces one auditable AI result and applies its whole-number score to an
 * ungraded submission. Teachers can still review and edit the saved grade.
 * The cost-aware direct-audio route is used only for supported containers, with
 * the established transcription route retained as a reliability fallback.
 */
export async function gradeOneSubmission(input: {
  config: AiConfig;
  teacherEmail: string;
  data: SubmissionForAiGradeRow;
  enhanced?: boolean;
}): Promise<GradeOneOutcome> {
  const { config, teacherEmail, data } = input;
  const submissionId = data.submissionId;

  if (!data.audioBlobUrl) return { status: "skipped", reason: "no_audio" };
  if (await hasAudioTooLongFailure(submissionId)) {
    return { status: "skipped", reason: "audio_too_long" };
  }

  const gradingConfig = getGradingConfig();
  const store = createDatabaseGradingStore();
  const baseProviderMeta = {
    transcriptionProvider: config.transcriptionProvider,
    gradingProvider: gradingConfig.defaultModel.provider,
    transcriptionModel: config.transcriptionModel,
    gradingModel: gradingConfig.defaultModel.model,
  };

  try {
    const audio =
      config.transcriptionProvider === "mock"
        ? { buffer: Buffer.from("mock audio"), contentType: "audio/webm" }
        : await fetchAuthorizedAudioBuffer(data.audioBlobUrl);
    const assignment = legacyAssignmentToGradingAssignment(data);
    const audioRoute = routeAudioGrading({
      config: gradingConfig,
      assignment,
      contentType: audio.contentType,
      byteLength: audio.buffer.byteLength,
      durationSeconds: config.maxAudioSeconds,
      enhanced: input.enhanced,
    });
    const routeWarnings: string[] = [];

    if (audioRoute.strategy === "gemini_direct") {
      try {
        const direct = await runDirectAudioGradingPipeline({
          config: gradingConfig,
          gradingInput: {
            submissionId,
            teacherEmail,
            assignment,
            enhanced: input.enhanced,
          },
          buffer: audio.buffer,
          contentType: audio.contentType,
          upload: audioRoute.upload === "files_api" ? "files_api" : "inline",
          initialModel: audioRoute.model,
          startsEscalated:
            audioRoute.model.provider === gradingConfig.audioEscalationModel.provider &&
            audioRoute.model.model === gradingConfig.audioEscalationModel.model,
          routingReasons: audioRoute.reasons,
          store,
        });
        const providerMeasuredDurationSeconds = geminiAudioDurationSeconds(
          direct.billableAudioInputTokens,
        );
        const durationForLimit =
          providerMeasuredDurationSeconds > 0
            ? providerMeasuredDurationSeconds
            : direct.durationSeconds;
        const transcript: CachedTranscript = {
          kind: "transcript-v1",
          transcript: direct.transcript,
          detectedLanguage: direct.detectedLanguage,
          quality: direct.transcriptQuality,
          durationSeconds: durationForLimit,
        };
        if (durationForLimit > config.maxAudioSeconds) {
          await saveTooLongAttempt({
            data,
            teacherEmail,
            config,
            transcript,
            provider: direct.provider,
            model: direct.model,
            costMicrousd: direct.estimatedCostMicrousd,
            latencyMs: direct.latencyMs,
          });
          return { status: "skipped", reason: "audio_too_long" };
        }
        const suggestion = gradingResultToLegacySuggestion({
          result: direct.result,
          data,
          source: direct.source === "direct_audio" ? "direct_audio" : direct.source,
        });
        const billingRequired =
          !direct.cacheHit &&
          direct.source !== "cache" &&
          suggestion.autoApplicable &&
          suggestion.suggestedScore !== null &&
          suggestion.teacherAttention !== "unable_to_grade" &&
          Boolean(direct.cacheKey);
        const attemptDurationSeconds = billingRequired
          ? providerMeasuredDurationSeconds
          : durationForLimit;
        const attempt = await createAiGradingAttempt({
          submissionId,
          teacherEmail,
          status: "completed",
          transcript: direct.transcript,
          detectedLanguage: direct.detectedLanguage,
          transcriptQuality: direct.transcriptQuality,
          durationSeconds: attemptDurationSeconds,
          ...suggestion,
          transcriptionProvider: direct.provider,
          gradingProvider: direct.provider,
          transcriptionModel: direct.model,
          gradingModel: direct.model,
          cacheKey: direct.cacheKey,
          cacheHit: direct.cacheHit,
          inputTokens: direct.usage.inputTokens,
          cachedInputTokens: direct.usage.cachedInputTokens,
          outputTokens: direct.usage.outputTokens,
          latencyMs: direct.latencyMs,
          retries: direct.retries,
          escalated: direct.escalated,
          escalationReason: direct.escalationReason,
          estimatedCostMicrousd: direct.estimatedCostMicrousd,
          promptVersion: gradingConfig.promptVersion,
          resultSource: direct.source,
          billingRequired: false,
          billingPriceBookId: TEACHER_AI_PRICE_BOOK.id,
          billableOutputTokens: 0,
        });
        const gradeApplied = await applyCompletedAiGrade({ data, teacherEmail, suggestion });
        const billingMarked =
          billingRequired && gradeApplied && direct.cacheKey
            ? await markAttemptBillableAfterApply(attempt.id, teacherEmail)
            : false;
        if (billingMarked) {
          await recordDeliveredAiUsageSafely({
            teacherEmail,
            cacheKey: direct.cacheKey,
            attemptId: attempt.id,
            submissionId,
            durationSeconds: providerMeasuredDurationSeconds,
          });
        }
        return {
          status: "completed",
          attemptId: attempt.id,
          attempt,
          teacherAttention: suggestion.teacherAttention,
          confidence: suggestion.confidence,
          gradeApplied,
        };
      } catch {
        routeWarnings.push("Direct audio grading failed; used transcription fallback.");
      }
    }

    const transcriptKey = transcriptCacheKey(
      audio.buffer,
      audio.contentType,
      config.transcriptionProvider,
      config.transcriptionModel
    );
    const cached = await store.findCached({ cacheKey: transcriptKey, teacherEmail, now: Date.now() });
    let transcript = parseCachedTranscript(cached?.result);
    let transcriptionCostMicrousd = 0;
    let transcriptionLatencyMs = 0;
    let transcriptCacheHit = Boolean(transcript);

    if (!transcript) {
      await store.assertProviderCallAllowed?.({
        teacherEmail,
        stage: "transcription",
        config: gradingConfig,
        now: Date.now(),
      });
      const transcriptionStartedAt = Date.now();
      const generated = await transcribeAudio({
        config,
        buffer: audio.buffer,
        contentType: audio.contentType,
      });
      transcriptionLatencyMs = Date.now() - transcriptionStartedAt;
      transcript = {
        kind: "transcript-v1",
        transcript: generated.transcript,
        detectedLanguage: generated.detectedLanguage,
        quality: generated.quality,
        durationSeconds: generated.durationSeconds,
      };
      const transcriptionCost = estimateTranscriptionCostMicrousd({
        provider: config.transcriptionProvider,
        model: config.transcriptionModel,
        durationSeconds: generated.durationSeconds,
        configuredUsdPerMinute: gradingConfig.transcriptionUsdPerMinute ?? undefined,
      });
      transcriptionCostMicrousd = transcriptionCost.totalMicrousd;
      await store.recordRequest({
        submissionId,
        teacherEmail,
        stage: "transcription",
        provider: config.transcriptionProvider,
        model: config.transcriptionModel,
        status: "completed",
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        latencyMs: transcriptionLatencyMs,
        retries: 0,
        escalated: false,
        escalationReason: "",
        estimatedCostMicrousd: transcriptionCostMicrousd,
        costKnown: transcriptionCost.costKnown,
        promptVersion: gradingConfig.promptVersion,
      });
      await store.saveCached({
        cacheKey: transcriptKey,
        submissionId,
        teacherEmail,
        result: transcript,
        provider: config.transcriptionProvider,
        model: config.transcriptionModel,
        promptVersion: "transcript-v1",
        now: Date.now(),
        expiresAt: Date.now() + gradingConfig.cacheTtlDays * 86_400_000,
      });
      transcriptCacheHit = false;
    }

    if (transcript.durationSeconds > config.maxAudioSeconds) {
      await saveTooLongAttempt({
        data,
        teacherEmail,
        config,
        transcript,
        provider: config.transcriptionProvider,
        model: config.transcriptionModel,
        costMicrousd: transcriptionCostMicrousd,
        latencyMs: transcriptionLatencyMs,
      });
      return { status: "skipped", reason: "audio_too_long" };
    }

    const pipeline = await runGradingPipeline(
      transcriptGradingInput({ data, teacherEmail, transcript: transcript.transcript, enhanced: input.enhanced }),
      { config: gradingConfig, store, enhanced: input.enhanced }
    );
    const reviewReasons = [
      audioRoute.requiresTeacherReview
        ? "This rubric requires audio-only evidence that a transcript grader cannot verify."
        : "",
      transcript.quality === "low" || transcript.quality === "poor"
        ? "Transcript quality is too low for an unassisted suggestion."
        : "",
    ].filter(Boolean);
    const suggestion = gradingResultToLegacySuggestion({
      result: pipeline.result,
      data,
      source: pipeline.source,
      failureCode: pipeline.failureCode,
      forceTeacherReviewReason: reviewReasons.join(" ") || undefined,
    });
    const billingRequired =
      !pipeline.cacheHit &&
      pipeline.source !== "cache" &&
      pipeline.source !== "deterministic" &&
      !pipeline.failureCode &&
      suggestion.autoApplicable &&
      suggestion.suggestedScore !== null &&
      suggestion.teacherAttention !== "unable_to_grade" &&
      Boolean(pipeline.cacheKey);
    const attempt = await createAiGradingAttempt({
      submissionId,
      teacherEmail,
      status: "completed",
      transcript: transcript.transcript,
      detectedLanguage: transcript.detectedLanguage,
      transcriptQuality: transcript.quality,
      durationSeconds: transcript.durationSeconds,
      ...suggestion,
      warnings: [...suggestion.warnings, ...routeWarnings],
      transcriptionProvider: config.transcriptionProvider,
      gradingProvider: pipeline.provider,
      transcriptionModel: config.transcriptionModel,
      gradingModel: pipeline.model,
      cacheKey: pipeline.cacheKey,
      cacheHit: pipeline.cacheHit && transcriptCacheHit,
      inputTokens: pipeline.usage.inputTokens,
      cachedInputTokens: pipeline.usage.cachedInputTokens,
      outputTokens: pipeline.usage.outputTokens,
      latencyMs: transcriptionLatencyMs + pipeline.latencyMs,
      retries: pipeline.retries,
      escalated: pipeline.escalated,
      escalationReason: pipeline.escalationReason,
      estimatedCostMicrousd: transcriptionCostMicrousd + pipeline.estimatedCostMicrousd,
      promptVersion: pipeline.promptVersion,
      resultSource: pipeline.source,
      billingRequired: false,
      billingPriceBookId: TEACHER_AI_PRICE_BOOK.id,
      billableOutputTokens: 0,
    });
    const gradeApplied = await applyCompletedAiGrade({ data, teacherEmail, suggestion });
    const billingMarked =
      billingRequired && gradeApplied && pipeline.cacheKey
        ? await markAttemptBillableAfterApply(attempt.id, teacherEmail)
        : false;
    if (billingMarked) {
      await recordDeliveredAiUsageSafely({
        teacherEmail,
        cacheKey: pipeline.cacheKey,
        attemptId: attempt.id,
        submissionId,
        durationSeconds: transcript.durationSeconds,
      });
    }

    return {
      status: "completed",
      attemptId: attempt.id,
      attempt,
      teacherAttention: suggestion.teacherAttention,
      confidence: suggestion.confidence,
      gradeApplied,
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
      ...baseProviderMeta,
      errorCode: publicError.code,
      errorMessage: publicError.message,
      promptVersion: gradingConfig.promptVersion,
      resultSource: "failed",
    });
    return { status: "failed", message: publicError.message };
  }
}

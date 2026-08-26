import "server-only";
import {
  copyConsumedReviewTranscriptToSubmission,
  createAiGradingAttempt,
  finalizeAiGradeDelivery,
  findSubmissionTranscriptByIdForOwner,
  findSubmissionTranscriptForOwner,
  findSubmissionTranscriptForOwnerBySemanticKey,
  getReusableAiReviewAttempt,
  hasAudioTooLongFailure,
  markAiGradingAttemptNotApplicable,
  releaseAiReviewAllowanceReservation,
  reserveAiReviewAllowance,
  withholdAiGradingAttemptResult,
  type AiGradingAttemptRow,
  type SubmissionForAiGradeRow,
  type SubmissionTranscriptRow,
} from "@/lib/db";
import { fetchAuthorizedAudioBuffer } from "@/lib/ai/audio";
import { reserveGenerationBudget } from "@/lib/ai/budget";
import { isLocalMockAi, type AiConfig } from "@/lib/ai/config";
import { toPublicAiError } from "@/lib/ai/errors";
import {
  processedAssignmentFingerprint,
  processedRecordingKey,
} from "@/lib/ai/recording-identity";
import { resolveSubmissionTranscript } from "@/lib/ai/transcript-one";
import { runDirectAudioGradingPipeline } from "@/lib/grading/audio-pipeline";
import { getGradingConfig } from "@/lib/grading/config";
import {
  gradingResultToLegacySuggestion,
  legacyAssignmentToGradingAssignment,
  transcriptGradingInput,
} from "@/lib/grading/legacy-adapter";
import { runGradingPipeline } from "@/lib/grading/pipeline";
import type { GradingPipelineStore } from "@/lib/grading/pipeline";
import { routeAudioGrading } from "@/lib/grading/routing";
import { createDatabaseGradingStore } from "@/lib/grading/store";
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
  | { status: "failed"; code: string; message: string };

type TranscriptSnapshot = {
  transcript: string;
  detectedLanguage: string;
  quality: string;
  durationSeconds: number;
};

async function saveTooLongAttempt(input: {
  data: SubmissionForAiGradeRow;
  teacherEmail: string;
  config: AiConfig;
  transcript: TranscriptSnapshot;
  provider: string;
  model: string;
  costMicrousd?: number;
  latencyMs?: number;
}) {
  await createAiGradingAttempt({
    submissionId: input.data.submissionId,
    teacherEmail: input.teacherEmail,
    status: "failed",
    // Over-limit audio is not a delivered review. Do not make its provider
    // transcript readable through legacy attempt fallbacks without consuming a
    // processed-recording unit.
    transcript: "",
    detectedLanguage: "",
    transcriptQuality: "",
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

async function finalizeCompletedAiGrade(input: {
  attemptId: string;
  data: SubmissionForAiGradeRow;
  teacherEmail: string;
  billingCandidate: boolean;
  allowUnmeteredAccess: boolean;
  reviewReservationId?: string;
  suggestion: {
    suggestedScore: number | null;
    rubricScores: AiGradingAttemptRow["rubricScores"];
    feedback: string;
    teacherAttention: string;
    autoApplicable: boolean;
  };
}) {
  const withholdResult = async (reason: string) => {
    try {
      await withholdAiGradingAttemptResult({
        attemptId: input.attemptId,
        ownerEmail: input.teacherEmail,
        reason,
      });
    } catch (error) {
      console.error("AI result visibility could not be finalized; it remains pending", error);
    }
    return {
      gradeApplied: false,
      billingMarked: false,
      resultVisible: false,
    };
  };

  if (
    input.suggestion.suggestedScore === null ||
    input.suggestion.teacherAttention === "unable_to_grade"
  ) {
    const marked = await markAiGradingAttemptNotApplicable({
      attemptId: input.attemptId,
      ownerEmail: input.teacherEmail,
      reviewReservationId: input.reviewReservationId,
    });
    if (!marked) {
      return withholdResult(
        input.reviewReservationId
          ? "AI-assisted recording allowance changed before transcript delivery."
          : "AI result disposition could not be persisted.",
      );
    }
    return {
      gradeApplied: false,
      billingMarked: false,
      resultVisible: true,
    };
  }

  if (!input.suggestion.autoApplicable) {
    const marked = await markAiGradingAttemptNotApplicable({
      attemptId: input.attemptId,
      ownerEmail: input.teacherEmail,
      reviewReservationId: input.reviewReservationId,
    });
    if (!marked) {
      return withholdResult(
        "AI-assisted recording allowance changed before delivery.",
      );
    }
    return {
      gradeApplied: false,
      billingMarked: false,
      resultVisible: true,
    };
  }

  if (input.data.finalGrade !== null) {
    return withholdResult("The submission was already graded before AI delivery.");
  }

  const rubricScores = input.data.rubric ? input.suggestion.rubricScores : null;
  if (
    input.data.rubric &&
    rubricScores?.length !== input.data.rubric.criteria.length
  ) {
    return withholdResult("The AI result did not match the assignment rubric.");
  }

  try {
    const result = await finalizeAiGradeDelivery({
      attemptId: input.attemptId,
      ownerEmail: input.teacherEmail,
      priceBookId: TEACHER_AI_PRICE_BOOK.id,
      billingCandidate: input.billingCandidate,
      allowUnmeteredAccess: input.allowUnmeteredAccess,
      reviewReservationId: input.reviewReservationId,
    });
    if (result.status !== "applied") {
      return withholdResult(`AI delivery was rejected: ${result.reason}.`);
    }
    return {
      gradeApplied: true,
      billingMarked: result.billingRequired,
      resultVisible: true,
    };
  } catch (error) {
    console.error(
      "AI result was created but its grade and billing marker could not be finalized",
      error,
    );
    return withholdResult("AI grade and billing finalization failed.");
  }
}

function geminiAudioDurationSeconds(audioInputTokens: number) {
  if (!Number.isSafeInteger(audioInputTokens) || audioInputTokens <= 0) return 0;
  return audioInputTokens / GEMINI_AUDIO_TOKENS_PER_SECOND;
}

async function deliverReusableAiReview(input: {
  source: AiGradingAttemptRow;
  data: SubmissionForAiGradeRow;
  teacherEmail: string;
}): Promise<GradeOneOutcome> {
  const { source, data, teacherEmail } = input;
  if (source.submissionId === data.submissionId && data.finalGrade !== null) {
    if (
      data.finalGrade === source.suggestedScore &&
      data.finalFeedback === source.feedback &&
      data.finalGradeSource === "ai" &&
      source.deliveryStatus === "delivered"
    ) {
      return {
        status: "completed",
        attemptId: source.id,
        attempt: source,
        teacherAttention: source.teacherAttention,
        confidence: source.confidence,
        gradeApplied: true,
      };
    }
    return {
      status: "failed",
      code: "submission_already_graded",
      message:
        "This submission's saved grade or feedback has changed. The AI result was not reapplied.",
    };
  }
  if (data.finalGrade !== null) {
    return {
      status: "failed",
      code: "submission_already_graded",
      message: "This submission already has a grade. The saved AI result was not applied.",
    };
  }
  const suggestion = {
    suggestedScore: source.suggestedScore,
    rubricScores: source.rubricScores,
    feedback: source.feedback,
    strengths: source.strengths,
    improvements: source.improvements,
    evidence: source.evidence,
    confidence: source.confidence,
    warnings: source.warnings,
    teacherAttention: source.teacherAttention,
    autoApplicable: source.deliveryStatus === "delivered",
  };
  const attempt = await createAiGradingAttempt({
    submissionId: data.submissionId,
    teacherEmail,
    status: "completed",
    transcript: source.transcript,
    detectedLanguage: source.detectedLanguage,
    transcriptQuality: source.transcriptQuality,
    durationSeconds: source.durationSeconds,
    ...suggestion,
    transcriptionProvider: source.transcriptionProvider,
    gradingProvider: source.gradingProvider,
    transcriptionModel: source.transcriptionModel,
    gradingModel: source.gradingModel,
    cacheKey: source.cacheKey,
    assignmentFingerprint: source.assignmentFingerprint,
    cacheHit: true,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    retries: 0,
    escalated: false,
    escalationReason: "",
    estimatedCostMicrousd: 0,
    promptVersion: source.promptVersion,
    resultSource: "allowance_duplicate",
    billingRequired: false,
    billingPriceBookId: TEACHER_AI_PRICE_BOOK.id,
    billableOutputTokens: 0,
  });
  const delivery = await finalizeCompletedAiGrade({
    attemptId: attempt.id,
    data,
    teacherEmail,
    suggestion,
    billingCandidate: false,
    allowUnmeteredAccess: true,
  });
  if (!delivery.resultVisible) {
    return {
      status: "failed",
      code: "result_not_delivered",
      message:
        "The submission changed before the saved AI result could be applied. No additional unit was used.",
    };
  }
  return {
    status: "completed",
    attemptId: attempt.id,
    attempt,
    teacherAttention: suggestion.teacherAttention,
    confidence: suggestion.confidence,
    gradeApplied: delivery.gradeApplied,
  };
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
  const baseStore = createDatabaseGradingStore();
  let providerBudgetReserved = isLocalMockAi(config);
  const ensureProviderBudget = async () => {
    if (providerBudgetReserved) return true;
    const reserved = await reserveGenerationBudget({ config });
    if (reserved) providerBudgetReserved = true;
    return reserved;
  };
  const store: GradingPipelineStore = {
    ...baseStore,
    assertProviderCallAllowed: async (request) => {
      await baseStore.assertProviderCallAllowed?.(request);
      if (!(await ensureProviderBudget())) {
        throw Object.assign(new Error("Provider budget exhausted."), {
          name: "AiProviderBudgetExhaustedError",
        });
      }
    },
  };
  const baseProviderMeta = {
    transcriptionProvider: config.transcriptionProvider,
    gradingProvider: gradingConfig.defaultModel.provider,
    transcriptionModel: config.transcriptionModel,
    gradingModel: gradingConfig.defaultModel.model,
  };
  let reviewReservationId: string | null = null;
  let consumedTranscriptSource: SubmissionTranscriptRow | null = null;

  try {
    const audio =
      config.transcriptionProvider === "mock"
        ? { buffer: Buffer.from("mock audio"), contentType: "audio/webm" }
        : await fetchAuthorizedAudioBuffer(data.audioBlobUrl);
    const assignment = legacyAssignmentToGradingAssignment(data);
    const deliveryCacheKey = processedRecordingKey(
      audio.buffer,
      audio.contentType,
      assignment,
    );
    const assignmentFingerprint = processedAssignmentFingerprint(assignment);
    const latestPersistedTranscript =
      await findSubmissionTranscriptForOwner(submissionId, teacherEmail);
    const exactPersistedTranscript =
      latestPersistedTranscript?.semanticKey === deliveryCacheKey
        ? latestPersistedTranscript
        : await findSubmissionTranscriptForOwnerBySemanticKey(
            submissionId,
            deliveryCacheKey,
            teacherEmail,
          );
    if (config.accessMode === "paid" && !isLocalMockAi(config)) {
      if (!deliveryCacheKey) {
        return {
          status: "failed",
          code: "review_identity_unavailable",
          message:
            "This recording could not be assigned a stable AI-assisted recording identity.",
        };
      }
      const reservation = await reserveAiReviewAllowance({
        teacherEmail,
        semanticKey: deliveryCacheKey,
      });
      if (reservation.reservationStatus === "subscription_unavailable") {
        return {
          status: "failed",
          code: "billing_sync_required",
          message:
            "Your billing period could not be verified. Refresh billing or contact support before using another AI-assisted recording.",
        };
      }
      if (reservation.reservationStatus === "exhausted") {
        return {
          status: "failed",
          code: "ai_review_limit_reached",
          message:
            reservation.status === "teacher_period"
              ? "This billing period's 300 AI-assisted recordings have been used. Recording, playback, and manual grading are still available. Need more? Explore TryHabla for Schools."
              : `Your ${reservation.limit} lifetime AI-assisted recordings have been used. Recording, playback, and manual grading are still available.`,
        };
      }
      if (reservation.reservationStatus === "in_flight") {
        return {
          status: "failed",
          code: "ai_review_in_progress",
          message: "This exact recording is already being reviewed. Try again shortly.",
        };
      }
      if (reservation.reservationStatus === "duplicate") {
        if (reservation.sourceKind === "transcript") {
          const sourceResultId =
            reservation.sourceResultId ?? reservation.sourceAttemptId;
          const source = await findSubmissionTranscriptByIdForOwner(
            sourceResultId,
            teacherEmail,
          );
          if (!source || source.semanticKey !== deliveryCacheKey) {
            return {
              status: "failed",
              code: "saved_review_unavailable",
              message:
                "The saved transcript could not be verified. Contact support before retrying.",
            };
          }
          consumedTranscriptSource = source;
          reviewReservationId = reservation.reservationId;
        } else {
          const source = await getReusableAiReviewAttempt({
            attemptId: reservation.sourceAttemptId,
            teacherEmail,
            semanticKey: deliveryCacheKey,
          });
          if (!source) {
            return {
              status: "failed",
              code: "saved_review_unavailable",
              message:
                "The saved AI result could not be verified. Contact support before retrying.",
            };
          }
          const durableTranscript =
            await copyConsumedReviewTranscriptToSubmission({
              reservationId: reservation.reservationId,
              sourceResultId:
                reservation.sourceResultId ?? reservation.sourceAttemptId,
              sourceKind: "grading",
              submissionId,
              teacherEmail,
              semanticKey: deliveryCacheKey,
              assignmentFingerprint,
            });
          if (!durableTranscript) {
            return {
              status: "failed",
              code: "saved_review_unavailable",
              message:
                "The saved transcript could not be verified. Contact support before retrying.",
            };
          }
          return deliverReusableAiReview({ source, data, teacherEmail });
        }
      }
      if (reservation.reservationStatus === "reserved") {
        reviewReservationId = reservation.reservationId;
      }
    }
    if (data.finalGrade !== null) {
      return {
        status: "failed",
        code: "submission_already_graded",
        message: "This submission already has a grade. AI did not replace it.",
      };
    }
    const audioRoute = routeAudioGrading({
      config: gradingConfig,
      assignment,
      contentType: audio.contentType,
      byteLength: audio.buffer.byteLength,
      durationSeconds: config.maxAudioSeconds,
      enhanced: input.enhanced,
    });
    const routeWarnings: string[] = [];
    const persistedTranscript =
      consumedTranscriptSource ??
      exactPersistedTranscript ??
      (latestPersistedTranscript?.assignmentFingerprint &&
      latestPersistedTranscript.assignmentFingerprint !== assignmentFingerprint
        ? latestPersistedTranscript
        : null);

    if (audioRoute.strategy === "gemini_direct" && !persistedTranscript) {
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
        const transcript: TranscriptSnapshot = {
          transcript: direct.transcript.trim(),
          detectedLanguage: direct.detectedLanguage,
          quality: direct.transcriptQuality,
          durationSeconds: durationForLimit,
        };
        if (!transcript.transcript) {
          throw new Error("Direct audio grading did not return a usable transcript.");
        }
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
          suggestion.autoApplicable &&
          suggestion.suggestedScore !== null &&
          suggestion.teacherAttention !== "unable_to_grade" &&
          Boolean(deliveryCacheKey);
        const attemptDurationSeconds = billingRequired
          ? providerMeasuredDurationSeconds > 0
            ? providerMeasuredDurationSeconds
            : direct.cacheHit || direct.source === "cache"
              ? durationForLimit
              : 0
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
          cacheKey: deliveryCacheKey,
          assignmentFingerprint,
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
        const { gradeApplied, resultVisible } = await finalizeCompletedAiGrade({
          attemptId: attempt.id,
          data,
          teacherEmail,
          suggestion,
          billingCandidate:
            false,
          allowUnmeteredAccess: config.accessMode === "all",
          reviewReservationId: reviewReservationId ?? undefined,
        });
        if (!resultVisible) {
          return {
            status: "failed",
            code: "result_not_delivered",
            message:
              "The submission or billing state changed before the AI result could be finalized. No AI result was delivered or billed.",
          };
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

    const transcript = await resolveSubmissionTranscript({
      config,
      gradingConfig,
      teacherEmail,
      submissionId,
      buffer: audio.buffer,
      contentType: audio.contentType,
      persisted: persistedTranscript,
      beforeProviderCall: isLocalMockAi(config) ? undefined : ensureProviderBudget,
    });
    const transcriptionCostMicrousd = transcript.estimatedCostMicrousd;
    const transcriptionLatencyMs = transcript.latencyMs;
    const transcriptCacheHit = transcript.cacheHit;

    if (!transcript.transcript.trim()) {
      return {
        status: "failed",
        code: "no_speech_detected",
        message: "No clear speech was detected. Record a longer response and try again.",
      };
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
      cacheKey: deliveryCacheKey,
      assignmentFingerprint,
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
    const { gradeApplied, resultVisible } = await finalizeCompletedAiGrade({
      attemptId: attempt.id,
      data,
      teacherEmail,
      suggestion,
      billingCandidate:
        false,
      allowUnmeteredAccess: config.accessMode === "all",
      reviewReservationId: reviewReservationId ?? undefined,
    });

    if (!resultVisible) {
      return {
        status: "failed",
        code: "result_not_delivered",
        message:
          "The submission or billing state changed before the AI result could be finalized. No AI result was delivered or billed.",
      };
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
    if (publicError.code === "provider_budget_exhausted") {
      return { status: "failed", code: publicError.code, message: publicError.message };
    }
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
    return { status: "failed", code: publicError.code, message: publicError.message };
  } finally {
    if (reviewReservationId) {
      try {
        await releaseAiReviewAllowanceReservation({
          reservationId: reviewReservationId,
          teacherEmail,
        });
      } catch (error) {
        console.error("AI review allowance reservation could not be released", error);
      }
    }
  }
}

import "server-only";

import {
  copyConsumedReviewTranscriptToSubmission,
  finalizeSubmissionTranscriptDelivery,
  findSubmissionTranscriptForOwner,
  findSubmissionTranscriptForOwnerBySemanticKey,
  getAiReviewAllowanceSummary,
  releaseAiReviewAllowanceReservation,
  reserveAiReviewAllowance,
  saveUnmeteredSubmissionTranscript,
  type AiReviewAllowanceSummary,
  type SubmissionForAiGradeRow,
  type SubmissionTranscriptRow,
} from "@/lib/db";
import { fetchAuthorizedAudioBuffer } from "@/lib/ai/audio";
import { reserveGenerationBudget } from "@/lib/ai/budget";
import { isLocalMockAi, type AiConfig } from "@/lib/ai/config";
import { toPublicTranscriptionError } from "@/lib/ai/errors";
import { transcribeAudio } from "@/lib/ai/providers";
import {
  processedAssignmentFingerprint,
  processedRecordingKey,
  transcriptCacheKey,
} from "@/lib/ai/recording-identity";
import { getGradingConfig, type GradingConfig } from "@/lib/grading/config";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";
import { estimateTranscriptionCostMicrousd } from "@/lib/grading/pricing";
import { createDatabaseGradingStore } from "@/lib/grading/store";

export type ResolvedTranscript = {
  transcript: string;
  detectedLanguage: string;
  quality: string;
  durationSeconds: number;
  provider: string;
  model: string;
  transcriptCacheKey: string;
  cacheHit: boolean;
  estimatedCostMicrousd: number;
  latencyMs: number;
};

type CachedTranscript = {
  kind: "transcript-v1";
  transcript: string;
  detectedLanguage: string;
  quality: string;
  durationSeconds: number;
};

export type TranscriptOneOutcome =
  | {
      status: "completed";
      item: SubmissionTranscriptRow;
      allowance: AiReviewAllowanceSummary | null;
    }
  | { status: "failed"; code: string; message: string };

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

function fromPersistedTranscript(
  row: SubmissionTranscriptRow,
  config: AiConfig,
): ResolvedTranscript {
  return {
    transcript: row.transcript,
    detectedLanguage: row.detectedLanguage,
    quality: row.transcriptQuality,
    durationSeconds: row.durationSeconds,
    provider: row.transcriptionProvider || config.transcriptionProvider,
    model: row.transcriptionModel || config.transcriptionModel,
    transcriptCacheKey: row.transcriptCacheKey,
    cacheHit: true,
    estimatedCostMicrousd: 0,
    latencyMs: 0,
  };
}

/**
 * Resolves one transcript from durable persistence, the expiring provider
 * cache, or one provider call. It does not consume a customer allowance; the
 * caller owns the delivery transaction.
 */
export async function resolveSubmissionTranscript(input: {
  config: AiConfig;
  gradingConfig?: GradingConfig;
  teacherEmail: string;
  submissionId: string;
  buffer: Buffer;
  contentType: string;
  persisted?: SubmissionTranscriptRow | null;
  beforeProviderCall?: () => Promise<boolean>;
}): Promise<ResolvedTranscript> {
  if (input.persisted?.transcript.trim()) {
    return fromPersistedTranscript(input.persisted, input.config);
  }

  const gradingConfig = input.gradingConfig ?? getGradingConfig();
  const store = createDatabaseGradingStore();
  const cacheKey = transcriptCacheKey(
    input.buffer,
    input.contentType,
    input.config.transcriptionProvider,
    input.config.transcriptionModel,
  );
  const cached = await store.findCached({
    cacheKey,
    teacherEmail: input.teacherEmail,
    now: Date.now(),
  });
  const cachedTranscript = parseCachedTranscript(cached?.result);
  if (cachedTranscript?.transcript.trim()) {
    return {
      transcript: cachedTranscript.transcript.trim(),
      detectedLanguage: cachedTranscript.detectedLanguage,
      quality: cachedTranscript.quality,
      durationSeconds: cachedTranscript.durationSeconds,
      provider: cached?.provider || input.config.transcriptionProvider,
      model: cached?.model || input.config.transcriptionModel,
      transcriptCacheKey: cacheKey,
      cacheHit: true,
      estimatedCostMicrousd: 0,
      latencyMs: 0,
    };
  }

  await store.assertProviderCallAllowed?.({
    teacherEmail: input.teacherEmail,
    stage: "transcription",
    config: gradingConfig,
    now: Date.now(),
  });
  if (input.beforeProviderCall && !(await input.beforeProviderCall())) {
    throw Object.assign(new Error("Provider budget exhausted."), {
      name: "TranscriptProviderBudgetExhaustedError",
    });
  }
  const startedAt = Date.now();
  const generated = await transcribeAudio({
    config: input.config,
    buffer: input.buffer,
    contentType: input.contentType,
  });
  const latencyMs = Date.now() - startedAt;
  const transcript = generated.transcript.trim();
  const estimated = estimateTranscriptionCostMicrousd({
    provider: input.config.transcriptionProvider,
    model: input.config.transcriptionModel,
    durationSeconds: generated.durationSeconds,
    configuredUsdPerMinute: gradingConfig.transcriptionUsdPerMinute ?? undefined,
  });
  await store.recordRequest({
    submissionId: input.submissionId,
    teacherEmail: input.teacherEmail,
    stage: "transcription",
    provider: input.config.transcriptionProvider,
    model: input.config.transcriptionModel,
    status: "completed",
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    latencyMs,
    retries: 0,
    escalated: false,
    escalationReason: "",
    estimatedCostMicrousd: estimated.totalMicrousd,
    costKnown: estimated.costKnown,
    promptVersion: gradingConfig.promptVersion,
  });
  if (transcript) {
    await store.saveCached({
      cacheKey,
      submissionId: input.submissionId,
      teacherEmail: input.teacherEmail,
      result: {
        kind: "transcript-v1",
        transcript,
        detectedLanguage: generated.detectedLanguage,
        quality: generated.quality,
        durationSeconds: generated.durationSeconds,
      } satisfies CachedTranscript,
      provider: input.config.transcriptionProvider,
      model: input.config.transcriptionModel,
      promptVersion: "transcript-v1",
      now: Date.now(),
      expiresAt: Date.now() + gradingConfig.cacheTtlDays * 86_400_000,
    });
  }
  return {
    transcript,
    detectedLanguage: generated.detectedLanguage,
    quality: generated.quality,
    durationSeconds: generated.durationSeconds,
    provider: input.config.transcriptionProvider,
    model: input.config.transcriptionModel,
    transcriptCacheKey: cacheKey,
    cacheHit: false,
    estimatedCostMicrousd: estimated.totalMicrousd,
    latencyMs,
  };
}

export async function transcribeOneSubmission(input: {
  config: AiConfig;
  teacherEmail: string;
  data: SubmissionForAiGradeRow;
}): Promise<TranscriptOneOutcome> {
  const { config, teacherEmail, data } = input;
  if (!data.audioBlobUrl) {
    return { status: "failed", code: "no_audio", message: "No audio found for this submission." };
  }

  let reservationId: string | null = null;
  try {
    const audio = isLocalMockAi(config)
      ? { buffer: Buffer.from("mock audio"), contentType: "audio/webm" }
      : await fetchAuthorizedAudioBuffer(data.audioBlobUrl);
    const assignment = legacyAssignmentToGradingAssignment(data);
    const semanticKey = processedRecordingKey(
      audio.buffer,
      audio.contentType,
      assignment,
    );
    const assignmentFingerprint = processedAssignmentFingerprint(assignment);
    if (!semanticKey) {
      return {
        status: "failed",
        code: "review_identity_unavailable",
        message: "This recording could not be assigned a stable processing identity.",
      };
    }
    const latestPersisted = await findSubmissionTranscriptForOwner(
      data.submissionId,
      teacherEmail,
    );
    const exactPersisted =
      latestPersisted?.semanticKey === semanticKey
        ? latestPersisted
        : await findSubmissionTranscriptForOwnerBySemanticKey(
            data.submissionId,
            semanticKey,
            teacherEmail,
          );
    const persisted =
      exactPersisted ??
      (latestPersisted?.assignmentFingerprint &&
      latestPersisted.assignmentFingerprint !== assignmentFingerprint
        ? latestPersisted
        : null);

    const metered = config.accessMode === "paid" && !isLocalMockAi(config);
    if (metered) {
      const reservation = await reserveAiReviewAllowance({ teacherEmail, semanticKey });
      if (reservation.reservationStatus === "subscription_unavailable") {
        return {
          status: "failed",
          code: "billing_sync_required",
          message:
            "Your billing period could not be verified. Refresh billing or contact support before processing another recording.",
        };
      }
      if (reservation.reservationStatus === "exhausted") {
        return {
          status: "failed",
          code: "ai_review_limit_reached",
          message:
            reservation.status === "teacher_period"
              ? "This billing period's 300 AI-assisted recordings have been used. Recording, playback, and manual grading are still available."
              : `Your ${reservation.limit} lifetime AI-assisted recordings have been used. Recording, playback, and manual grading are still available.`,
        };
      }
      if (reservation.reservationStatus === "in_flight") {
        return {
          status: "failed",
          code: "ai_review_in_progress",
          message: "This exact recording is already being processed. Try again shortly.",
        };
      }
      if (reservation.reservationStatus === "duplicate") {
        const saved = await copyConsumedReviewTranscriptToSubmission({
          reservationId: reservation.reservationId,
          sourceResultId: reservation.sourceResultId,
          sourceKind: reservation.sourceKind,
          submissionId: data.submissionId,
          teacherEmail,
          semanticKey,
          assignmentFingerprint,
        });
        if (!saved) {
          return {
            status: "failed",
            code: "saved_review_unavailable",
            message: "The saved transcript could not be verified. Contact support before retrying.",
          };
        }
        return {
          status: "completed",
          item: saved,
          allowance: await getAiReviewAllowanceSummary({ teacherEmail }),
        };
      }
      reservationId = reservation.reservationId;
    }

    const resolved = await resolveSubmissionTranscript({
      config,
      teacherEmail,
      submissionId: data.submissionId,
      buffer: audio.buffer,
      contentType: audio.contentType,
      persisted,
      beforeProviderCall: isLocalMockAi(config)
        ? undefined
        : () => reserveGenerationBudget({ config }),
    });
    if (!resolved.transcript.trim()) {
      return {
        status: "failed",
        code: "no_speech_detected",
        message: "No clear speech was detected. Record a longer response and try again.",
      };
    }
    if (resolved.durationSeconds > config.maxAudioSeconds) {
      return {
        status: "failed",
        code: "audio_too_long",
        message: `This recording is longer than the ${config.maxAudioSeconds}-second transcription limit.`,
      };
    }
    const value = {
      submissionId: data.submissionId,
      teacherEmail,
      semanticKey,
      assignmentFingerprint,
      transcriptCacheKey: resolved.transcriptCacheKey,
      transcript: resolved.transcript,
      detectedLanguage: resolved.detectedLanguage,
      transcriptQuality: resolved.quality,
      durationSeconds: resolved.durationSeconds,
      transcriptionProvider: resolved.provider,
      transcriptionModel: resolved.model,
      estimatedCostMicrousd: resolved.estimatedCostMicrousd,
      latencyMs: resolved.latencyMs,
    };
    const saved = reservationId
      ? await finalizeSubmissionTranscriptDelivery({ reservationId, value })
      : await saveUnmeteredSubmissionTranscript({ value });
    if (!saved) {
      return {
        status: "failed",
        code: "result_not_delivered",
        message:
          "The submission or allowance changed before the transcript could be saved. No processing unit was used.",
      };
    }
    return {
      status: "completed",
      item: saved,
      allowance: metered ? await getAiReviewAllowanceSummary({ teacherEmail }) : null,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "TranscriptProviderBudgetExhaustedError"
    ) {
      return {
        status: "failed",
        code: "provider_budget_exhausted",
        message: "The monthly AI usage limit has been reached. Try again next month.",
      };
    }
    const publicError = toPublicTranscriptionError(error);
    return { status: "failed", code: publicError.code, message: publicError.message };
  } finally {
    if (reservationId) {
      try {
        await releaseAiReviewAllowanceReservation({ reservationId, teacherEmail });
      } catch {
        console.warn("Transcript allowance reservation could not be released", {
          code: "transcript_allowance_release_failed",
        });
      }
    }
  }
}

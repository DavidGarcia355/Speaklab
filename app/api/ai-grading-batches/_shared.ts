import "server-only";
import type {
  AiGradingAttemptRow,
  AiGradingBatchItemRow,
  AiGradingBatchRow,
  AiReviewAllowanceSummary,
} from "@/lib/db";

export function publicAiReviewAllowance(allowance: AiReviewAllowanceSummary | null) {
  if (!allowance) return null;
  return {
    status: allowance.status,
    limit: allowance.limit,
    reserved: allowance.reserved,
    consumed: allowance.consumed,
    used: allowance.used,
    remaining: allowance.remaining,
    periodStart: allowance.periodStart,
    periodEnd: allowance.periodEnd,
  };
}

export function publicAiGradingAttempt(attempt: AiGradingAttemptRow | null) {
  if (!attempt) return null;
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

function publicAiGradingBatchItem(item: AiGradingBatchItemRow) {
  return {
    id: item.id,
    submissionId: item.submissionId,
    studentName: item.studentName,
    studentEmail: item.studentEmail,
    submittedAt: item.submittedAt,
    ordinal: item.ordinal,
    status: item.status,
    attemptId: item.attemptId,
    attempt: publicAiGradingAttempt(item.attempt),
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
    retryCount: item.retryCount,
    teacherEdited: item.teacherEdited,
    draft: item.draft,
    updatedAt: item.updatedAt,
  };
}

export function publicAiGradingBatch(batch: AiGradingBatchRow) {
  return {
    id: batch.id,
    assignmentId: batch.assignmentId,
    assignmentTitle: batch.assignmentTitle,
    assignmentFingerprint: batch.assignmentFingerprint,
    status: batch.status,
    eligibleCount: batch.eligibleCount,
    newUnitsRequired: batch.newUnitsRequired,
    transcriptsRequired: batch.transcriptsRequired,
    savedTranscripts: batch.savedTranscripts,
    enhanced: batch.enhanced,
    counts: batch.counts,
    items: batch.items.map(publicAiGradingBatchItem),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    completedAt: batch.completedAt,
    savedAt: batch.savedAt,
  };
}

export type PublicAiGradingBatch = ReturnType<typeof publicAiGradingBatch>;

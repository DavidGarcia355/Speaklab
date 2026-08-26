import "server-only";

import {
  claimAutomaticTranscriptionJobs,
  findAssignmentById,
  findOwnedSubmissionForAiReview,
  isAutomaticTranscriptionJobActive,
  settleAutomaticTranscriptionJob,
  type AutomaticTranscriptionJobRow,
} from "@/lib/db";
import {
  assertAiTranscriptionProviderConfig,
  getAiConfig,
  isAiTeacherDenied,
} from "@/lib/ai/config";
import { transcribeOneSubmission } from "@/lib/ai/transcript-one";

const MAX_ATTEMPTS = 4;
const PERMANENT_CODES = new Set([
  "audio_too_large",
  "audio_too_long",
  "no_audio",
  "no_speech_detected",
  "review_identity_unavailable",
  "audio_storage_migration_required",
]);
const PAUSED_CODES = new Set([
  "ai_review_limit_reached",
  "billing_sync_required",
  "provider_budget_exhausted",
  "usage_limit_reached",
  "provider_spend_limit",
  "provider_configuration",
  "provider_rate_limit",
]);

export type AutomaticTranscriptionRunSummary = {
  claimed: number;
  completed: number;
  retried: number;
  paused: number;
  failed: number;
  cancelled: number;
};

function retryAt(attemptCount: number) {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attemptCount - 1));
  return Date.now() + delayMinutes * 60_000;
}

async function settle(
  job: AutomaticTranscriptionJobRow,
  status: "completed" | "retry" | "paused" | "failed" | "cancelled",
  code = "",
) {
  return settleAutomaticTranscriptionJob({
    id: job.id,
    leaseToken: job.leaseToken,
    status,
    errorCode: code,
    nextAttemptAt:
      status === "retry"
        ? retryAt(job.attemptCount)
        : status === "paused"
          ? Date.now() + 60 * 60_000
          : undefined,
  });
}

async function processJob(job: AutomaticTranscriptionJobRow) {
  const assignment = await findAssignmentById(job.assignmentId, job.teacherEmail);
  if (!assignment || !assignment.autoTranscribe) {
    await settle(job, "cancelled", "automatic_transcription_disabled");
    return "cancelled" as const;
  }
  const data = await findOwnedSubmissionForAiReview(job.submissionId, job.teacherEmail);
  if (!data || data.assignmentId !== job.assignmentId) {
    await settle(job, "cancelled", "submission_unavailable");
    return "cancelled" as const;
  }

  const config = getAiConfig();
  if (!config.enabled || isAiTeacherDenied(job.teacherEmail, config)) {
    await settle(job, "paused", "automatic_transcription_unavailable");
    return "paused" as const;
  }
  try {
    assertAiTranscriptionProviderConfig(config);
  } catch {
    await settle(job, "paused", "automatic_transcription_unconfigured");
    return "paused" as const;
  }

  const outcome = await transcribeOneSubmission({
    config,
    teacherEmail: job.teacherEmail,
    data,
    processingStillAuthorized: () => isAutomaticTranscriptionJobActive({
      id: job.id,
      leaseToken: job.leaseToken,
    }),
  });
  if (outcome.status === "completed") {
    await settle(job, "completed");
    return "completed" as const;
  }
  if (PAUSED_CODES.has(outcome.code)) {
    await settle(job, "paused", outcome.code);
    return "paused" as const;
  }
  if (outcome.code === "processing_cancelled") {
    await settle(job, "cancelled", outcome.code);
    return "cancelled" as const;
  }
  if (PERMANENT_CODES.has(outcome.code) || job.attemptCount >= MAX_ATTEMPTS) {
    await settle(job, "failed", outcome.code);
    return "failed" as const;
  }
  await settle(job, "retry", outcome.code);
  return "retried" as const;
}

export async function processAutomaticTranscriptionJobs(input?: {
  limit?: number;
}): Promise<AutomaticTranscriptionRunSummary> {
  const jobs = await claimAutomaticTranscriptionJobs({ limit: input?.limit });
  const summary: AutomaticTranscriptionRunSummary = {
    claimed: jobs.length,
    completed: 0,
    retried: 0,
    paused: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const job of jobs) {
    try {
      const result = await processJob(job);
      summary[result] += 1;
    } catch {
      const terminal = job.attemptCount >= MAX_ATTEMPTS;
      await settle(job, terminal ? "failed" : "retry", "automatic_transcription_failed");
      summary[terminal ? "failed" : "retried"] += 1;
    }
  }
  return summary;
}

import { NextResponse } from "next/server";
import { publicAiGradingBatch } from "@/app/api/ai-grading-batches/_shared";
import { enqueueSuccessfulAiReviewAlerts } from "@/lib/admin-alert-lifecycle";
import { requireTeacherEmail } from "@/lib/authz";
import {
  claimNextAiGradingBatchItem,
  countAiAttemptsForSubmission,
  findAiGradingBatchForOwner,
  findSubmissionForAiGrade,
  findTeacherFunnelRowByEmail,
  getAiGradingAssignmentFingerprint,
  getAiReviewAllowanceSummary,
  hasAudioTooLongFailure,
  latestAiAttemptCreatedAt,
  markAiGradingBatchItemFailed,
  releaseAiDailyGenerationQuota,
  reserveAiDailyGenerationQuota,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import {
  assertAiProviderConfig,
  getAiConfig,
  isAiTeacherDenied,
  isLocalMockAi,
} from "@/lib/ai/config";
import { gradeOneSubmission } from "@/lib/ai/grade-one";
import { assertGradingProviderConfiguration, getGradingConfig } from "@/lib/grading/config";

export const runtime = "nodejs";
export const maxDuration = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

function quotaResponse(code: string, error: string, batch: unknown) {
  return NextResponse.json({ error, code, batch }, { status: 429 });
}

async function sendLifecycleAlert(input: {
  teacherEmail: string;
  attempt: Extract<Awaited<ReturnType<typeof gradeOneSubmission>>, { status: "completed" }>[
    "attempt"
  ];
}) {
  try {
    const config = getAiConfig();
    const [teacher, allowance] = await Promise.all([
      findTeacherFunnelRowByEmail(input.teacherEmail),
      config.accessMode === "paid" && !isLocalMockAi(config)
        ? getAiReviewAllowanceSummary({ teacherEmail: input.teacherEmail })
        : Promise.resolve(null),
    ]);
    await enqueueSuccessfulAiReviewAlerts({
      teacherEmail: input.teacherEmail,
      teacherJoinedAt: teacher?.joinedAt ?? input.attempt.createdAt,
      durationSeconds: input.attempt.durationSeconds,
      estimatedCostMicrousd: input.attempt.estimatedCostMicrousd,
      allowance,
      completedAt: input.attempt.completedAt ?? input.attempt.createdAt,
    });
  } catch {
    console.warn("Admin alert lifecycle check failed", {
      code: "ai_review_lifecycle_check_failed",
    });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const response = await withApiHandler(request, async () => {
    const config = getAiConfig();
    if (!config.enabled || !config.bulkEnabled) {
      throw new HttpError(404, "Batch AI grading is not available.");
    }
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
    const { batchId } = await context.params;
    const body = request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as { retryFailed?: unknown } | null)
      : null;
    const retryFailed = body?.retryFailed === true;
    let batch = await findAiGradingBatchForOwner(batchId, teacherEmail);
    if (!batch) throw new HttpError(404, "AI grading batch not found.");

    // Recompute from the live assignment on every worker invocation. Passing
    // the stored fingerprint here would let an edited rubric reuse stale work.
    const currentFingerprint = await getAiGradingAssignmentFingerprint(
      batch.assignmentId,
      teacherEmail,
    );
    if (!currentFingerprint || currentFingerprint !== batch.assignmentFingerprint) {
      const stale = await claimNextAiGradingBatchItem({
        batchId,
        teacherEmail,
        assignmentFingerprint: currentFingerprint || "deleted-assignment",
      });
      batch = (await findAiGradingBatchForOwner(batchId, teacherEmail)) ?? batch;
      return NextResponse.json(
        {
          error: "The assignment changed while AI suggestions were being prepared.",
          code: "assignment_changed",
          claimStatus: stale.status,
          batch: publicAiGradingBatch(batch),
        },
        { status: 409 },
      );
    }

    const quota = await reserveAiDailyGenerationQuota({
      teacherEmail,
      since: Date.now() - DAY_MS,
      dailyTeacherLimit: config.dailyTeacherLimit,
      dailyGlobalLimit: config.dailyGlobalLimit,
    });
    if (quota.status !== "reserved") {
      return quota.status === "teacher_limit"
        ? quotaResponse(
            "daily_teacher_limit",
            "Daily AI generation limit reached.",
            publicAiGradingBatch(batch),
          )
        : quotaResponse(
            "daily_global_limit",
            "Daily AI generation limit reached for the whole app. Try again tomorrow.",
            publicAiGradingBatch(batch),
          );
    }

    const reservationId = quota.reservationId;
    try {
    const claim = await claimNextAiGradingBatchItem({
      batchId,
      teacherEmail,
      assignmentFingerprint: currentFingerprint,
      retryFailed,
    });
    if (claim.status === "not_found") {
      throw new HttpError(404, "AI grading batch not found.");
    }
    if (claim.status === "assignment_changed") {
      batch = (await findAiGradingBatchForOwner(batchId, teacherEmail)) ?? batch;
      return NextResponse.json(
        {
          error: "The assignment changed while AI suggestions were being prepared.",
          code: "assignment_changed",
          batch: publicAiGradingBatch(batch),
        },
        { status: 409 },
      );
    }
    if (claim.status === "done") {
      batch = (await findAiGradingBatchForOwner(batchId, teacherEmail)) ?? batch;
      return NextResponse.json({
        processedItemId: null,
        done: true,
        batch: publicAiGradingBatch(batch),
      });
    }

    const claimed = claim.item;
    if (!claimed) {
      throw new HttpError(409, "The next batch item could not be claimed.");
    }
    const data = await findSubmissionForAiGrade(claimed.submissionId, teacherEmail);
    if (!data || data.assignmentId !== batch.assignmentId) {
      await markAiGradingBatchItemFailed({
        itemId: claimed.itemId,
        leaseToken: claimed.leaseToken,
        teacherEmail,
        status: "conflict",
        errorCode: "submission_changed",
        errorMessage: "This submission was changed or graded outside this batch.",
      });
    } else {
      const [attemptCount, latestAttempt] = await Promise.all([
        countAiAttemptsForSubmission(claimed.submissionId, teacherEmail),
        latestAiAttemptCreatedAt(claimed.submissionId, teacherEmail),
      ]);
      if (attemptCount >= config.maxGenerationsPerSubmission) {
        await markAiGradingBatchItemFailed({
          itemId: claimed.itemId,
          leaseToken: claimed.leaseToken,
          teacherEmail,
          status: "failed",
          errorCode: "submission_generation_limit",
          errorMessage: "AI generation limit reached for this submission.",
        });
      } else if (
        latestAttempt &&
        Date.now() - latestAttempt < config.cooldownSeconds * 1000
      ) {
        await markAiGradingBatchItemFailed({
          itemId: claimed.itemId,
          leaseToken: claimed.leaseToken,
          teacherEmail,
          status: "failed",
          errorCode: "generation_cooldown",
          errorMessage: "This submission was reviewed too recently. Retry it shortly.",
        });
      } else if (await hasAudioTooLongFailure(claimed.submissionId)) {
        await markAiGradingBatchItemFailed({
          itemId: claimed.itemId,
          leaseToken: claimed.leaseToken,
          teacherEmail,
          status: "skipped",
          errorCode: "audio_too_long",
          errorMessage: "This recording is longer than the AI grading limit.",
        });
      } else {
        const outcome = await gradeOneSubmission({
          config,
          teacherEmail,
          data,
          enhanced: claimed.enhanced,
          deliveryMode: "suggestion_only",
          batchSuggestion: {
            itemId: claimed.itemId,
            leaseToken: claimed.leaseToken,
          },
        });
        if (outcome.status === "completed") {
          if (
            outcome.attempt.suggestedScore !== null &&
            outcome.teacherAttention !== "unable_to_grade" &&
            outcome.attempt.resultSource !== "allowance_duplicate"
          ) {
            await sendLifecycleAlert({ teacherEmail, attempt: outcome.attempt });
          }
        } else {
          const skipped = outcome.status === "skipped";
          await markAiGradingBatchItemFailed({
            itemId: claimed.itemId,
            leaseToken: claimed.leaseToken,
            teacherEmail,
            status: skipped ? "skipped" : "failed",
            errorCode: skipped ? outcome.reason : outcome.code,
            errorMessage: skipped
              ? outcome.reason === "audio_too_long"
                ? "This recording is longer than the AI grading limit."
                : "No audio was found for this submission."
              : outcome.message,
          });
        }
      }
    }

    batch = (await findAiGradingBatchForOwner(batchId, teacherEmail)) ?? batch;
    const done = batch.counts.queued === 0 && batch.counts.processing === 0;
    return NextResponse.json({
      processedItemId: claimed.itemId,
      done,
      batch: publicAiGradingBatch(batch),
    });
    } finally {
      await releaseAiDailyGenerationQuota({ reservationId, teacherEmail }).catch(() => {
        console.warn("Daily AI generation quota lease release failed", {
          code: "daily_generation_quota_release_failed",
        });
      });
    }
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

import { NextResponse } from "next/server";
import {
  publicAiGradingBatch,
  publicAiReviewAllowance,
} from "@/app/api/ai-grading-batches/_shared";
import { requireTeacherEmail } from "@/lib/authz";
import {
  countAiAttemptsForTeacherSince,
  countAiAttemptsSince,
  createOrResumeAiGradingBatch,
  findActiveAiGradingBatchForAssignment,
  getAiGradingAssignmentFingerprint,
  getAiReviewAllowanceSummary,
  listUngradedSubmissionsForAiGrade,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import {
  assertAiProviderConfig,
  getAiConfig,
  isAiTeacherDenied,
  isLocalMockAi,
} from "@/lib/ai/config";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { assertGradingProviderConfiguration, getGradingConfig } from "@/lib/grading/config";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";
import {
  createAiBatchConfirmationToken,
  verifyAiBatchConfirmationToken,
  type AiBatchConfirmationScope,
} from "@/lib/ai/batch-confirmation";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };
type Candidate = Awaited<ReturnType<typeof listUngradedSubmissionsForAiGrade>>[number];

function requiresNewProcessedRecordingUnit(submission: Candidate) {
  const fingerprint = processedAssignmentFingerprint(
    legacyAssignmentToGradingAssignment(submission),
  );
  return !fingerprint || !submission.consumedTranscriptFingerprints.includes(fingerprint);
}

function hasCompletedAttemptForCurrentAssignment(submission: Candidate) {
  const fingerprint = processedAssignmentFingerprint(
    legacyAssignmentToGradingAssignment(submission),
  );
  return Boolean(
    fingerprint && submission.completedAttemptFingerprints.includes(fingerprint),
  );
}

async function remainingQuota(
  teacherEmail: string,
  dailyTeacherLimit: number,
  dailyGlobalLimit: number,
) {
  const since = Date.now() - DAY_MS;
  const [teacherUsed, globalUsed] = await Promise.all([
    countAiAttemptsForTeacherSince(teacherEmail, since),
    countAiAttemptsSince(since),
  ]);
  return {
    teacherRemaining: Math.max(0, dailyTeacherLimit - teacherUsed),
    globalRemaining: Math.max(0, dailyGlobalLimit - globalUsed),
    remaining: Math.max(
      0,
      Math.min(dailyTeacherLimit - teacherUsed, dailyGlobalLimit - globalUsed),
    ),
  };
}

function assertAvailableConfig() {
  const config = getAiConfig();
  if (!config.enabled) throw new HttpError(404, "AI grading is not available.");
  if (!config.bulkEnabled) throw new HttpError(404, "Batch AI grading is not available.");
  try {
    assertAiProviderConfig(config);
    assertGradingProviderConfiguration(getGradingConfig());
  } catch {
    throw new HttpError(503, "AI grading is not fully configured.");
  }
  return config;
}

async function batchContext(assignmentId: string, teacherEmail: string) {
  const assignmentFingerprint = await getAiGradingAssignmentFingerprint(
    assignmentId,
    teacherEmail,
  );
  if (!assignmentFingerprint) throw new HttpError(404, "Assignment not found.");
  const activeBatch = await findActiveAiGradingBatchForAssignment({
    assignmentId,
    teacherEmail,
    assignmentFingerprint,
  });
  return { assignmentFingerprint, activeBatch };
}

function confirmationScope(
  assignmentId: string,
  assignmentFingerprint: string,
  pending: Candidate[],
): AiBatchConfirmationScope {
  return {
    assignmentId,
    assignmentFingerprint,
    submissionIds: pending.map((item) => item.submissionId),
    eligibleCount: pending.length,
    newUnitsRequired: pending.filter(requiresNewProcessedRecordingUnit).length,
    transcriptsRequired: pending.filter((item) => !item.hasPersistedTranscript).length,
  };
}

function sameConfirmationScope(
  expected: AiBatchConfirmationScope,
  current: AiBatchConfirmationScope,
) {
  return (
    expected.assignmentId === current.assignmentId &&
    expected.assignmentFingerprint === current.assignmentFingerprint &&
    expected.eligibleCount === current.eligibleCount &&
    expected.newUnitsRequired === current.newUnitsRequired &&
    expected.transcriptsRequired === current.transcriptsRequired &&
    expected.submissionIds.length === current.submissionIds.length &&
    expected.submissionIds.every((id, index) => id === current.submissionIds[index])
  );
}

async function getPreflightPayload(input: {
  assignmentId: string;
  assignmentFingerprint: string;
  teacherEmail: string;
  config: ReturnType<typeof getAiConfig>;
  activeBatch: Awaited<ReturnType<typeof findActiveAiGradingBatchForAssignment>>;
}) {
  const pending = (
    await listUngradedSubmissionsForAiGrade(input.assignmentId, input.teacherEmail)
  ).filter((submission) => !hasCompletedAttemptForCurrentAssignment(submission));
  const scope = confirmationScope(
    input.assignmentId,
    input.assignmentFingerprint,
    pending,
  );
  const [quota, allowance] = await Promise.all([
    remainingQuota(
      input.teacherEmail,
      input.config.dailyTeacherLimit,
      input.config.dailyGlobalLimit,
    ),
    input.config.accessMode === "paid" && !isLocalMockAi(input.config)
      ? getAiReviewAllowanceSummary({ teacherEmail: input.teacherEmail })
      : Promise.resolve(null),
  ]);
  const allowanceReady = allowance?.status !== "subscription_unavailable";
  const allowanceRemaining = allowance?.remaining ?? Number.POSITIVE_INFINITY;
  return {
    assignmentId: input.assignmentId,
    ungradedCount: scope.eligibleCount,
    submissionIds: scope.submissionIds,
    newUnitsRequired: scope.newUnitsRequired,
    transcriptsRequired: scope.transcriptsRequired,
    savedTranscripts: Math.max(0, scope.eligibleCount - scope.transcriptsRequired),
    remaining: quota.remaining,
    fits:
      Boolean(input.activeBatch) ||
      (scope.eligibleCount > 0 &&
        scope.eligibleCount <= quota.remaining &&
        allowanceReady &&
        scope.newUnitsRequired <= allowanceRemaining),
    estimatedSeconds: scope.eligibleCount * input.config.cooldownSeconds,
    cooldownSeconds: input.config.cooldownSeconds,
    allowance: publicAiReviewAllowance(allowance),
    activeBatch: input.activeBatch
      ? publicAiGradingBatch(input.activeBatch)
      : null,
    confirmationToken: createAiBatchConfirmationToken({
      teacherEmail: input.teacherEmail,
      scope,
    }),
    confirmationScope: scope,
  };
}

/** Preflight only. No allowance or provider work is reserved here. */
export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const response = await withApiHandler(request, async () => {
    const config = assertAvailableConfig();
    const teacherEmail = await requireTeacherEmail();
    if (isAiTeacherDenied(teacherEmail, config)) {
      throw new HttpError(403, "AI grading is not available for this account.");
    }
    const { assignmentId } = await context.params;
    const { assignmentFingerprint, activeBatch } = await batchContext(
      assignmentId,
      teacherEmail,
    );
    return NextResponse.json(
      await getPreflightPayload({
        assignmentId,
        assignmentFingerprint,
        teacherEmail,
        config,
        activeBatch,
      }),
      { headers: PRIVATE_NO_STORE },
    );
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Creates or resumes a staged batch. It never writes student-visible grades. */
export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const response = await withApiHandler(request, async () => {
    const config = assertAvailableConfig();
    const teacherEmail = await requireTeacherEmail();
    if (isAiTeacherDenied(teacherEmail, config)) {
      throw new HttpError(403, "AI grading is not available for this account.");
    }
    const body = request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as {
          idempotencyKey?: unknown;
          confirmed?: unknown;
          enhanced?: unknown;
          confirmationToken?: unknown;
        } | null)
      : null;
    if (body?.confirmed !== true) {
      throw new HttpError(400, "Confirm the batch review before starting it.");
    }
    const idempotencyKey =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > 120) {
      throw new HttpError(400, "A valid idempotency key is required.");
    }
    const { assignmentId } = await context.params;
    const { assignmentFingerprint, activeBatch } = await batchContext(
      assignmentId,
      teacherEmail,
    );
    if (activeBatch) {
      return NextResponse.json({
        created: false,
        batch: publicAiGradingBatch(activeBatch),
      }, { headers: PRIVATE_NO_STORE });
    }

    const preflight = await getPreflightPayload({
      assignmentId,
      assignmentFingerprint,
      teacherEmail,
      config,
      activeBatch: null,
    });
    const suppliedScope =
      typeof body.confirmationToken === "string"
        ? verifyAiBatchConfirmationToken({
            token: body.confirmationToken,
            teacherEmail,
            assignmentId,
          })
        : null;
    if (!suppliedScope || !sameConfirmationScope(suppliedScope, preflight.confirmationScope)) {
      return NextResponse.json(
        {
          error:
            "The eligible submissions changed after confirmation. Review the updated batch details and confirm again.",
          code: "confirmation_scope_changed",
          preflight,
        },
        { status: 409, headers: PRIVATE_NO_STORE },
      );
    }
    if (preflight.ungradedCount === 0) {
      throw new HttpError(400, "There are no ungraded submissions with audio in this assignment.");
    }
    const newUnitsRequired = preflight.newUnitsRequired;
    const allowance = preflight.allowance;
    if (allowance?.status === "subscription_unavailable") {
      return NextResponse.json(
        {
          error: "The billing period could not be verified before starting this batch.",
          code: "billing_sync_required",
          eligibleCount: preflight.ungradedCount,
          requiredUnits: newUnitsRequired,
          availableUnits: 0,
          additionalUnits: newUnitsRequired,
          allowance,
        },
        { status: 409, headers: PRIVATE_NO_STORE },
      );
    }
    if (allowance && newUnitsRequired > allowance.remaining) {
      return NextResponse.json(
        {
          error: "This batch needs more AI-assisted recording units than are available.",
          code: "insufficient_allowance",
          eligibleCount: preflight.ungradedCount,
          requiredUnits: newUnitsRequired,
          availableUnits: allowance.remaining,
          additionalUnits: newUnitsRequired - allowance.remaining,
          allowance,
        },
        { status: 429, headers: PRIVATE_NO_STORE },
      );
    }
    if (preflight.ungradedCount > preflight.remaining) {
      return NextResponse.json(
        {
          error: "This batch exceeds the remaining daily AI generation limit.",
          code: "daily_generation_limit",
          eligibleCount: preflight.ungradedCount,
          requiredGenerations: preflight.ungradedCount,
          availableGenerations: preflight.remaining,
        },
        { status: 429, headers: PRIVATE_NO_STORE },
      );
    }

    const result = await createOrResumeAiGradingBatch({
      assignmentId,
      teacherEmail,
      assignmentFingerprint,
      idempotencyKey,
      expectedSubmissionIds: preflight.submissionIds,
      newUnitsRequired: preflight.newUnitsRequired,
      transcriptsRequired: preflight.transcriptsRequired,
      enhanced: body.enhanced === true,
    });
    if (result.status === "assignment_changed") {
      return NextResponse.json(
        {
          error: "The assignment changed before the batch was created. Review it and start again.",
          code: "assignment_changed",
        },
        { status: 409, headers: PRIVATE_NO_STORE },
      );
    }
    if (result.status === "scope_changed") {
      const fresh = await getPreflightPayload({
        assignmentId,
        assignmentFingerprint,
        teacherEmail,
        config,
        activeBatch: null,
      });
      return NextResponse.json(
        {
          error:
            "The eligible submissions changed after confirmation. Review the updated batch details and confirm again.",
          code: "confirmation_scope_changed",
          preflight: fresh,
        },
        { status: 409, headers: PRIVATE_NO_STORE },
      );
    }
    if (result.status === "empty" || !result.batch) {
      throw new HttpError(409, "Eligible submissions changed before the batch was created.");
    }
    return NextResponse.json(
      { created: result.created, batch: publicAiGradingBatch(result.batch) },
      { status: result.created ? 201 : 200, headers: PRIVATE_NO_STORE },
    );
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

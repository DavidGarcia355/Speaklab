import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  countAiAttemptsForTeacherSince,
  countAiAttemptsSince,
  getUserHasAiAccess,
  listUngradedSubmissionsForAiGrade,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { reserveGenerationBudget } from "@/lib/ai/budget";
import { assertAiProviderConfig, getAiConfig, isAiTeacherDenied, isLocalMockAi } from "@/lib/ai/config";
import { gradeOneSubmission } from "@/lib/ai/grade-one";
import { assertGradingProviderConfiguration, getGradingConfig } from "@/lib/grading/config";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

async function remainingQuota(teacherEmail: string, dailyTeacherLimit: number, dailyGlobalLimit: number) {
  const since = Date.now() - DAY_MS;
  const [teacherUsed, globalUsed] = await Promise.all([
    countAiAttemptsForTeacherSince(teacherEmail, since),
    countAiAttemptsSince(since),
  ]);
  return {
    teacherRemaining: Math.max(0, dailyTeacherLimit - teacherUsed),
    globalRemaining: Math.max(0, dailyGlobalLimit - globalUsed),
    remaining: Math.max(0, Math.min(dailyTeacherLimit - teacherUsed, dailyGlobalLimit - globalUsed)),
  };
}

/** How many ungraded submissions there are and whether a run would fit. */
export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    const config = getAiConfig();
    if (!config.enabled) throw new HttpError(404, "AI grading is not available.");
    if (!config.bulkEnabled) throw new HttpError(404, "Bulk AI grading is not available.");
    const teacherEmail = await requireTeacherEmail();
    const { assignmentId } = await context.params;

    const pending = await listUngradedSubmissionsForAiGrade(assignmentId, teacherEmail);
    const quota = await remainingQuota(teacherEmail, config.dailyTeacherLimit, config.dailyGlobalLimit);

    return NextResponse.json({
      ungradedCount: pending.length,
      remaining: quota.remaining,
      fits: pending.length > 0 && pending.length <= quota.remaining,
      estimatedSeconds: pending.length * config.cooldownSeconds,
    });
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    const config = getAiConfig();
    if (!config.enabled) throw new HttpError(404, "AI grading is not available.");
    if (!config.bulkEnabled) throw new HttpError(404, "Bulk AI grading is not available.");
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

    const { assignmentId } = await context.params;
    const requestBody = request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as { enhanced?: unknown } | null)
      : null;
    const enhanced = requestBody?.enhanced === true;
    const pending = await listUngradedSubmissionsForAiGrade(assignmentId, teacherEmail);
    if (pending.length === 0) {
      throw new HttpError(400, "There are no ungraded submissions with audio in this assignment.");
    }

    // Refuse a batch we cannot finish rather than stopping halfway through a
    // class and leaving the teacher to work out who did and did not get graded.
    const quota = await remainingQuota(teacherEmail, config.dailyTeacherLimit, config.dailyGlobalLimit);
    if (pending.length > quota.remaining) {
      throw new HttpError(
        429,
        `This would need ${pending.length} AI generations but only ${quota.remaining} remain today. ` +
          `Grade some by hand, or run this again tomorrow when the daily limit resets.`
      );
    }

    if (!isLocalMockAi(config)) {
      const reserved = await reserveGenerationBudget({
        config,
        generationCount: pending.length,
      });
      if (!reserved) {
        throw new HttpError(429, "The monthly AI usage limit has been reached. Try again next month.");
      }
    }

    const results: Array<{
      submissionId: string;
      studentName: string;
      status: string;
      teacherAttention?: string;
      confidence?: string;
      gradeApplied?: boolean;
      reason?: string;
      message?: string;
    }> = [];

    let completed = 0;
    let graded = 0;
    let skipped = 0;
    let failed = 0;

    for (const [index, data] of pending.entries()) {
      // Respect the same spacing the single-submission route enforces.
      if (index > 0 && config.cooldownSeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.cooldownSeconds * 1000));
      }

      const outcome = await gradeOneSubmission({ config, teacherEmail, data, enhanced });
      if (outcome.status === "completed") {
        completed += 1;
        if (outcome.gradeApplied) graded += 1;
        results.push({
          submissionId: data.submissionId,
          studentName: data.studentName,
          status: "completed",
          teacherAttention: outcome.teacherAttention,
          confidence: outcome.confidence,
          gradeApplied: outcome.gradeApplied,
        });
      } else if (outcome.status === "skipped") {
        skipped += 1;
        results.push({
          submissionId: data.submissionId,
          studentName: data.studentName,
          status: "skipped",
          reason: outcome.reason,
        });
      } else {
        failed += 1;
        results.push({
          submissionId: data.submissionId,
          studentName: data.studentName,
          status: "failed",
          message: outcome.message,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      total: pending.length,
      completed,
      graded,
      skipped,
      failed,
      // AI grades are saved immediately, but remain editable and visible for review.
      needsVerification: graded,
      results,
    });
  });
}

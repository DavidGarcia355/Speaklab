import { NextResponse } from "next/server";
import {
  publicAiGradingBatch,
  publicAiReviewAllowance,
} from "@/app/api/ai-grading-batches/_shared";
import { requireTeacherEmail } from "@/lib/authz";
import {
  findAiGradingBatchForOwner,
  getAiReviewAllowanceSummary,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { getAiConfig, isLocalMockAi } from "@/lib/ai/config";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const response = await withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { batchId } = await context.params;
    const config = getAiConfig();
    const [batch, allowance] = await Promise.all([
      findAiGradingBatchForOwner(batchId, teacherEmail),
      config.accessMode === "paid" && !isLocalMockAi(config)
        ? getAiReviewAllowanceSummary({ teacherEmail })
        : Promise.resolve(null),
    ]);
    if (!batch) throw new HttpError(404, "AI grading batch not found.");
    return NextResponse.json(
      {
        batch: publicAiGradingBatch(batch),
        allowance: publicAiReviewAllowance(allowance),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

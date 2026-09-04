import { NextResponse } from "next/server";
import { publicAiGradingBatch } from "@/app/api/ai-grading-batches/_shared";
import { requireTeacherEmail } from "@/lib/authz";
import { closeAiGradingBatch, findAiGradingBatchForOwner } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const response = await withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { batchId } = await context.params;
    const body = request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as { confirmed?: unknown } | null)
      : null;
    if (body?.confirmed !== true) {
      throw new HttpError(400, "Confirm before dismissing this AI grading batch.");
    }
    const result = await closeAiGradingBatch({ batchId, teacherEmail });
    if (result.status === "not_found") {
      throw new HttpError(404, "AI grading batch not found.");
    }
    const batch = await findAiGradingBatchForOwner(batchId, teacherEmail);
    if (!batch) throw new HttpError(404, "AI grading batch not found.");
    if (result.status === "not_terminal") {
      return NextResponse.json(
        {
          error: "Finish or stop the running items before dismissing this batch.",
          code: "batch_not_terminal",
          batch: publicAiGradingBatch(batch),
        },
        { status: 409, headers: PRIVATE_NO_STORE },
      );
    }
    if (result.status === "has_review_ready") {
      return NextResponse.json(
        {
          error:
            "This batch has completed AI suggestions. Review and save them before dismissing exceptions.",
          code: "batch_has_review_ready",
          batch: publicAiGradingBatch(batch),
        },
        { status: 409, headers: PRIVATE_NO_STORE },
      );
    }
    return NextResponse.json(
      {
        closed: result.status === "closed",
        batch: publicAiGradingBatch(batch),
      },
      { headers: PRIVATE_NO_STORE },
    );
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

import { NextResponse } from "next/server";
import { publicAiGradingBatch } from "@/app/api/ai-grading-batches/_shared";
import { requireTeacherEmail } from "@/lib/authz";
import {
  findAiGradingBatchForOwner,
  getAiGradingAssignmentFingerprint,
  saveAiGradingBatchDraft,
  type SaveAiGradingBatchItemInput,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

const PRIVATE_NO_STORE = "private, no-store";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const response = await withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { batchId } = await context.params;
    const body = request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as { items?: unknown } | null)
      : null;
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      throw new HttpError(400, "Include at least one valid review draft.");
    }

    const before = await findAiGradingBatchForOwner(batchId, teacherEmail);
    if (!before) throw new HttpError(404, "AI grading batch not found.");
    const currentFingerprint = await getAiGradingAssignmentFingerprint(
      before.assignmentId,
      teacherEmail,
    );
    if (!currentFingerprint || currentFingerprint !== before.assignmentFingerprint) {
      return NextResponse.json(
        {
          error: "The assignment changed after these suggestions were prepared.",
          code: "assignment_changed",
          batch: publicAiGradingBatch(before),
        },
        { status: 409 },
      );
    }

    const result = await saveAiGradingBatchDraft({
      batchId,
      teacherEmail,
      assignmentFingerprint: currentFingerprint,
      items: body.items as SaveAiGradingBatchItemInput[],
    });
    if (result.status === "not_found") {
      throw new HttpError(404, "AI grading batch not found.");
    }

    const batch = await findAiGradingBatchForOwner(batchId, teacherEmail);
    if (!batch) throw new HttpError(404, "AI grading batch not found.");
    if (result.status === "assignment_changed") {
      return NextResponse.json(
        {
          error: "The assignment changed after these suggestions were prepared.",
          code: "assignment_changed",
          batch: publicAiGradingBatch(batch),
        },
        { status: 409 },
      );
    }
    if (result.status === "not_ready") {
      return NextResponse.json(
        {
          error: "One or more suggestions are no longer ready for review.",
          code: "batch_draft_not_ready",
          batch: publicAiGradingBatch(batch),
        },
        { status: 409 },
      );
    }
    if (result.status === "invalid") {
      return NextResponse.json(
        {
          error: result.message,
          code: "invalid_batch_draft",
          batch: publicAiGradingBatch(batch),
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ batch: publicAiGradingBatch(batch) });
  });
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  return response;
}

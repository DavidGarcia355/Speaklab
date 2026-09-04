import { NextResponse } from "next/server";
import { publicAiGradingBatch } from "@/app/api/ai-grading-batches/_shared";
import { requireTeacherEmail } from "@/lib/authz";
import {
  findAiGradingBatchForOwner,
  getAiGradingAssignmentFingerprint,
  saveAiGradingBatch,
  type SaveAiGradingBatchItemInput,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const response = await withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { batchId } = await context.params;
    const body = request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as {
          confirmed?: unknown;
          items?: unknown;
        } | null)
      : null;
    if (body?.confirmed !== true || !Array.isArray(body.items)) {
      throw new HttpError(400, "Confirm and include every review-ready suggestion.");
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
    const result = await saveAiGradingBatch({
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
          error: result.message,
          code: "pending_items",
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
    if (result.status === "submission_changed") {
      return NextResponse.json(
        {
          error:
            "One or more submissions were graded or changed elsewhere. That teacher work was kept; review the remaining suggestions and save again.",
          code: "submission_changed",
          conflictItemIds: result.conflictItemIds,
          batch: publicAiGradingBatch(batch),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      saved: result.status === "saved",
      batch: publicAiGradingBatch(batch),
    });
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

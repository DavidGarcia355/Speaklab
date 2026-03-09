import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { deleteSubmission, findSubmissionById, updateSubmission } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { parseOrThrow400, submissionPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { submissionId } = await context.params;
    const existing = await findSubmissionById(submissionId);
    if (!existing) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    const body = parseOrThrow400(submissionPatchSchema, await request.json());
    const hasStudentName = typeof body.studentName !== "undefined";
    const hasGrade = Object.prototype.hasOwnProperty.call(body, "grade");
    const hasFeedback = typeof body.feedback !== "undefined";

    const studentName = hasStudentName ? body.studentName! : existing.studentName;
    const grade = hasGrade ? body.grade ?? null : existing.grade;
    const feedback = hasFeedback ? body.feedback ?? "" : existing.feedback;
    const updated = await updateSubmission(submissionId, { studentName, grade, feedback });
    return NextResponse.json({ item: updated });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { submissionId } = await context.params;
    const existing = await findSubmissionById(submissionId);
    if (!existing) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    const deleted = await deleteSubmission(submissionId);
    if (!deleted) {
      return NextResponse.json({ error: "Unable to delete submission." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  });
}

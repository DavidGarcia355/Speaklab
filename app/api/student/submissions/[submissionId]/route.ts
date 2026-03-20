import { NextResponse } from "next/server";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { deleteSubmissionByStudent } from "@/lib/db";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  return withApiHandler(request, async () => {
    const studentEmail = await requireSchoolStudentEmail();
    const { submissionId } = await context.params;

    const deleted = await deleteSubmissionByStudent(submissionId, studentEmail);
    if (!deleted) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}

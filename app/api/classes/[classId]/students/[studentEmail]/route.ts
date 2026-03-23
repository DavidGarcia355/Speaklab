import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { findClassById, listStudentAssignmentSummaries } from "@/lib/db";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ classId: string; studentEmail: string }> }
) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { classId, studentEmail } = await context.params;
    const decodedEmail = decodeURIComponent(studentEmail);
    const found = await findClassById(classId, teacherEmail);
    if (!found) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }
    const assignments = await listStudentAssignmentSummaries(classId, decodedEmail, teacherEmail);
    return NextResponse.json({ studentEmail: decodedEmail, assignments });
  });
}

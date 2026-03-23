import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { deleteRosterEntry, findClassById } from "@/lib/db";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(
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
    const deleted = await deleteRosterEntry(classId, decodedEmail, teacherEmail);
    if (!deleted) {
      return NextResponse.json({ error: "Student not found in roster." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}

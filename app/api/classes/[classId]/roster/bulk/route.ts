import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { bulkUpsertRosterEntries, findClassById, listRosterByClassId } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { parseOrThrow400, rosterBulkSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ classId: string }> }
) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { classId } = await context.params;
    const found = await findClassById(classId, teacherEmail);
    if (!found) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }
    const body = parseOrThrow400(rosterBulkSchema, await request.json());
    const { added, skipped } = await bulkUpsertRosterEntries(
      classId,
      body.students.map((s) => ({ studentEmail: s.email, studentName: s.name ?? "" }))
    );
    const items = await listRosterByClassId(classId, teacherEmail);
    return NextResponse.json({ items, added, skipped }, { status: 201 });
  });
}

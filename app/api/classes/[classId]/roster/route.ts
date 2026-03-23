import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { findClassById, listRosterByClassId, upsertRosterEntry } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { parseOrThrow400, rosterAddSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(
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
    const items = await listRosterByClassId(classId, teacherEmail);
    return NextResponse.json({ items });
  });
}

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
    const body = parseOrThrow400(rosterAddSchema, await request.json());
    const inserted = await upsertRosterEntry({
      classId,
      studentEmail: body.email,
      studentName: body.name ?? "",
      addedBy: "teacher",
    });
    if (!inserted) {
      return NextResponse.json({ error: "This student is already on the roster." }, { status: 409 });
    }
    const items = await listRosterByClassId(classId, teacherEmail);
    return NextResponse.json({ items }, { status: 201 });
  });
}

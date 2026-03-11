import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { createClass, listClassesByTeacher } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { classCreateSchema, parseOrThrow400 } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    return NextResponse.json({ items: await listClassesByTeacher(teacherEmail) });
  });
}

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const body = parseOrThrow400(classCreateSchema, await request.json());
    const name = body.name ?? "";
    const created = await createClass(name, teacherEmail);
    return NextResponse.json({ item: created }, { status: 201 });
  });
}

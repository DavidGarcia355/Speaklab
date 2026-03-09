import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { createClass, listClasses } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { classCreateSchema, parseOrThrow400 } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    return NextResponse.json({ items: await listClasses() });
  });
}

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const body = parseOrThrow400(classCreateSchema, await request.json());
    const name = body.name ?? "";
    const created = await createClass(name);
    return NextResponse.json({ item: created }, { status: 201 });
  });
}

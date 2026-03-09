import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { createAssignment, findClassById } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { assignmentCreateSchema, parseOrThrow400 } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ classId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { classId } = await context.params;
    const foundClass = await findClassById(classId);
    if (!foundClass) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const body = parseOrThrow400(assignmentCreateSchema, await request.json());
    const title = body.title ?? "";
    const description = body.description ?? "";
    const instructions = body.instructions ?? "";

    const created = await createAssignment({
      classId,
      title,
      description,
      instructions,
    });
    return NextResponse.json({ item: created }, { status: 201 });
  });
}

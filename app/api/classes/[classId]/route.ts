import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  deleteClassCascade,
  findClassById,
  listAssignmentsByClassId,
  listSubmissionsByClassId,
  updateClassName,
} from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { classUpdateSchema, parseOrThrow400 } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ classId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { classId } = await context.params;
    const found = await findClassById(classId);
    if (!found) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const assignments = await listAssignmentsByClassId(classId);
    const submissions = await listSubmissionsByClassId(classId);
    const submissionCount = assignments.reduce((sum, item) => sum + item.submissionCount, 0);

    return NextResponse.json({
      item: found,
      assignments,
      submissions,
      stats: {
        assignmentCount: assignments.length,
        submissionCount,
      },
    });
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ classId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { classId } = await context.params;
    const found = await findClassById(classId);
    if (!found) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const body = parseOrThrow400(classUpdateSchema, await request.json());
    const name = body.name ?? "";
    const updated = await updateClassName(classId, name);
    if (!updated) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }
    return NextResponse.json({ item: updated });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ classId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { classId } = await context.params;
    const found = await findClassById(classId);
    if (!found) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const deleted = await deleteClassCascade(classId);
    if (!deleted) {
      return NextResponse.json({ error: "Unable to delete class." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  });
}

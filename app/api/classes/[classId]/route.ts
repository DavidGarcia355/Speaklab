import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import {
  deleteClassCascade,
  findClassById,
  getUserDefaultLanguage,
  listAssignmentsByClassId,
  listSubmissionsByClassId,
  updateClassName,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { classUpdateSchema, parseOrThrow400 } from "@/lib/validation";

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

    const [assignments, submissions, teacherDefaultLanguage] = await Promise.all([
      listAssignmentsByClassId(classId, teacherEmail),
      listSubmissionsByClassId(classId, teacherEmail),
      getUserDefaultLanguage(teacherEmail),
    ]);
    const submissionCount = assignments.reduce((sum, item) => sum + item.submissionCount, 0);

    return NextResponse.json({
      item: found,
      assignments,
      submissions,
      teacherDefaultLanguage,
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
    const teacherEmail = await requireTeacherEmail();
    const { classId } = await context.params;
    const found = await findClassById(classId, teacherEmail);
    if (!found) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const body = parseOrThrow400(classUpdateSchema, await request.json());
    const name = body.name ?? "";
    let updated;
    try {
      updated = await updateClassName(classId, name, teacherEmail);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("already exists")) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
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
    const teacherEmail = await requireTeacherEmail();
    const { classId } = await context.params;
    const found = await findClassById(classId, teacherEmail);
    if (!found) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const deleted = await deleteClassCascade(classId, teacherEmail);
    if (!deleted) {
      return NextResponse.json({ error: "Unable to delete class." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  });
}

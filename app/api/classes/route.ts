import { NextResponse } from "next/server";
import { enqueueFirstClassCreatedAlert } from "@/lib/admin-alert-lifecycle";
import { buildTeacherEventMetadata, trackActivity } from "@/lib/activity";
import { requireTeacherEmail } from "@/lib/authz";
import { createClass, listClassesByTeacher } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
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
    let created;
    try {
      created = await createClass(name, teacherEmail);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("already exists")) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
    let isFirstClass = false;
    let teacherJoinedAt = created.createdAt;
    try {
      const metadata = await buildTeacherEventMetadata(teacherEmail);
      isFirstClass = metadata.isFirstClass;
      teacherJoinedAt = metadata.teacher?.joinedAt ?? created.createdAt;
    } catch (error) {
      console.warn("Failed to build class activity metadata", error);
    }
    await enqueueFirstClassCreatedAlert({
      teacherEmail,
      teacherJoinedAt,
      classCreatedAt: created.createdAt,
    });
    try {
      await trackActivity("class_created", teacherEmail, {
        classId: created.id,
        className: created.name,
        isFirstClass,
      });
    } catch (error) {
      console.warn("Failed to track class creation activity", error);
    }
    return NextResponse.json({ item: created }, { status: 201 });
  });
}

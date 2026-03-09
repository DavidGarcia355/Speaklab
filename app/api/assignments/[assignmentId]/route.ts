import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { deleteAssignmentCascade, findAssignmentById, updateAssignment } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { assignmentUpdateSchema, parseOrThrow400 } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { assignmentId } = await context.params;
    const found = await findAssignmentById(assignmentId);
    if (!found) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    return NextResponse.json({ item: found });
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { assignmentId } = await context.params;
    const found = await findAssignmentById(assignmentId);
    if (!found) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const body = parseOrThrow400(assignmentUpdateSchema, await request.json());
    const title = body.title ?? "";
    const instructions = body.instructions ?? "";
    const updated = await updateAssignment(assignmentId, { title, instructions });
    if (!updated) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }
    return NextResponse.json({ item: updated });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    await requireTeacherEmail();
    const { assignmentId } = await context.params;
    const found = await findAssignmentById(assignmentId);
    if (!found) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const deleted = await deleteAssignmentCascade(assignmentId);
    if (!deleted) {
      return NextResponse.json({ error: "Unable to delete assignment." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  });
}

import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { uploadAssignmentAttachment } from "@/lib/attachment-storage";
import { deleteAssignmentCascade, findAssignmentById, updateAssignment } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { assignmentUpdateSchema, parseAttachmentDataUrl, parseOrThrow400 } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { assignmentId } = await context.params;
    const found = await findAssignmentById(assignmentId, teacherEmail);
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
    const teacherEmail = await requireTeacherEmail();
    const { assignmentId } = await context.params;
    const found = await findAssignmentById(assignmentId, teacherEmail);
    if (!found) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const body = parseOrThrow400(assignmentUpdateSchema, await request.json());
    const title = body.title ?? "";
    const instructions = body.instructions ?? "";
    let attachmentName = found.attachmentName;
    let attachmentUrl = found.attachmentUrl;
    let attachmentContentType = found.attachmentContentType;

    if (body.attachment === null) {
      attachmentName = "";
      attachmentUrl = "";
      attachmentContentType = "";
    } else if (body.attachment) {
      const parsedAttachment = parseAttachmentDataUrl(body.attachment.dataUrl);
      attachmentName = body.attachment.fileName ?? "";
      attachmentContentType = parsedAttachment.mimeType;
      attachmentUrl = await uploadAssignmentAttachment({
        assignmentId,
        fileName: body.attachment.fileName ?? "attachment",
        mimeType: parsedAttachment.mimeType,
        buffer: parsedAttachment.buffer,
      });
    }

    const updated = await updateAssignment(assignmentId, teacherEmail, {
      title,
      instructions,
      attachmentName,
      attachmentUrl,
      attachmentContentType,
    });
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
    const teacherEmail = await requireTeacherEmail();
    const { assignmentId } = await context.params;
    const found = await findAssignmentById(assignmentId, teacherEmail);
    if (!found) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const deleted = await deleteAssignmentCascade(assignmentId, teacherEmail);
    if (!deleted) {
      return NextResponse.json({ error: "Unable to delete assignment." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  });
}

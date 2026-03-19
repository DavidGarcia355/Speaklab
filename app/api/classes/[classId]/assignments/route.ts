import { NextResponse } from "next/server";
import { buildTeacherEventMetadata, trackActivity } from "@/lib/activity";
import { requireTeacherEmail } from "@/lib/authz";
import { uploadAssignmentAttachment } from "@/lib/attachment-storage";
import { createAssignment, findClassById } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import {
  assignmentCreateSchema,
  parseAttachmentDataUrl,
  parseOrThrow400,
  rubricTotalPoints,
} from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ classId: string }> }
) {
  return withApiHandler(request, async () => {
    const teacherEmail = await requireTeacherEmail();
    const { classId } = await context.params;
    const foundClass = await findClassById(classId, teacherEmail);
    if (!foundClass) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const body = parseOrThrow400(assignmentCreateSchema, await request.json());
    const title = body.title ?? "";
    const description = body.description ?? "";
    const instructions = body.instructions ?? "";
    const rubric = body.rubric ?? null;
    const maxPoints = rubric ? rubricTotalPoints(rubric) : (body.maxPoints ?? 100);
    let attachmentName = "";
    let attachmentUrl = "";
    let attachmentContentType = "";

    if (body.attachment) {
      const parsedAttachment = parseAttachmentDataUrl(body.attachment.dataUrl);
      attachmentName = body.attachment.fileName ?? "";
      attachmentContentType = parsedAttachment.mimeType;
      attachmentUrl = await uploadAssignmentAttachment({
        assignmentId: `asg_${crypto.randomUUID()}`,
        fileName: body.attachment.fileName ?? "attachment",
        mimeType: parsedAttachment.mimeType,
        buffer: parsedAttachment.buffer,
      });
    } else if (body.existingAttachment) {
      attachmentName = body.existingAttachment.fileName ?? "";
      attachmentUrl = body.existingAttachment.url ?? "";
      attachmentContentType = body.existingAttachment.contentType ?? "";
    }

    const created = await createAssignment({
      classId,
      ownerEmail: teacherEmail,
      title,
      description,
      instructions,
      maxPoints,
      rubric,
      attachmentName,
      attachmentUrl,
      attachmentContentType,
    });
    let isFirstAssignment = false;
    try {
      const metadata = await buildTeacherEventMetadata(teacherEmail);
      isFirstAssignment = metadata.isFirstAssignment;
    } catch (error) {
      console.warn("Failed to build assignment activity metadata", error);
    }
    try {
      await trackActivity("assignment_created", teacherEmail, {
        assignmentId: created.id,
        assignmentTitle: created.title,
        classId,
        isFirstAssignment,
      });
    } catch (error) {
      console.warn("Failed to track assignment creation activity", error);
    }
    return NextResponse.json({ item: created }, { status: 201 });
  });
}

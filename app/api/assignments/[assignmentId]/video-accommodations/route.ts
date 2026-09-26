import { z } from "zod";
import { requireTeacherEmail } from "@/lib/authz";
import { findAssignmentById, listVideoAudioAccommodations, setVideoAudioAccommodation } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";

async function owned(context: { params: Promise<{ assignmentId: string }> }) {
  const teacherEmail = await requireTeacherEmail();
  const { assignmentId } = await context.params;
  if (!await findAssignmentById(assignmentId, teacherEmail)) throw new HttpError(404, "Assignment not found.");
  return { teacherEmail, assignmentId };
}
export async function GET(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  return withApiHandler(request, async () => {
    const { teacherEmail, assignmentId } = await owned(context);
    return Response.json({ emails: await listVideoAudioAccommodations(assignmentId, teacherEmail) });
  });
}
export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  return withApiHandler(request, async () => {
    const { teacherEmail, assignmentId } = await owned(context);
    const body = z.object({ studentEmail: z.email().max(254), allowed: z.boolean() }).safeParse(await request.json());
    if (!body.success) throw new HttpError(400, "Enter a valid student email.");
    await setVideoAudioAccommodation(assignmentId, teacherEmail, body.data.studentEmail, body.data.allowed);
    return Response.json({ emails: await listVideoAudioAccommodations(assignmentId, teacherEmail) });
  });
}

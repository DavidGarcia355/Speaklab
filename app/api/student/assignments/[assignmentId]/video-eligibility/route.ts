import { requireSchoolStudentEmail } from "@/lib/authz";
import { findAssignmentById, hasVideoAudioAccommodation } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { enforceStudentAssignmentAccessPolicy } from "@/lib/student-assignment-access";
export async function GET(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  return withApiHandler(request, async () => {
    const studentEmail = await requireSchoolStudentEmail();
    const { assignmentId } = await context.params;
    const assignment = await findAssignmentById(assignmentId);
    if (!assignment) throw new HttpError(404, "Assignment not found.");
    await enforceStudentAssignmentAccessPolicy({ classId: assignment.classId, ownerEmail: assignment.ownerEmail, studentEmail });
    return Response.json({ audioAccommodation: await hasVideoAudioAccommodation(assignmentId, studentEmail) });
  });
}

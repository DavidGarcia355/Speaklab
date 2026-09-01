import { NextResponse } from "next/server";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { countStudentSubmissions, findAssignmentById } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { enforceStudentAssignmentAccessPolicy } from "@/lib/student-assignment-access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    const studentEmail = await requireSchoolStudentEmail();
    const { assignmentId } = await context.params;

    const assignment = await findAssignmentById(assignmentId);
    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    await enforceStudentAssignmentAccessPolicy({
      classId: assignment.classId,
      ownerEmail: assignment.ownerEmail,
      studentEmail,
    });

    const count = await countStudentSubmissions(assignmentId, studentEmail);

    return NextResponse.json({
      count,
      maxSubmissions: assignment.maxSubmissions,
    });
  });
}

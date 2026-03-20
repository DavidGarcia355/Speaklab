import { NextResponse } from "next/server";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { listStudentAssignmentHistoryByEmail, listSubmissionsByStudentEmail } from "@/lib/db";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const studentEmail = await requireSchoolStudentEmail();
    const [items, assignments] = await Promise.all([
      listSubmissionsByStudentEmail(studentEmail),
      listStudentAssignmentHistoryByEmail(studentEmail),
    ]);
    return NextResponse.json({ items, assignments });
  });
}

import { NextResponse } from "next/server";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { listSubmissionsByStudentEmail } from "@/lib/db";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const studentEmail = await requireSchoolStudentEmail();
    const items = await listSubmissionsByStudentEmail(studentEmail);
    return NextResponse.json({ items });
  });
}

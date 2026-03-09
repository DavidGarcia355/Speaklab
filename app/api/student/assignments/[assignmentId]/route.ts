import { NextResponse } from "next/server";
import { findAssignmentById } from "@/lib/db";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    const { assignmentId } = await context.params;
    const found = await findAssignmentById(assignmentId);
    if (!found) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }
    return NextResponse.json({ item: found });
  });
}

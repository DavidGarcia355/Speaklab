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
    // Strip sensitive fields and storage references before returning to students.
    const { ownerEmail, attachmentUrl, ...safeItem } = found;
    void ownerEmail;
    return NextResponse.json({
      item: {
        ...safeItem,
        attachmentUrl: attachmentUrl
          ? `/api/assignments/${encodeURIComponent(found.id)}/attachment`
          : "",
      },
    });
  });
}

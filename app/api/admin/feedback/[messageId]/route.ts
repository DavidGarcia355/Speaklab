import { NextResponse } from "next/server";
import { requireAdminEmail } from "@/lib/admin";
import { deleteFeedbackMessage } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  return withApiHandler(request, async () => {
    const { allowed } = await requireAdminEmail();
    if (!allowed) throw new HttpError(403, "Forbidden");
    const { messageId } = await context.params;
    const deleted = await deleteFeedbackMessage(messageId);
    if (!deleted) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}

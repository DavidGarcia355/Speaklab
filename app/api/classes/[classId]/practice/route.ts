import { NextResponse } from "next/server";
import { requireTeacherEmail } from "@/lib/authz";
import { findClassById, listPracticeSubmissions } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { getAiConfig, isAiTeacherDenied } from "@/lib/ai/config";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  return withApiHandler(request, async () => {
    const email = await requireTeacherEmail();
    const { classId } = await context.params;
    const classroom = await findClassById(classId, email);
    if (!classroom) throw new HttpError(404, "Class not found.");
    const items = await listPracticeSubmissions(classId, email);
    const config = getAiConfig();
    return NextResponse.json({ items, class: { id: classroom.id, name: classroom.name }, transcriptionEnabled: config.enabled && !isAiTeacherDenied(email, config) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

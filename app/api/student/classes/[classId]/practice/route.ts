import { NextResponse } from "next/server";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { requireStudentPracticeClass } from "@/lib/practice-access";
import { listSubmissionsByStudentEmail } from "@/lib/db";
import { withApiHandler } from "@/lib/http";
import { enforceSubmissionRateLimit } from "@/lib/rate-limit";
import { parseOrThrow400, practiceCreateSchema } from "@/lib/validation";
import { storeRecording } from "@/lib/store-recording";
import { HARD_MAX_RECORDING_SECONDS } from "@/lib/audio-duration";

export const runtime = "nodejs";
type Context = { params: Promise<{ classId: string }> };
export async function GET(request: Request, context: Context) {
  return withApiHandler(request, async () => {
    const email = await requireSchoolStudentEmail();
    const { classId } = await context.params;
    const classroom = await requireStudentPracticeClass(classId, email);
    const items = (await listSubmissionsByStudentEmail(email)).filter(s => s.practiceClassId === classId);
    return NextResponse.json({ class: { id: classroom.id, name: classroom.name }, items }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
export async function POST(request: Request, context: Context) {
  return withApiHandler(request, async () => {
    const email = await requireSchoolStudentEmail();
    const { classId } = await context.params;
    await requireStudentPracticeClass(classId, email);
    await enforceSubmissionRateLimit(email);
    const body = parseOrThrow400(practiceCreateSchema, await request.json());
    const item = await storeRecording({
      assignmentId: null, practiceClassId: classId, practiceTitle: body.title, practiceNote: body.note,
      studentEmail: email, studentName: body.studentName ?? "", audioData: body.audioData,
      maxRecordingSeconds: HARD_MAX_RECORDING_SECONDS,
    });
    return NextResponse.json({ item }, { status: 201 });
  });
}

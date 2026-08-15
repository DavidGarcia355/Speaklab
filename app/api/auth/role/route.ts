import { NextResponse } from "next/server";
import { trackActivity } from "@/lib/activity";
import { requireAuthenticatedEmail } from "@/lib/authz";
import { getUserRoleByEmail, setUserRoleTeacher } from "@/lib/db";
import { sendTeacherUpgradeConfirmationEmail } from "@/lib/email";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

function getTeacherAllowlist() {
  return new Set(
    (process.env.TEACHER_ALLOWLIST ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function canSelfRegisterTeacher(email: string) {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.ALLOW_TEACHER_SELF_REGISTRATION === "true") return true;
  return getTeacherAllowlist().has(email.trim().toLowerCase());
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const role = await getUserRoleByEmail(email);
    return NextResponse.json({ email, role });
  });
}

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const body = (await request.json()) as { role?: string };

    if (body.role !== "teacher") {
      throw new HttpError(400, "Only teacher self-registration is supported right now.");
    }

    const currentRole = await getUserRoleByEmail(email);
    if (currentRole !== "teacher" && !canSelfRegisterTeacher(email)) {
      throw new HttpError(403, "Teacher account setup is currently limited. Contact Habla to request access.");
    }

    await setUserRoleTeacher(email);
    try {
      await trackActivity("teacher_upgraded", email);
    } catch (error) {
      console.warn("Failed to track teacher upgrade activity", error);
    }
    try {
      sendTeacherUpgradeConfirmationEmail(email);
    } catch (error) {
      console.warn("Failed to queue teacher upgrade email", error);
    }
    const role = await getUserRoleByEmail(email);
    return NextResponse.json({ email, role });
  });
}

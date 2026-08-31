import { NextResponse } from "next/server";
import { enqueueTeacherSignedUpAlert } from "@/lib/admin-alert-lifecycle";
import { trackActivity } from "@/lib/activity";
import { logAuthDiagnostic } from "@/lib/auth-diagnostics";
import { classifyAuthBrowser } from "@/lib/auth-diagnostics-shared";
import { requireAuthenticatedEmail } from "@/lib/authz";
import { getUserRoleByEmail, setUserRoleTeacher } from "@/lib/db";
import { sendTeacherUpgradeConfirmationEmail } from "@/lib/email";
import { HttpError, withApiHandler } from "@/lib/http";
import { isTeacherSelfRegistrationEnabled } from "@/lib/teacher-registration-policy.mjs";

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
  if (isTeacherSelfRegistrationEnabled()) return true;
  return getTeacherAllowlist().has(email.trim().toLowerCase());
}

function logRegistrationUnavailable(
  request: Request,
  event: "registration_denied" | "registration_unavailable_presented"
) {
  logAuthDiagnostic(
    event,
    {
      browserCategory: classifyAuthBrowser(request.headers.get("user-agent")),
      code: "self_registration_closed",
      method: request.method === "POST" ? "POST" : "GET",
      route: "/teacher/register",
    },
    "warn"
  );
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const role = await getUserRoleByEmail(email);
    const teacherRegistrationAvailable = role === "teacher" || canSelfRegisterTeacher(email);
    if (!teacherRegistrationAvailable) {
      logRegistrationUnavailable(request, "registration_unavailable_presented");
    }
    return NextResponse.json({
      email,
      role,
      teacherRegistrationAvailable,
    });
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
      logRegistrationUnavailable(request, "registration_denied");
      throw new HttpError(
        403,
        "Teacher account setup is unavailable for this account. Contact TryHabla support.",
      );
    }

    await setUserRoleTeacher(email);
    if (currentRole !== "teacher") {
      await enqueueTeacherSignedUpAlert({ teacherEmail: email, source: "direct" });
    }
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

import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

function isLocalAuthBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH !== "false";
}

export function isTeacherEmail(email: string) {
  if (isLocalAuthBypassEnabled()) {
    return true;
  }
  return getEnv().teacherEmails.has(email.trim().toLowerCase());
}

export async function requireAuthenticatedEmail() {
  if (isLocalAuthBypassEnabled()) {
    return "dev-teacher@local.test";
  }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpError(401, "Authentication required.");
  }
  return email;
}

export async function requireSchoolStudentEmail() {
  if (isLocalAuthBypassEnabled()) {
    return "dev-student@gmail.com";
  }
  return requireAuthenticatedEmail();
}

export async function requireTeacherEmail() {
  if (isLocalAuthBypassEnabled()) {
    return "dev-teacher@local.test";
  }
  const email = await requireAuthenticatedEmail();
  if (!isTeacherEmail(email)) {
    throw new HttpError(403, "Teacher access only.");
  }
  return email;
}

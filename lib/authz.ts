import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getUserRoleByEmail, type UserRole } from "@/lib/db";
import { HttpError } from "@/lib/http";

let hasWarnedAboutProductionBypass = false;

function isLocalAuthBypassEnabled() {
  const bypassEnabled = process.env.LOCAL_DEV_BYPASS_AUTH === "true";
  if (bypassEnabled && process.env.NODE_ENV === "production" && !hasWarnedAboutProductionBypass) {
    hasWarnedAboutProductionBypass = true;
    console.warn("WARNING: LOCAL_DEV_BYPASS_AUTH is enabled in production — auth is disabled");
  }
  return process.env.NODE_ENV !== "production" && bypassEnabled;
}

export async function requireAuthenticatedEmail() {
  if (isLocalAuthBypassEnabled()) {
    return "dev-teacher@local.test";
  }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpError(401, "You'll need to sign in first.");
  }
  return email;
}

export async function requireSchoolStudentEmail() {
  if (isLocalAuthBypassEnabled()) {
    return "dev-student@gmail.com";
  }
  return requireAuthenticatedEmail();
}

export async function requireRole(expectedRole: UserRole) {
  if (isLocalAuthBypassEnabled()) {
    return "dev-teacher@local.test";
  }
  const email = await requireAuthenticatedEmail();
  const role = await getUserRoleByEmail(email);
  if (role !== expectedRole) {
    throw new HttpError(403, "You don't have access to this page.");
  }
  return email;
}

export async function requireTeacherEmail() {
  return requireRole("teacher");
}

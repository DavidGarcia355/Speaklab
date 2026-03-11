import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getUserRoleByEmail, setUserRoleTeacher } from "@/lib/db";
import { HttpError } from "@/lib/http";

function isLocalAuthBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH !== "false";
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

export async function requireTeacherEmail() {
  if (isLocalAuthBypassEnabled()) {
    return "dev-teacher@local.test";
  }
  const email = await requireAuthenticatedEmail();
  const role = await getUserRoleByEmail(email);
  if (role !== "teacher") {
    await setUserRoleTeacher(email);
  }
  return email;
}

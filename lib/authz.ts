import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

export function isAllowedSchoolEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const { schoolGoogleDomain } = getEnv();
  return normalized.endsWith(`@${schoolGoogleDomain}`);
}

export function isTeacherEmail(email: string) {
  return getEnv().teacherEmails.has(email.trim().toLowerCase());
}

export async function requireAuthenticatedEmail() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpError(401, "Authentication required.");
  }
  return email;
}

export async function requireSchoolStudentEmail() {
  const email = await requireAuthenticatedEmail();
  if (!isAllowedSchoolEmail(email)) {
    throw new HttpError(403, "School Google account is required.");
  }
  return email;
}

export async function requireTeacherEmail() {
  const email = await requireAuthenticatedEmail();
  if (!isTeacherEmail(email)) {
    throw new HttpError(403, "Teacher access only.");
  }
  return email;
}


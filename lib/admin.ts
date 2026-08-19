import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * Admin emails come from ADMIN_EMAILS (comma-separated, preferred) with
 * ADMIN_EMAIL kept for backward compatibility with older deployments.
 * Both are merged so an existing single-admin deploy keeps working.
 */
export function getAdminEmails(): Set<string> {
  const raw = `${process.env.ADMIN_EMAILS ?? ""},${process.env.ADMIN_EMAIL ?? ""}`;
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** @deprecated Use getAdminEmails(). Kept so existing callers/tests keep working. */
export function getAdminEmail() {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || "";
}

export function isAdminEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return Boolean(normalized) && getAdminEmails().has(normalized);
}

export async function requireAdminEmail() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase() || "";
  return { email, allowed: email ? isAdminEmail(email) : false };
}

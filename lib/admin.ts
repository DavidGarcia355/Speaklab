import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

export function getAdminEmail() {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || "";
}

export function isAdminEmail(email: string) {
  const adminEmail = getAdminEmail();
  return Boolean(adminEmail) && email.trim().toLowerCase() === adminEmail;
}

export async function requireAdminEmail() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase() || "";
  return { email, allowed: email ? isAdminEmail(email) : false };
}

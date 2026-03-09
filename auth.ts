import type { NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import { getEnv } from "@/lib/env";

export function isAllowedSchoolEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(`@${getEnv().schoolGoogleDomain}`);
}

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : "";
      const emailVerified = (profile as { email_verified?: boolean } | null)?.email_verified;
      if (!email) return false;
      if (emailVerified === false) return false;
      return isAllowedSchoolEmail(email);
    },
    async session({ session }) {
      if (session.user?.email) {
        session.user.email = session.user.email.toLowerCase();
      }
      return session;
    },
  },
};

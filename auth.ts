import type { NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import { getUserRoleByEmail } from "@/lib/db";

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
      await getUserRoleByEmail(email);
      return true;
    },
    async jwt({ token }) {
      if (typeof token.email === "string" && token.email) {
        token.role = await getUserRoleByEmail(token.email);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user?.email) {
        session.user.email = session.user.email.toLowerCase();
      }
      if (session.user) {
        (session.user as { role?: "teacher" | "student" }).role =
          (token as { role?: "teacher" | "student" }).role;
      }
      return session;
    },
  },
};

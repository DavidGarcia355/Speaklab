import type { NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import AzureAD from "next-auth/providers/azure-ad";
import { trackActivity } from "@/lib/activity";
import { getUserRoleByEmail, upsertGoogleUserAndGetRole } from "@/lib/db";

const ALLOWED_PROVIDERS = new Set(["google", "azure-ad"]);

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
    ...(process.env.AUTH_MICROSOFT_ID
      ? [
          AzureAD({
            clientId: process.env.AUTH_MICROSOFT_ID,
            clientSecret: process.env.AUTH_MICROSOFT_SECRET ?? "",
            tenantId: process.env.AUTH_MICROSOFT_TENANT_ID || "common",
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (!account?.provider || !ALLOWED_PROVIDERS.has(account.provider)) return false;
      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : "";
      const emailVerified = (profile as { email_verified?: boolean } | null)?.email_verified;
      if (!email) return false;
      if (emailVerified === false) return false;
      await upsertGoogleUserAndGetRole(email);
      try {
        await trackActivity("user_signed_in", email);
      } catch (error) {
        console.warn("Failed to track sign-in activity", error);
      }
      return true;
    },
    async jwt({ token }) {
      if (typeof token.email === "string" && token.email) {
        token.email = token.email.toLowerCase();
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
    async redirect({ url, baseUrl }) {
      // After sign-in with no explicit callbackUrl, send users to the student
      // dashboard. Teachers are then redirected onward to /teacher from there.
      if (url === baseUrl || url === `${baseUrl}/`) {
        return `${baseUrl}/student/dashboard`;
      }
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
  },
};

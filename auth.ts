import type { NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import AzureAD from "next-auth/providers/azure-ad";
import { enqueueTeacherSignedUpAlert } from "@/lib/admin-alert-lifecycle";
import { trackActivity } from "@/lib/activity";
import { logAuthDiagnostic, safeDiagnosticCode } from "@/lib/auth-diagnostics";
import { getUserRoleByEmail, upsertGoogleUserAndGetRole } from "@/lib/db";

const ALLOWED_PROVIDERS = new Set(["google", "azure-ad"]);
const microsoftClientId = process.env.AUTH_MICROSOFT_ID?.trim() ?? "";
const microsoftClientSecret = process.env.AUTH_MICROSOFT_SECRET?.trim() ?? "";
const microsoftTenantId = process.env.AUTH_MICROSOFT_TENANT_ID?.trim() || "common";
const microsoftAuthConfigured = Boolean(microsoftClientId && microsoftClientSecret);

if (Boolean(microsoftClientId) !== Boolean(microsoftClientSecret)) {
  console.error(
    "Microsoft sign-in is disabled: AUTH_MICROSOFT_ID and AUTH_MICROSOFT_SECRET must both be configured."
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  pages: {
    error: "/auth/error",
  },
  logger: {
    error(code) {
      logAuthDiagnostic("nextauth_error", { code: safeDiagnosticCode(code) }, "error");
    },
    warn(code) {
      logAuthDiagnostic("nextauth_warning", { code: safeDiagnosticCode(code) }, "warn");
    },
  },
  theme: {
    colorScheme: "auto",
    logo: "/tryhabla-auth-logo.svg",
    brandColor: "#1374ad",
    buttonText: "#ffffff",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
    ...(microsoftAuthConfigured
      ? [
          {
            ...AzureAD({
              clientId: microsoftClientId,
              clientSecret: microsoftClientSecret,
              tenantId: microsoftTenantId,
            }),
            name: "Microsoft",
          },
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      const provider =
        account?.provider === "google" || account?.provider === "azure-ad"
          ? account.provider
          : "unknown";
      if (!account?.provider || !ALLOWED_PROVIDERS.has(account.provider)) {
        logAuthDiagnostic("sign_in_rejected", { code: "unsupported_provider", provider }, "warn");
        return false;
      }
      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : "";
      const emailVerified = (profile as { email_verified?: boolean } | null)?.email_verified;
      if (!email) {
        logAuthDiagnostic("sign_in_rejected", { code: "missing_email", provider }, "warn");
        return false;
      }
      if (emailVerified === false) {
        logAuthDiagnostic("sign_in_rejected", { code: "email_not_verified", provider }, "warn");
        return false;
      }
      const previousRole = await getUserRoleByEmail(email);
      const role = await upsertGoogleUserAndGetRole(email);
      if (previousRole !== "teacher" && role === "teacher") {
        await enqueueTeacherSignedUpAlert({ teacherEmail: email, source: "other" });
      }
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

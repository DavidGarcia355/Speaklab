import { isInAppBrowser } from "@/lib/in-app-browser";

export const AUTH_SUPPORT_CODES = [
  "AccessDenied",
  "Configuration",
  "Verification",
  "OAuthSignin",
  "OAuthCallback",
  "OAuthCreateAccount",
  "EmailCreateAccount",
  "Callback",
  "OAuthAccountNotLinked",
  "EmailSignin",
  "CredentialsSignin",
  "SessionRequired",
  "ExternalBrowserRequired",
  "RegistrationCheckFailed",
  "RegistrationClosed",
  "Default",
] as const;

export type AuthSupportCode = (typeof AUTH_SUPPORT_CODES)[number];

export type AuthBrowserCategory =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "google-app"
  | "other-embedded"
  | "standalone"
  | "unknown";

const AUTH_SUPPORT_CODE_SET = new Set<string>(AUTH_SUPPORT_CODES);

export function parseAuthSupportCode(
  value: string | string[] | null | undefined
): AuthSupportCode | null {
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim();
  return candidate && AUTH_SUPPORT_CODE_SET.has(candidate)
    ? (candidate as AuthSupportCode)
    : null;
}

export function normalizeAuthSupportCode(
  value: string | string[] | null | undefined
): AuthSupportCode {
  return parseAuthSupportCode(value) ?? "Default";
}

export function classifyAuthBrowser(userAgent: string | null | undefined): AuthBrowserCategory {
  const normalized = userAgent?.trim() ?? "";
  if (!normalized) return "unknown";
  if (/Instagram/i.test(normalized)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger/i.test(normalized)) return "facebook";
  if (/TikTok/i.test(normalized)) return "tiktok";
  if (/LinkedInApp/i.test(normalized)) return "linkedin";
  if (/GSA/i.test(normalized)) return "google-app";
  return isInAppBrowser(normalized) ? "other-embedded" : "standalone";
}

export function normalizeDiagnosticRoute(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";

  try {
    const parsed = new URL(candidate, "https://tryhabla.invalid");
    if (parsed.origin !== "https://tryhabla.invalid") return "/";

    const segments = parsed.pathname.split("/");
    if (segments[1] === "a" && segments[2]) {
      return "/a/[assignmentId]";
    }
    if (segments[1] === "teacher" && segments[2] === "class" && segments[3]) {
      const suffix = segments.slice(4).filter(Boolean).join("/");
      return `/teacher/class/[classId]${suffix ? `/${suffix}` : ""}`.slice(0, 160);
    }

    return parsed.pathname.slice(0, 160) || "/";
  } catch {
    return "/";
  }
}

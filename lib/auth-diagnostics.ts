import "server-only";

import type { AuthBrowserCategory, AuthSupportCode } from "@/lib/auth-diagnostics-shared";

export type AuthDiagnosticEvent =
  | "auth_error_presented"
  | "in_app_browser_blocked"
  | "nextauth_error"
  | "nextauth_warning"
  | "registration_denied"
  | "registration_unavailable_presented"
  | "sign_in_rejected"
  | "sign_in_requested"
  | "webview_help_shown"
  | "webview_link_copied";

type AuthDiagnosticDetails = {
  browserCategory?: AuthBrowserCategory;
  code?: AuthSupportCode | string;
  method?: "GET" | "POST";
  provider?: "azure-ad" | "google" | "unknown";
  route?: string;
};

export function safeDiagnosticCode(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(normalized) ? normalized : "unknown";
}

export function logAuthDiagnostic(
  event: AuthDiagnosticEvent,
  details: AuthDiagnosticDetails = {},
  level: "info" | "warn" | "error" = "info"
) {
  const entry = JSON.stringify({
    event,
    ...details,
    timestamp: new Date().toISOString(),
  });

  if (level === "error") {
    console.error("AUTH_DIAGNOSTIC", entry);
    return;
  }
  if (level === "warn") {
    console.warn("AUTH_DIAGNOSTIC", entry);
    return;
  }
  console.info("AUTH_DIAGNOSTIC", entry);
}

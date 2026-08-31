import type { AuthSupportCode } from "@/lib/auth-diagnostics-shared";

type AuthErrorCopy = {
  detail: string;
  title: string;
};

const COPY: Partial<Record<AuthSupportCode, AuthErrorCopy>> = {
  AccessDenied: {
    title: "Your account could not be authorized",
    detail:
      "TryHabla did not receive the verified account permission it needs. Try again, then ask your school district to allow TryHabla if the message returns.",
  },
  Configuration: {
    title: "Sign-in is temporarily unavailable",
    detail:
      "TryHabla's sign-in configuration needs attention. Please contact support and include the reference code shown below.",
  },
  OAuthSignin: {
    title: "Secure sign-in did not start",
    detail: "Open TryHabla in Chrome, Edge, Firefox, or Safari and try your school account again.",
  },
  OAuthCallback: {
    title: "Secure sign-in did not finish",
    detail:
      "The identity provider returned without completing sign-in. Try again in a standalone browser or contact support if it repeats.",
  },
  OAuthCreateAccount: {
    title: "Your TryHabla account was not created",
    detail: "Your identity was verified, but setup did not finish. Try once more or contact support.",
  },
  OAuthAccountNotLinked: {
    title: "This email uses a different sign-in method",
    detail: "Use the same provider you originally used for this email, or contact support for help.",
  },
  Verification: {
    title: "The sign-in link is no longer valid",
    detail: "Restart sign-in to request a fresh verification flow.",
  },
  ExternalBrowserRequired: {
    title: "Open TryHabla in a standalone browser",
    detail:
      "Facebook and other in-app browsers can block secure school sign-in. Copy the TryHabla link, then open it in Chrome, Edge, Firefox, or Safari.",
  },
  RegistrationCheckFailed: {
    title: "We could not check teacher registration",
    detail: "This may be temporary. Retry the check, or contact support if it continues.",
  },
  RegistrationClosed: {
    title: "Self-service teacher registration is unavailable",
    detail: "Contact TryHabla support and we will help verify your school account.",
  },
};

const DEFAULT_COPY: AuthErrorCopy = {
  title: "Sign-in did not complete",
  detail: "Try again in a standalone browser. If it still fails, contact support with the reference code below.",
};

export function getAuthErrorCopy(code: AuthSupportCode) {
  return COPY[code] ?? DEFAULT_COPY;
}

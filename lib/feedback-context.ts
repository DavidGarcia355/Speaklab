import type { AuthBrowserCategory, AuthSupportCode } from "@/lib/auth-diagnostics-shared";

export type FeedbackContextSource = "auth" | "registration" | "webview";

export type FeedbackContextInput = {
  authErrorCode?: AuthSupportCode;
  route: string;
  source: FeedbackContextSource;
};

export type FeedbackDiagnosticContext = {
  authErrorCode: AuthSupportCode | "";
  browserCategory: AuthBrowserCategory;
  route: string;
  source: FeedbackContextSource;
};

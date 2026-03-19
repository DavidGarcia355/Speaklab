const IN_APP_BROWSER_PATTERNS = [
  /Instagram/i,
  /FBAN/i,
  /FBAV/i,
  /FB_IAB/i,
  /FBIOS/i,
  /FB4A/i,
  /Messenger/i,
  /Line\//i,
  /LinkedInApp/i,
  /MicroMessenger/i,
  /TikTok/i,
  /Snapchat/i,
  /\bwv\b/i,
  /WebView/i,
  /GSA/i,
] as const;

export const AUTH_BROWSER_REQUIRED_PARAM = "auth";
export const AUTH_BROWSER_REQUIRED_VALUE = "external-browser-required";

export function isInAppBrowser(userAgent: string | null | undefined) {
  if (!userAgent) return false;
  const normalized = userAgent.trim();
  if (!normalized) return false;
  return IN_APP_BROWSER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildExternalBrowserRedirectUrl(input: {
  requestUrl: string;
  callbackUrl?: string | null;
  referer?: string | null;
}) {
  const requestUrl = new URL(input.requestUrl);
  const candidates = [input.callbackUrl, input.referer];

  for (const candidate of candidates) {
    if (!candidate) continue;

    try {
      const resolved = new URL(candidate, requestUrl);
      if (resolved.origin !== requestUrl.origin) continue;

      resolved.searchParams.set(AUTH_BROWSER_REQUIRED_PARAM, AUTH_BROWSER_REQUIRED_VALUE);
      return resolved.toString();
    } catch {
      // Ignore malformed values and keep falling back.
    }
  }

  const fallback = new URL("/", requestUrl);
  fallback.searchParams.set(AUTH_BROWSER_REQUIRED_PARAM, AUTH_BROWSER_REQUIRED_VALUE);
  return fallback.toString();
}

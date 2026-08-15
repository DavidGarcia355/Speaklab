import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/auth";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { getClientIp, withApiHandler } from "@/lib/http";
import { buildExternalBrowserRedirectUrl, isInAppBrowser } from "@/lib/in-app-browser";

const handler = NextAuth(authOptions);

function isSignInAttempt(request: Request) {
  const { pathname } = new URL(request.url);
  return pathname === "/api/auth/signin" || /^\/api\/auth\/signin\/[^/]+$/.test(pathname);
}

function shouldBlockInAppBrowser(request: Request) {
  return isSignInAttempt(request) && isInAppBrowser(request.headers.get("user-agent"));
}

function isLocalAuthBypassSignIn(request: Request) {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.LOCAL_DEV_BYPASS_AUTH === "true" &&
    isSignInAttempt(request)
  );
}

function getLocalRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.trim();
  if (host) return `${requestUrl.protocol}//${host}`;
  return requestUrl.origin;
}

function redirectToLocalBypassCallback(request: Request) {
  const requestUrl = new URL(request.url);
  const requestOrigin = getLocalRequestOrigin(request);
  const callbackUrl = requestUrl.searchParams.get("callbackUrl") || "/teacher";

  try {
    const redirectUrl = new URL(callbackUrl, requestOrigin);
    if (redirectUrl.origin === requestOrigin) {
      return NextResponse.redirect(redirectUrl, { status: 302 });
    }
  } catch {
    // Fall through to the local teacher workspace.
  }

  return NextResponse.redirect(new URL("/teacher", requestOrigin), { status: 302 });
}

function redirectToExternalBrowser(request: Request) {
  return NextResponse.redirect(
    buildExternalBrowserRedirectUrl({
      requestUrl: request.url,
      callbackUrl: new URL(request.url).searchParams.get("callbackUrl"),
      referer: request.headers.get("referer"),
    }),
    { status: 302 }
  );
}

type AuthContext = {
  params: Promise<{ nextauth: string[] }> | { nextauth: string[] };
};

export async function GET(request: Request, context: AuthContext) {
  return withApiHandler(request, async () => {
    if (shouldBlockInAppBrowser(request)) {
      return redirectToExternalBrowser(request);
    }

    if (isLocalAuthBypassSignIn(request)) {
      return redirectToLocalBypassCallback(request);
    }

    if (isSignInAttempt(request)) {
      await enforceAuthRateLimit(getClientIp(request));
    }
    return handler(request, context);
  });
}

export async function POST(request: Request, context: AuthContext) {
  return withApiHandler(request, async () => {
    if (shouldBlockInAppBrowser(request)) {
      return redirectToExternalBrowser(request);
    }

    if (isLocalAuthBypassSignIn(request)) {
      return redirectToLocalBypassCallback(request);
    }

    if (isSignInAttempt(request)) {
      await enforceAuthRateLimit(getClientIp(request));
    }
    return handler(request, context);
  });
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function teacherRequiredPath(pathname: string) {
  if (pathname.startsWith("/teacher")) return true;
  if (pathname.startsWith("/api/classes")) return true;
  if (pathname.startsWith("/api/assignments")) {
    return !pathname.endsWith("/submissions");
  }
  if (pathname.startsWith("/api/submissions")) {
    return !pathname.endsWith("/audio");
  }
  return false;
}

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

async function fetchRole(request: NextRequest) {
  const response = await fetch(new URL("/api/auth/role", request.url), {
    method: "GET",
    headers: {
      cookie: request.headers.get("cookie") || "",
      "x-proxy-role-check": "1",
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { role?: "teacher" | "student" };
  return data.role || null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true") {
    return NextResponse.next();
  }
  if (!teacherRequiredPath(pathname)) {
    return NextResponse.next();
  }

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    console.error("Missing AUTH_SECRET for auth.");
    if (pathname.startsWith("/api/")) {
      return jsonError(500, "Something went wrong — try refreshing the page.");
    }
    return new NextResponse("Something went wrong — try refreshing the page.", { status: 500 });
  }

  const token = await getToken({ req: request, secret: authSecret });
  const email = token?.email?.toLowerCase();
  if (!email) {
    if (pathname.startsWith("/api/")) {
      return jsonError(401, "You'll need to sign in first.");
    }
    const signInUrl = new URL("/api/auth/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(signInUrl);
  }

  const role = await fetchRole(request);
  if (role !== "teacher") {
    if (pathname.startsWith("/api/")) {
      return jsonError(403, "You don't have access to this page.");
    }
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/teacher/:path*", "/api/classes/:path*", "/api/assignments/:path*", "/api/submissions/:path*"],
};

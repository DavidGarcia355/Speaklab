import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function parseTeacherEmails() {
  const raw = process.env.TEACHER_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true") {
    return NextResponse.next();
  }
  if (!teacherRequiredPath(pathname)) {
    return NextResponse.next();
  }

  const authSecret = process.env.AUTH_SECRET;
  const teacherEmails = parseTeacherEmails();
  if (!authSecret || teacherEmails.size === 0) {
    console.error("Missing AUTH_SECRET or TEACHER_EMAILS for middleware auth.");
    if (pathname.startsWith("/api/")) {
      return jsonError(500, "Something went wrong.");
    }
    return new NextResponse("Server misconfiguration", { status: 500 });
  }

  const token = await getToken({ req: request, secret: authSecret });
  const email = token?.email?.toLowerCase();
  if (!email) {
    if (pathname.startsWith("/api/")) {
      return jsonError(401, "Authentication required.");
    }
    const signInUrl = new URL("/api/auth/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(signInUrl);
  }
  if (!teacherEmails.has(email)) {
    if (pathname.startsWith("/api/")) {
      return jsonError(403, "Teacher access only.");
    }
    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/teacher/:path*", "/api/classes/:path*", "/api/assignments/:path*", "/api/submissions/:path*"],
};

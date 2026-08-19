import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function teacherRequiredPath(pathname: string) {
  if (pathname.startsWith("/teacher") && pathname !== "/teacher/register") return true;
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

function adminRequiredPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

async function getCurrentRole(request: NextRequest) {
  const response = await fetch(new URL("/api/auth/role", request.url), {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as { role?: string };
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true") {
    return NextResponse.next();
  }
  if (!teacherRequiredPath(pathname) && !adminRequiredPath(pathname)) {
    return NextResponse.next();
  }

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    console.error("Missing AUTH_SECRET for auth.");
    if (pathname.startsWith("/api/")) {
      return jsonError(500, "Something went wrong - try refreshing the page.");
    }
    return new NextResponse("Something went wrong - try refreshing the page.", { status: 500 });
  }

  const token = await getToken({ req: request, secret: authSecret });
  const email = token?.email?.toLowerCase();
  if (!email) {
    if (adminRequiredPath(pathname)) {
      return new NextResponse("You don't have access to this page.", { status: 403 });
    }
    if (pathname.startsWith("/api/")) {
      return jsonError(401, "You'll need to sign in first.");
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (adminRequiredPath(pathname)) {
    // Mirrors getAdminEmails() in lib/admin.ts. Duplicated rather than imported
    // because middleware runs on the edge runtime and lib/admin.ts is server-only.
    const adminEmails = new Set(
      `${process.env.ADMIN_EMAILS ?? ""},${process.env.ADMIN_EMAIL ?? ""}`
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    );
    if (adminEmails.size === 0 || !adminEmails.has(email)) {
      return new NextResponse("You don't have access to this page.", { status: 403 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/teacher")) {
    const role = await getCurrentRole(request);
    if (!role) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    if (role.role !== "teacher") {
      return NextResponse.redirect(new URL("/teacher/register", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/teacher/:path*",
    "/api/classes/:path*",
    "/api/assignments/:path*",
    "/api/submissions/:path*",
  ],
};

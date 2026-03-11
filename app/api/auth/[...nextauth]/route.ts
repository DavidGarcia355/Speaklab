import NextAuth from "next-auth";
import { authOptions } from "@/auth";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { getClientIp, withApiHandler } from "@/lib/http";

const handler = NextAuth(authOptions);

function isSignInAttempt(request: Request) {
  const { pathname } = new URL(request.url);
  return /^\/api\/auth\/signin\/[^/]+$/.test(pathname);
}

type AuthContext = {
  params: Promise<{ nextauth: string[] }> | { nextauth: string[] };
};

export async function GET(request: Request, context: AuthContext) {
  return withApiHandler(request, async () => {
    if (isSignInAttempt(request)) {
      await enforceAuthRateLimit(getClientIp(request));
    }
    return handler(request, context);
  });
}

export async function POST(request: Request, context: AuthContext) {
  return withApiHandler(request, async () => {
    if (isSignInAttempt(request)) {
      await enforceAuthRateLimit(getClientIp(request));
    }
    return handler(request, context);
  });
}

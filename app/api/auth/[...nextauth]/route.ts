import NextAuth from "next-auth";
import { authOptions } from "@/auth";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { getClientIp, withApiHandler } from "@/lib/http";

const handler = NextAuth(authOptions);

function isSignInAttempt(request: Request) {
  const { pathname } = new URL(request.url);
  return pathname.includes("/api/auth/signin");
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    if (isSignInAttempt(request)) {
      await enforceAuthRateLimit(getClientIp(request));
    }
    return handler(request);
  });
}

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    if (isSignInAttempt(request)) {
      await enforceAuthRateLimit(getClientIp(request));
    }
    return handler(request);
  });
}

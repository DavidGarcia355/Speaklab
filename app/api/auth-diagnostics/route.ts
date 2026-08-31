import { NextResponse } from "next/server";
import { logAuthDiagnostic } from "@/lib/auth-diagnostics";
import { classifyAuthBrowser, normalizeDiagnosticRoute } from "@/lib/auth-diagnostics-shared";
import { getClientIp, HttpError, withApiHandler } from "@/lib/http";
import { enforceAuthRateLimit } from "@/lib/rate-limit";

const ALLOWED_EVENTS = new Set(["webview_help_shown", "webview_link_copied"]);

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    await enforceAuthRateLimit(`diagnostic:${getClientIp(request)}`);

    const body = (await request.json()) as { event?: unknown; route?: unknown };
    if (typeof body.event !== "string" || !ALLOWED_EVENTS.has(body.event)) {
      throw new HttpError(400, "Unsupported diagnostic event.");
    }

    logAuthDiagnostic(body.event as "webview_help_shown" | "webview_link_copied", {
      browserCategory: classifyAuthBrowser(request.headers.get("user-agent")),
      route: normalizeDiagnosticRoute(typeof body.route === "string" ? body.route : "/"),
    });

    return new NextResponse(null, { status: 204 });
  });
}

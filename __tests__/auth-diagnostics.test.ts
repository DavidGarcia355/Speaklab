import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyAuthBrowser,
  normalizeAuthSupportCode,
  normalizeDiagnosticRoute,
  parseAuthSupportCode,
} from "@/lib/auth-diagnostics-shared";
import { getAuthErrorCopy } from "@/lib/auth-error-copy";

const mocks = vi.hoisted(() => ({
  enforceAuthRateLimit: vi.fn(),
  logAuthDiagnostic: vi.fn(),
}));

vi.mock("@/lib/auth-diagnostics", () => ({
  logAuthDiagnostic: mocks.logAuthDiagnostic,
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
}));

vi.mock("@/lib/http", () => {
  class HttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return {
    HttpError,
    getClientIp: () => "203.0.113.50",
    withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        if (error instanceof HttpError) {
          return Response.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
    },
  };
});

describe("privacy-safe auth diagnostics", () => {
  beforeEach(() => {
    mocks.enforceAuthRateLimit.mockReset().mockResolvedValue(undefined);
    mocks.logAuthDiagnostic.mockReset();
  });

  it("normalizes public support codes without reflecting arbitrary query text", () => {
    expect(parseAuthSupportCode("AccessDenied")).toBe("AccessDenied");
    expect(parseAuthSupportCode("attacker@example.com")).toBeNull();
    expect(normalizeAuthSupportCode("attacker@example.com")).toBe("Default");
    expect(getAuthErrorCopy("AccessDenied").detail).toContain("school district");
  });

  it("classifies browser families without retaining the raw user agent", () => {
    expect(classifyAuthBrowser("Mozilla/5.0 FBAN/FBIOS FBAV/455.0")).toBe("facebook");
    expect(classifyAuthBrowser("Mozilla/5.0 Instagram 312.0")).toBe("instagram");
    expect(classifyAuthBrowser("Mozilla/5.0 Chrome/140 Safari/537.36")).toBe("standalone");
    expect(classifyAuthBrowser(null)).toBe("unknown");
  });

  it("keeps only a same-site pathname in diagnostic context", () => {
    expect(normalizeDiagnosticRoute("/teacher/register?token=secret#section")).toBe(
      "/teacher/register"
    );
    expect(normalizeDiagnosticRoute("https://evil.example/private")).toBe("/");
    expect(normalizeDiagnosticRoute("//evil.example/private")).toBe("/");
    expect(normalizeDiagnosticRoute("/a/asn_secret_value?token=private")).toBe(
      "/a/[assignmentId]"
    );
    expect(normalizeDiagnosticRoute("/teacher/class/class_secret/assignment/new")).toBe(
      "/teacher/class/[classId]/assignment/new"
    );
  });

  it("renders a safe error page and forwards only the normalized reference", async () => {
    const { default: AuthErrorPage } = await import("@/app/auth/error/page");
    const markup = renderToStaticMarkup(
      await AuthErrorPage({
        searchParams: Promise.resolve({ error: "<script>secret@example.com</script>" }),
      })
    );

    expect(markup).toContain("Sign-in did not complete");
    expect(markup).toContain("Sign-in reference: <strong>Default</strong>");
    expect(markup).not.toContain("secret@example.com");
    expect(markup).toContain("intent=auth");
    expect(mocks.logAuthDiagnostic).toHaveBeenCalledWith(
      "auth_error_presented",
      { code: "Default", route: "/auth/error" },
      "warn"
    );
  });

  it("accepts a webview event and derives its browser category on the server", async () => {
    const { POST } = await import("@/app/api/auth-diagnostics/route");
    const response = await POST(
      new Request("https://tryhabla.com/api/auth-diagnostics", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 FBAN/FBIOS FBAV/455.0 secret-fragment",
        },
        body: JSON.stringify({
          event: "webview_help_shown",
          route: "/teacher/register?private=value",
        }),
      })
    );

    expect(response.status).toBe(204);
    expect(mocks.enforceAuthRateLimit).toHaveBeenCalledWith("diagnostic:203.0.113.50");
    expect(mocks.logAuthDiagnostic).toHaveBeenCalledWith("webview_help_shown", {
      browserCategory: "facebook",
      route: "/teacher/register",
    });
    expect(JSON.stringify(mocks.logAuthDiagnostic.mock.calls)).not.toContain("secret-fragment");
    expect(JSON.stringify(mocks.logAuthDiagnostic.mock.calls)).not.toContain("private=value");
  });

  it("rejects unsupported client diagnostic events", async () => {
    const { POST } = await import("@/app/api/auth-diagnostics/route");
    const response = await POST(
      new Request("https://tryhabla.com/api/auth-diagnostics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "raw_user_agent_dump", route: "/" }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.logAuthDiagnostic).not.toHaveBeenCalled();
  });
});

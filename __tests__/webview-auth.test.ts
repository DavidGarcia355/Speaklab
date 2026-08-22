import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_BROWSER_REQUIRED_VALUE,
  buildExternalBrowserRedirectUrl,
  isInAppBrowser,
} from "@/lib/in-app-browser";

const mocks = vi.hoisted(() => {
  const nextAuthHandler = vi.fn(async () => Response.json({ ok: true }));

  return {
    nextAuthHandler,
    nextAuthFactory: vi.fn(() => nextAuthHandler),
    enforceAuthRateLimit: vi.fn(),
  };
});

vi.mock("next-auth", () => ({
  default: mocks.nextAuthFactory,
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
}));

vi.mock("@/lib/http", () => ({
  getClientIp: () => "203.0.113.10",
  withApiHandler: async (_request: Request, handler: () => Promise<Response>) => await handler(),
}));

describe("in-app browser detection", () => {
  it("detects common embedded browsers that break Google OAuth", () => {
    expect(isInAppBrowser("Mozilla/5.0 Instagram 312.0.0.34.111")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 FBAN/FBIOS FBAV/455.0.0.0.6")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 Line/15.2.0")).toBe(true);
  });

  it("allows normal Safari and Chrome browsers", () => {
    expect(
      isInAppBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15"
      )
    ).toBe(false);
    expect(
      isInAppBrowser(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36"
      )
    ).toBe(false);
  });
});

describe("external browser redirect helper", () => {
  it("returns the same-page callback with a browser-required marker", () => {
    const url = buildExternalBrowserRedirectUrl({
      requestUrl: "https://tryhabla.com/api/auth/signin?callbackUrl=/teacher",
      callbackUrl: "/teacher",
    });

    expect(url).toBe(`https://tryhabla.com/teacher?auth=${AUTH_BROWSER_REQUIRED_VALUE}`);
  });

  it("falls back home when the callback origin is not trusted", () => {
    const url = buildExternalBrowserRedirectUrl({
      requestUrl: "https://tryhabla.com/api/auth/signin?callbackUrl=https://evil.example",
      callbackUrl: "https://evil.example",
    });

    expect(url).toBe(`https://tryhabla.com/?auth=${AUTH_BROWSER_REQUIRED_VALUE}`);
  });
});

describe("next auth sign-in guard", () => {
  const originalBypass = process.env.LOCAL_DEV_BYPASS_AUTH;

  beforeEach(() => {
    process.env.LOCAL_DEV_BYPASS_AUTH = originalBypass;
    mocks.nextAuthHandler.mockClear();
    mocks.nextAuthFactory.mockClear();
    mocks.enforceAuthRateLimit.mockClear();
  });

  it("redirects embedded browser sign-in attempts back into the app", async () => {
    const { GET } = await import("@/app/api/auth/[...nextauth]/route");
    const request = new Request("https://tryhabla.com/api/auth/signin?callbackUrl=/student", {
      headers: {
        "user-agent": "Mozilla/5.0 Instagram 312.0.0.34.111",
        referer: "https://tryhabla.com/student",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ nextauth: ["signin"] }) });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://tryhabla.com/student?auth=${AUTH_BROWSER_REQUIRED_VALUE}`
    );
    expect(mocks.enforceAuthRateLimit).not.toHaveBeenCalled();
    expect(mocks.nextAuthHandler).not.toHaveBeenCalled();
  });

  it("lets normal browser sign-in continue", async () => {
    const { GET } = await import("@/app/api/auth/[...nextauth]/route");
    const request = new Request("https://tryhabla.com/api/auth/signin/google?callbackUrl=/teacher", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36",
      },
    });

    const response = await GET(request, {
      params: Promise.resolve({ nextauth: ["signin", "google"] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.enforceAuthRateLimit).toHaveBeenCalledWith("203.0.113.10");
    expect(mocks.nextAuthHandler).toHaveBeenCalled();
  });

  it("redirects local bypass sign-in requests to the callback without OAuth", async () => {
    process.env.LOCAL_DEV_BYPASS_AUTH = "true";
    const { GET } = await import("@/app/api/auth/[...nextauth]/route");
    const request = new Request("http://10.10.10.3:3000/api/auth/signin?callbackUrl=%2Fteacher", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ nextauth: ["signin"] }) });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://10.10.10.3:3000/teacher");
    expect(mocks.enforceAuthRateLimit).not.toHaveBeenCalled();
    expect(mocks.nextAuthHandler).not.toHaveBeenCalled();
  });
});

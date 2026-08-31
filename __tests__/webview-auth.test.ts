import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyTextToClipboard,
  EmbeddedBrowserSignInFallback,
  getCopyLinkFeedback,
  reportWebviewAuthEvent,
  runCopyLinkAction,
  type CopyLinkState,
} from "@/app/components/SignInLink";
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
  it("detects common embedded browsers that break OAuth", () => {
    expect(isInAppBrowser("Mozilla/5.0 Instagram 312.0.0.34.111")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 FBAN/FBIOS FBAV/455.0.0.0.6")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 Line/15.2.0")).toBe(true);
    expect(
      isInAppBrowser(
        "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A.250205.002; wv) AppleWebKit/537.36 Version/4.0 Chrome/133.0.6943.49 Mobile Safari/537.36"
      )
    ).toBe(true);
  });

  it.each([
    [
      "Safari",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
    ],
    [
      "Chrome",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36",
    ],
    [
      "Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    ],
    [
      "Firefox",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
    ],
  ])("allows normal %s browsers", (_browser, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(false);
  });
});

describe("embedded browser sign-in help", () => {
  const canonicalRegistrationUrl = "https://tryhabla.com/teacher/register";

  it("shows Facebook visitors a canonical link without another in-app navigation link", () => {
    const markup = renderToStaticMarkup(
      createElement(
        EmbeddedBrowserSignInFallback,
        {
          className: "btn btn-primary",
          externalBrowserUrl: canonicalRegistrationUrl,
          message: "Google sign-in cannot open inside Facebook or another app's browser.",
          externalBrowserInstructions:
            "Tap the menu in this app → Open in browser. Then sign in to create your free teacher account.",
        },
        "Sign in to start free"
      )
    );

    expect(markup).toContain(canonicalRegistrationUrl);
    expect(markup).toContain("Open in browser");
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Copy link");
    expect(markup).not.toContain('target="_blank"');
    expect(markup).not.toContain("/api/auth/signin");
  });

  it("moves the copy UX through copying and copied states", async () => {
    const states: CopyLinkState[] = [];
    const copyText = vi.fn(async () => true);

    const copied = await runCopyLinkAction({
      url: canonicalRegistrationUrl,
      setState: (state) => states.push(state),
      copyText,
    });

    expect(copied).toBe(true);
    expect(copyText).toHaveBeenCalledWith(canonicalRegistrationUrl);
    expect(states).toEqual(["copying", "copied"]);
    expect(getCopyLinkFeedback("copied")).toEqual({
      buttonLabel: "Copied",
      statusMessage: "Link copied. Paste it into your browser to continue.",
    });
  });

  it("falls back to selection copying when an embedded browser rejects Clipboard API", async () => {
    const textArea = {
      value: "",
      readOnly: false,
      setAttribute: vi.fn(),
      style: {} as CSSStyleDeclaration,
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    const previouslyFocused = { focus: vi.fn() };
    const activeDocument = {
      activeElement: previouslyFocused,
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => textArea),
      execCommand: vi.fn(() => true),
    } as unknown as Document;
    const clipboard = {
      writeText: vi.fn(async () => {
        throw new Error("Clipboard is unavailable in this webview");
      }),
    };

    const copied = await copyTextToClipboard(canonicalRegistrationUrl, {
      clipboard,
      document: activeDocument,
    });

    expect(copied).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith(canonicalRegistrationUrl);
    expect(textArea.value).toBe(canonicalRegistrationUrl);
    expect(textArea.select).toHaveBeenCalled();
    expect(activeDocument.execCommand).toHaveBeenCalledWith("copy");
    expect(textArea.remove).toHaveBeenCalled();
    expect(previouslyFocused.focus).toHaveBeenCalled();
  });

  it("gives manual-copy guidance when clipboard access fails", async () => {
    const states: CopyLinkState[] = [];

    const copied = await runCopyLinkAction({
      url: canonicalRegistrationUrl,
      setState: (state) => states.push(state),
      copyText: vi.fn(async () => false),
    });

    expect(copied).toBe(false);
    expect(states).toEqual(["copying", "failed"]);
    expect(getCopyLinkFeedback("failed")).toEqual({
      buttonLabel: "Try copying again",
      statusMessage: "Copy failed. Press and hold the URL to copy it manually.",
    });
  });

  it("reports only the privacy-safe event and route with keepalive", () => {
    const send = vi.fn(async () => undefined);

    reportWebviewAuthEvent("webview_help_shown", {
      route: "/teacher/register",
      fetch: send,
    });

    expect(send).toHaveBeenCalledWith("/api/auth-diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "webview_help_shown",
        route: "/teacher/register",
      }),
      keepalive: true,
    });
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

  it.each([
    [
      "Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    ],
    [
      "Firefox",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
    ],
  ])("lets normal %s sign-in continue", async (_browser, userAgent) => {
    const { GET } = await import("@/app/api/auth/[...nextauth]/route");
    const request = new Request("https://tryhabla.com/api/auth/signin/google?callbackUrl=/teacher", {
      headers: {
        "user-agent": userAgent,
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildTeacherRegistrationCallbackUrl,
  normalizeTeacherReturnPath,
  teacherReturnPathFromSearch,
} from "@/lib/teacher-registration-return";

describe("teacher registration return paths", () => {
  it("preserves a same-site teacher path and query through registration", () => {
    const returnPath = teacherReturnPathFromSearch(
      "?callbackUrl=%2Fteacher%2Fclass%2Fclass_123%3Fview%3Dsubmissions"
    );

    expect(returnPath).toBe("/teacher/class/class_123?view=submissions");
    expect(buildTeacherRegistrationCallbackUrl(returnPath)).toBe(
      "/teacher/register?callbackUrl=%2Fteacher%2Fclass%2Fclass_123%3Fview%3Dsubmissions"
    );
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/students",
    "/teachers",
    "/teacher/register",
  ])("falls back to the teacher home for unsafe or looping return path %s", (value) => {
    expect(normalizeTeacherReturnPath(value)).toBe("/teacher");
  });
});

describe("teacher proxy redirects", () => {
  const originalEnv = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    LOCAL_DEV_BYPASS_AUTH: process.env.LOCAL_DEV_BYPASS_AUTH,
  };

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret";
    delete process.env.LOCAL_DEV_BYPASS_AUTH;
  });

  afterEach(() => {
    if (originalEnv.AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalEnv.AUTH_SECRET;
    if (originalEnv.LOCAL_DEV_BYPASS_AUTH === undefined) {
      delete process.env.LOCAL_DEV_BYPASS_AUTH;
    } else {
      process.env.LOCAL_DEV_BYPASS_AUTH = originalEnv.LOCAL_DEV_BYPASS_AUTH;
    }
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends signed-out teacher visitors to registration with a relative callback", async () => {
    const mockGetToken = vi.fn().mockResolvedValue(null);
    vi.doMock("next-auth/jwt", () => ({ getToken: mockGetToken }));

    const { proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("https://tryhabla.com/teacher/class/class_123?view=submissions")
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://tryhabla.com");
    expect(location.pathname).toBe("/teacher/register");
    expect(location.searchParams.get("callbackUrl")).toBe(
      "/teacher/class/class_123?view=submissions"
    );
  });

  it("keeps an untrusted nested callback value inside the relative teacher callback", async () => {
    vi.doMock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }));

    const { proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest(
        "https://tryhabla.com/teacher?callbackUrl=https%3A%2F%2Fevil.example%2Fphish"
      )
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://tryhabla.com");
    expect(location.searchParams.get("callbackUrl")).toBe(
      "/teacher?callbackUrl=https%3A%2F%2Fevil.example%2Fphish"
    );
  });

  it("leaves registration public for signed-out visitors without redirecting again", async () => {
    const mockGetToken = vi.fn();
    vi.doMock("next-auth/jwt", () => ({ getToken: mockGetToken }));

    const { proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("https://tryhabla.com/teacher/register?callbackUrl=%2Fteacher")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it("allows authenticated teachers to continue to protected teacher pages", async () => {
    vi.doMock("next-auth/jwt", () => ({
      getToken: vi.fn().mockResolvedValue({ email: "teacher@example.com" }),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ role: "teacher" }))
    );

    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://tryhabla.com/teacher"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("continues to send authenticated students to teacher registration", async () => {
    vi.doMock("next-auth/jwt", () => ({
      getToken: vi.fn().mockResolvedValue({ email: "student@example.com" }),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ role: "student" }))
    );

    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://tryhabla.com/teacher"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://tryhabla.com");
    expect(location.pathname).toBe("/teacher/register");
    expect(location.searchParams.get("callbackUrl")).toBe("/teacher");
  });

  it("preserves the requested teacher page when the signed-in role check is unavailable", async () => {
    vi.doMock("next-auth/jwt", () => ({
      getToken: vi.fn().mockResolvedValue({ email: "teacher@example.com" }),
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const { proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("https://tryhabla.com/teacher/class/class_123?view=submissions")
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/teacher/register");
    expect(location.searchParams.get("callbackUrl")).toBe(
      "/teacher/class/class_123?view=submissions"
    );
  });

  it("uses registration retry handling when the role request rejects", async () => {
    vi.doMock("next-auth/jwt", () => ({
      getToken: vi.fn().mockResolvedValue({ email: "teacher@example.com" }),
    }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("role service unavailable")));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://tryhabla.com/teacher/class/class_123"));

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/teacher/register");
    expect(location.searchParams.get("callbackUrl")).toBe("/teacher/class/class_123");
    expect(console.warn).toHaveBeenCalledWith(
      "AUTH_DIAGNOSTIC",
      JSON.stringify({ event: "role_check_failed", code: "request_unavailable" })
    );
  });

  it("uses registration retry handling for a malformed role response", async () => {
    vi.doMock("next-auth/jwt", () => ({
      getToken: vi.fn().mockResolvedValue({ email: "teacher@example.com" }),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }))
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://tryhabla.com/teacher"));

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/teacher/register");
    expect(location.searchParams.get("callbackUrl")).toBe("/teacher");
    expect(console.warn).toHaveBeenCalledWith(
      "AUTH_DIAGNOSTIC",
      JSON.stringify({ event: "role_check_failed", code: "invalid_response" })
    );
  });

  it("keeps protected teacher APIs as 401 responses instead of browser redirects", async () => {
    vi.doMock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }));

    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://tryhabla.com/api/classes"));

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "You'll need to sign in first." });
  });
});

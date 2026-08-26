import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("launch hardening helpers", () => {
  const originalEnv = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_RATE_LIMIT_PER_HOUR: process.env.AUTH_RATE_LIMIT_PER_HOUR,
    GRADEBOOK_RATE_LIMIT_PER_HOUR: process.env.GRADEBOOK_RATE_LIMIT_PER_HOUR,
    SUBMISSION_RATE_LIMIT_PER_HOUR: process.env.SUBMISSION_RATE_LIMIT_PER_HOUR,
  };

  beforeEach(() => {
    process.env.ADMIN_EMAIL = "founder@example.com";
    process.env.AUTH_GOOGLE_ID = "google-id";
    process.env.AUTH_GOOGLE_SECRET = "google-secret";
    process.env.AUTH_SECRET = "secret";
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook";
    process.env.RESEND_API_KEY = "re_test";
  });

  afterEach(() => {
    process.env.ADMIN_EMAIL = originalEnv.ADMIN_EMAIL;
    process.env.AUTH_GOOGLE_ID = originalEnv.AUTH_GOOGLE_ID;
    process.env.AUTH_GOOGLE_SECRET = originalEnv.AUTH_GOOGLE_SECRET;
    process.env.AUTH_SECRET = originalEnv.AUTH_SECRET;
    process.env.DISCORD_WEBHOOK_URL = originalEnv.DISCORD_WEBHOOK_URL;
    process.env.RESEND_API_KEY = originalEnv.RESEND_API_KEY;
    process.env.AUTH_RATE_LIMIT_PER_HOUR = originalEnv.AUTH_RATE_LIMIT_PER_HOUR;
    process.env.GRADEBOOK_RATE_LIMIT_PER_HOUR = originalEnv.GRADEBOOK_RATE_LIMIT_PER_HOUR;
    process.env.SUBMISSION_RATE_LIMIT_PER_HOUR = originalEnv.SUBMISSION_RATE_LIMIT_PER_HOUR;
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("only sends Discord notifications for teacher_upgraded, not sign-ins or class/assignment events", async () => {
    vi.doMock("@/lib/db", () => ({
      findTeacherFunnelRowByEmail: vi.fn().mockResolvedValue(null),
      logActivityEvent: vi.fn().mockResolvedValue(undefined),
    }));

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const { notifyDiscordActivity } = await import("@/lib/activity");

    notifyDiscordActivity("user_signed_in", "teacher@example.com");
    notifyDiscordActivity("class_created", "teacher@example.com");
    notifyDiscordActivity("assignment_created", "teacher@example.com");
    expect(mockFetch).not.toHaveBeenCalled();

    notifyDiscordActivity("teacher_upgraded", "teacher@example.com");
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining("a teacher account was enabled") })
    );
    expect(JSON.stringify(mockFetch.mock.calls)).not.toContain("teacher@example.com");
  });

  it("keeps Google sign-in working when activity logging or Discord fail", async () => {
    const mockUpsertGoogleUserAndGetRole = vi.fn().mockResolvedValue("student");
    const mockGetUserRoleByEmail = vi.fn().mockResolvedValue("student");
    const mockLogActivityEvent = vi.fn().mockRejectedValue(new Error("db down"));

    vi.doMock("@/lib/db", () => ({
      getUserRoleByEmail: mockGetUserRoleByEmail,
      listTeacherFunnelRows: vi.fn().mockResolvedValue([]),
      logActivityEvent: mockLogActivityEvent,
      upsertGoogleUserAndGetRole: mockUpsertGoogleUserAndGetRole,
    }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("discord down")));

    const { authOptions } = await import("@/auth");

    const result = await authOptions.callbacks!.signIn!({
      account: { provider: "google", providerAccountId: "acct_1", type: "oauth" } as never,
      profile: { email: "teacher@example.com", email_verified: true } as never,
      user: undefined as never,
      credentials: undefined,
    });

    expect(result).toBe(true);
    expect(mockUpsertGoogleUserAndGetRole).toHaveBeenCalledWith("teacher@example.com");
    expect(mockLogActivityEvent).toHaveBeenCalled();
  });

  it("keeps class creation working when Discord activity delivery fails", async () => {
    const mockCreateClass = vi.fn().mockResolvedValue({
      id: "class_1",
      name: "Spanish 1",
      ownerEmail: "teacher@example.com",
      createdAt: Date.now(),
    });
    const mockLogActivityEvent = vi.fn().mockRejectedValue(new Error("db down"));

    vi.doMock("@/lib/authz", () => ({
      requireTeacherEmail: vi.fn().mockResolvedValue("teacher@example.com"),
    }));
    vi.doMock("@/lib/db", () => ({
      createClass: mockCreateClass,
      listClassesByTeacher: vi.fn().mockResolvedValue([]),
      findTeacherFunnelRowByEmail: vi.fn().mockResolvedValue({
        email: "teacher@example.com",
        role: "teacher",
        joinedAt: Date.now(),
        classCount: 1,
        assignmentCount: 0,
        latestActivityAt: Date.now(),
      }),
      logActivityEvent: mockLogActivityEvent,
    }));
    vi.doMock("@/lib/http", () => ({
      withApiHandler: async (_request: Request, handler: () => Promise<Response>) => await handler(),
    }));
    vi.doMock("@/lib/validation", () => ({
      classCreateSchema: {},
      parseOrThrow400: vi.fn().mockImplementation((_schema, input) => input),
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { POST } = await import("@/app/api/classes/route");

    const response = await POST(
      new Request("http://localhost/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Spanish 1" }),
      })
    );

    expect(response.status).toBe(201);
    expect(mockCreateClass).toHaveBeenCalledWith("Spanish 1", "teacher@example.com");
  });

  it("does not block teacher upgrades when Resend fails", async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error("resend down"));

    vi.doMock("resend", () => ({
      Resend: class MockResend {
        emails = {
          send: mockSend,
        };
      },
    }));

    const { sendTeacherUpgradeConfirmationEmail, teacherUpgradeEmailCopy } = await import("@/lib/email");

    expect(() => sendTeacherUpgradeConfirmationEmail("teacher@example.com")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "TryHabla <onboarding@resend.dev>",
        to: "teacher@example.com",
        subject: teacherUpgradeEmailCopy.subject,
        text: teacherUpgradeEmailCopy.text,
      })
    );
  });

  it("returns 403 for non-admin access to /admin in the proxy guard", async () => {
    const mockGetToken = vi.fn().mockResolvedValue({ email: "teacher@example.com" });

    vi.doMock("next-auth/jwt", () => ({
      getToken: mockGetToken,
    }));

    const { proxy } = await import("@/proxy");

    const response = await proxy({
      headers: new Headers(),
      nextUrl: new URL("http://localhost/admin"),
      url: "http://localhost/admin",
    } as never);

    expect(response.status).toBe(403);
  });

  it("allows the configured admin through the /admin proxy guard", async () => {
    const mockGetToken = vi.fn().mockResolvedValue({ email: "founder@example.com" });

    vi.doMock("next-auth/jwt", () => ({
      getToken: mockGetToken,
    }));

    const { proxy } = await import("@/proxy");

    const response = await proxy({
      headers: new Headers(),
      nextUrl: new URL("http://localhost/admin"),
      url: "http://localhost/admin",
    } as never);

    expect(response.status).toBe(200);
  });

  it("uses classroom-safe default rate limits", async () => {
    delete process.env.SUBMISSION_RATE_LIMIT_PER_HOUR;
    delete process.env.AUTH_RATE_LIMIT_PER_HOUR;
    delete process.env.GRADEBOOK_RATE_LIMIT_PER_HOUR;

    const {
      DEFAULT_AUTH_LIMIT_PER_HOUR,
      DEFAULT_GRADEBOOK_LIMIT_PER_HOUR,
      DEFAULT_SUBMISSION_LIMIT_PER_HOUR,
      getAuthLimitPerHour,
      getGradebookLimitPerHour,
      getSubmissionLimitPerHour,
    } = await import("@/lib/rate-limit");

    expect(DEFAULT_SUBMISSION_LIMIT_PER_HOUR).toBeGreaterThanOrEqual(30);
    expect(DEFAULT_AUTH_LIMIT_PER_HOUR).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_GRADEBOOK_LIMIT_PER_HOUR).toBeGreaterThanOrEqual(10);
    expect(getSubmissionLimitPerHour()).toBe(DEFAULT_SUBMISSION_LIMIT_PER_HOUR);
    expect(getAuthLimitPerHour()).toBe(DEFAULT_AUTH_LIMIT_PER_HOUR);
    expect(getGradebookLimitPerHour()).toBe(DEFAULT_GRADEBOOK_LIMIT_PER_HOUR);
  });
});

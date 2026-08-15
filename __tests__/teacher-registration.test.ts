import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedEmail: vi.fn(),
  getUserRoleByEmail: vi.fn(),
  setUserRoleTeacher: vi.fn(),
  trackActivity: vi.fn(),
  sendTeacherUpgradeConfirmationEmail: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireAuthenticatedEmail: mocks.requireAuthenticatedEmail,
}));

vi.mock("@/lib/db", () => ({
  getUserRoleByEmail: mocks.getUserRoleByEmail,
  setUserRoleTeacher: mocks.setUserRoleTeacher,
}));

vi.mock("@/lib/activity", () => ({
  trackActivity: mocks.trackActivity,
}));

vi.mock("@/lib/email", () => ({
  sendTeacherUpgradeConfirmationEmail: mocks.sendTeacherUpgradeConfirmationEmail,
}));

vi.mock("@/lib/http", async () => {
  class MockHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    HttpError: MockHttpError,
    withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        if (error instanceof MockHttpError) {
          return Response.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
    },
  };
});

describe("teacher registration controls", () => {
  const originalEnv = {
    ALLOW_TEACHER_SELF_REGISTRATION: process.env.ALLOW_TEACHER_SELF_REGISTRATION,
    TEACHER_ALLOWLIST: process.env.TEACHER_ALLOWLIST,
  };

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ALLOW_TEACHER_SELF_REGISTRATION;
    delete process.env.TEACHER_ALLOWLIST;
    mocks.requireAuthenticatedEmail.mockReset();
    mocks.getUserRoleByEmail.mockReset();
    mocks.setUserRoleTeacher.mockReset();
    mocks.trackActivity.mockReset();
    mocks.sendTeacherUpgradeConfirmationEmail.mockReset();
    mocks.requireAuthenticatedEmail.mockResolvedValue("new-teacher@example.com");
    mocks.getUserRoleByEmail.mockResolvedValue("student");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.ALLOW_TEACHER_SELF_REGISTRATION = originalEnv.ALLOW_TEACHER_SELF_REGISTRATION;
    process.env.TEACHER_ALLOWLIST = originalEnv.TEACHER_ALLOWLIST;
  });

  function request() {
    return new Request("http://localhost/api/auth/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "teacher" }),
    });
  }

  it("blocks production teacher self-upgrade by default", async () => {
    const { POST } = await import("@/app/api/auth/role/route");

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.setUserRoleTeacher).not.toHaveBeenCalled();
  });

  it("allows production self-upgrade for allowlisted teachers", async () => {
    process.env.TEACHER_ALLOWLIST = "new-teacher@example.com";
    const { POST } = await import("@/app/api/auth/role/route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.setUserRoleTeacher).toHaveBeenCalledWith("new-teacher@example.com");
  });

  it("does not lock out existing teachers who revisit setup", async () => {
    mocks.getUserRoleByEmail.mockResolvedValue("teacher");
    const { POST } = await import("@/app/api/auth/role/route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.setUserRoleTeacher).toHaveBeenCalledWith("new-teacher@example.com");
  });
});

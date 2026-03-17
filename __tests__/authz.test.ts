import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { getUserRoleByEmail } from "@/lib/db";
import { requireRole, requireTeacherEmail } from "@/lib/authz";

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getUserRoleByEmail: vi.fn(),
}));

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedGetUserRoleByEmail = vi.mocked(getUserRoleByEmail);

describe("authz", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    LOCAL_DEV_BYPASS_AUTH: process.env.LOCAL_DEV_BYPASS_AUTH,
  };

  beforeEach(() => {
    process.env = {
      ...process.env,
      NODE_ENV: "test",
      LOCAL_DEV_BYPASS_AUTH: "false",
    };
    mockedGetServerSession.mockReset();
    mockedGetUserRoleByEmail.mockReset();
  });

  afterEach(() => {
    process.env = {
      ...process.env,
      NODE_ENV: originalEnv.NODE_ENV,
      LOCAL_DEV_BYPASS_AUTH: originalEnv.LOCAL_DEV_BYPASS_AUTH,
    };
  });

  it("returns 403 for a student-role session on teacher routes", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { email: "student@example.com" },
    } as never);
    mockedGetUserRoleByEmail.mockResolvedValue("student");

    await expect(requireTeacherEmail()).rejects.toMatchObject({
      status: 403,
      message: "You don't have access to this page.",
    });
  });

  it("passes for a teacher-role session", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { email: "teacher@example.com" },
    } as never);
    mockedGetUserRoleByEmail.mockResolvedValue("teacher");

    await expect(requireTeacherEmail()).resolves.toBe("teacher@example.com");
  });

  it("allows bypass when LOCAL_DEV_BYPASS_AUTH=true", async () => {
    process.env.LOCAL_DEV_BYPASS_AUTH = "true";

    await expect(requireTeacherEmail()).resolves.toBe("dev-teacher@local.test");
  });

  it("returns 401 when no authenticated session is present", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    await expect(requireTeacherEmail()).rejects.toMatchObject({
      status: 401,
      message: "You'll need to sign in first.",
    });
  });

  it("checks arbitrary roles through requireRole", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { email: "student@example.com" },
    } as never);
    mockedGetUserRoleByEmail.mockResolvedValue("student");

    await expect(requireRole("student")).resolves.toBe("student@example.com");
  });
});

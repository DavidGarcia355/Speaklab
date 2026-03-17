import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertGoogleUserAndGetRole: vi.fn(),
  getUserRoleByEmail: vi.fn(),
  trackActivity: vi.fn(),
  requireAuthenticatedEmail: vi.fn(),
  setUserRoleTeacher: vi.fn(),
  findClassById: vi.fn(),
  createClass: vi.fn(),
  createAssignment: vi.fn(),
  uploadAssignmentAttachment: vi.fn(),
  parseOrThrow400: vi.fn(),
  buildTeacherEventMetadata: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  upsertGoogleUserAndGetRole: mocks.upsertGoogleUserAndGetRole,
  getUserRoleByEmail: mocks.getUserRoleByEmail,
  setUserRoleTeacher: mocks.setUserRoleTeacher,
  findClassById: mocks.findClassById,
  createClass: mocks.createClass,
  createAssignment: mocks.createAssignment,
}));

vi.mock("@/lib/activity", () => ({
  trackActivity: mocks.trackActivity,
  buildTeacherEventMetadata: mocks.buildTeacherEventMetadata,
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/authz", () => ({
  requireAuthenticatedEmail: mocks.requireAuthenticatedEmail,
  requireTeacherEmail: mocks.requireAuthenticatedEmail,
}));

vi.mock("@/lib/attachment-storage", () => ({
  uploadAssignmentAttachment: mocks.uploadAssignmentAttachment,
}));

vi.mock("@/lib/validation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/validation")>("@/lib/validation");
  return {
    ...actual,
    parseOrThrow400: mocks.parseOrThrow400,
  };
});

vi.mock("@/lib/http", async () => {
  class MockHttpError extends Error {
    status: number;
    fieldErrors?: Record<string, string[]>;

    constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
      super(message);
      this.status = status;
      this.fieldErrors = fieldErrors;
    }
  }

  return {
    HttpError: MockHttpError,
    withApiHandler: async (_request: Request, handler: () => Promise<Response>) => {
      try {
        return await handler();
      } catch (error) {
        if (error instanceof MockHttpError) {
          return Response.json(
            error.fieldErrors
              ? { error: error.message, fieldErrors: error.fieldErrors }
              : { error: error.message },
            { status: error.status }
          );
        }
        throw error;
      }
    },
  };
});

describe("tracking hooks", () => {
  const originalEnv = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
  };

  beforeEach(() => {
    process.env.AUTH_SECRET = "secret";
    process.env.AUTH_GOOGLE_ID = "google-id";
    process.env.AUTH_GOOGLE_SECRET = "google-secret";

    mocks.upsertGoogleUserAndGetRole.mockReset();
    mocks.getUserRoleByEmail.mockReset();
    mocks.trackActivity.mockReset();
    mocks.requireAuthenticatedEmail.mockReset();
    mocks.getServerSession.mockReset();
    mocks.setUserRoleTeacher.mockReset();
    mocks.findClassById.mockReset();
    mocks.createClass.mockReset();
    mocks.createAssignment.mockReset();
    mocks.uploadAssignmentAttachment.mockReset();
    mocks.parseOrThrow400.mockReset();
    mocks.buildTeacherEventMetadata.mockReset();

    mocks.upsertGoogleUserAndGetRole.mockResolvedValue("student");
    mocks.getUserRoleByEmail.mockResolvedValue("student");
    mocks.trackActivity.mockResolvedValue(undefined);
    mocks.requireAuthenticatedEmail.mockResolvedValue("teacher@example.com");
    mocks.getServerSession.mockResolvedValue({
      user: { email: "founder@example.com" },
    });
    mocks.setUserRoleTeacher.mockResolvedValue(undefined);
    mocks.findClassById.mockResolvedValue({ id: "class_1", name: "Spanish 1" });
    mocks.createClass.mockResolvedValue({
      id: "class_1",
      name: "Spanish 1",
      ownerEmail: "teacher@example.com",
      createdAt: Date.now(),
    });
    mocks.createAssignment.mockResolvedValue({
      id: "asg_1",
      classId: "class_1",
      title: "Oral quiz",
      description: "",
      instructions: "Speak",
      maxPoints: 10,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
      createdAt: Date.now(),
    });
    mocks.parseOrThrow400.mockImplementation((_schema, input) => input);
    mocks.buildTeacherEventMetadata.mockResolvedValue({
      isFirstClass: true,
      isFirstAssignment: true,
    });
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalEnv.AUTH_SECRET;
    process.env.AUTH_GOOGLE_ID = originalEnv.AUTH_GOOGLE_ID;
    process.env.AUTH_GOOGLE_SECRET = originalEnv.AUTH_GOOGLE_SECRET;
    vi.resetModules();
  });

  it("logs user_signed_in from the auth sign-in callback", async () => {
    const { authOptions } = await import("@/auth");

    const result = await authOptions.callbacks!.signIn!({
      account: { provider: "google", providerAccountId: "acct_1", type: "oauth" } as never,
      profile: { email: "Teacher@Example.com", email_verified: true } as never,
      user: undefined as never,
      credentials: undefined,
    });

    expect(result).toBe(true);
    expect(mocks.upsertGoogleUserAndGetRole).toHaveBeenCalledWith("teacher@example.com");
    expect(mocks.trackActivity).toHaveBeenCalledWith("user_signed_in", "teacher@example.com");
  });

  it("logs teacher_upgraded from the role route", async () => {
    const { POST } = await import("@/app/api/auth/role/route");

    const response = await POST(
      new Request("http://localhost/api/auth/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "teacher" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.setUserRoleTeacher).toHaveBeenCalledWith("teacher@example.com");
    expect(mocks.trackActivity).toHaveBeenCalledWith("teacher_upgraded", "teacher@example.com");
  });

  it("logs class_created from the classes route", async () => {
    const { POST } = await import("@/app/api/classes/route");

    const response = await POST(
      new Request("http://localhost/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Spanish 1" }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.trackActivity).toHaveBeenCalledWith(
      "class_created",
      "teacher@example.com",
      expect.objectContaining({
        classId: "class_1",
        className: "Spanish 1",
        isFirstClass: true,
      })
    );
  });

  it("logs assignment_created from the assignment creation route", async () => {
    const { POST } = await import("@/app/api/classes/[classId]/assignments/route");

    const response = await POST(
      new Request("http://localhost/api/classes/class_1/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Oral quiz",
          description: "",
          instructions: "Speak",
          maxPoints: 10,
        }),
      }),
      { params: Promise.resolve({ classId: "class_1" }) }
    );

    expect(response.status).toBe(201);
    expect(mocks.trackActivity).toHaveBeenCalledWith(
      "assignment_created",
      "teacher@example.com",
      expect.objectContaining({
        assignmentId: "asg_1",
        assignmentTitle: "Oral quiz",
        classId: "class_1",
        isFirstAssignment: true,
      })
    );
  });
});

describe("activity helper", () => {
  const originalEnv = {
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
  };

  beforeEach(() => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook";
    vi.resetModules();
  });

  afterEach(() => {
    process.env.DISCORD_WEBHOOK_URL = originalEnv.DISCORD_WEBHOOK_URL;
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/db");
  });

  it("does not throw when the Discord webhook fails", async () => {
    vi.doMock("@/lib/db", () => ({
      logActivityEvent: vi.fn().mockResolvedValue(undefined),
      getTrackingSummary: vi.fn(),
      listTeacherFunnelRows: vi.fn(),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );

    const { trackActivity } = await import("@/lib/activity");

    await expect(trackActivity("user_signed_in", "teacher@example.com")).resolves.toBeUndefined();
  });
});

describe("admin access helper", () => {
  const originalEnv = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  beforeEach(() => {
    process.env.ADMIN_EMAIL = "founder@example.com";
    mocks.requireAuthenticatedEmail.mockReset();
    mocks.getServerSession.mockReset();
  });

  afterEach(() => {
    process.env.ADMIN_EMAIL = originalEnv.ADMIN_EMAIL;
    vi.resetModules();
  });

  it("allows the configured founder email", async () => {
    mocks.requireAuthenticatedEmail.mockResolvedValue("founder@example.com");
    mocks.getServerSession.mockResolvedValue({
      user: { email: "founder@example.com" },
    });
    const { requireAdminEmail } = await import("@/lib/admin");

    await expect(requireAdminEmail()).resolves.toEqual({
      email: "founder@example.com",
      allowed: true,
    });
  });

  it("blocks any other signed-in user", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { email: "teacher@example.com" },
    });
    const { requireAdminEmail } = await import("@/lib/admin");

    await expect(requireAdminEmail()).resolves.toEqual({
      email: "teacher@example.com",
      allowed: false,
    });
  });
});

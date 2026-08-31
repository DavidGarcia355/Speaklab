import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFeedbackMessage: vi.fn(),
  sendFeedbackNotification: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  enqueueSchoolLeadAlert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  createFeedbackMessage: mocks.createFeedbackMessage,
}));

vi.mock("@/lib/email", () => ({
  sendFeedbackNotification: mocks.sendFeedbackNotification,
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
}));

vi.mock("@/lib/admin-alert-lifecycle", () => ({
  enqueueSchoolLeadAlert: mocks.enqueueSchoolLeadAlert,
}));

vi.mock("@/lib/http", () => ({
  getClientIp: () => "test-client",
  withApiHandler: async (_request: Request, handler: () => Promise<Response>) => handler(),
}));

describe("feedback admin alert intent", () => {
  beforeEach(() => {
    mocks.createFeedbackMessage.mockReset().mockResolvedValue({
      id: "fb_opaque_1",
      createdAt: 1,
    });
    mocks.sendFeedbackNotification.mockReset();
    mocks.enforceAuthRateLimit.mockReset().mockResolvedValue(undefined);
    mocks.enqueueSchoolLeadAlert.mockReset().mockResolvedValue(undefined);
  });

  function request(
    intent?: "auth" | "schools" | "school-pilot",
    context?: {
      source: "auth";
      authErrorCode: "AccessDenied";
      route: string;
    }
  ) {
    return new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 FBAN/FBIOS FBAV/455.0 sensitive-fragment",
      },
      body: JSON.stringify({
        name: "Casey Contact",
        email: "casey@district.example",
        school: "Example Unified School District",
        role: "Curriculum director",
        message: "We would like to discuss a pilot for our language teachers.",
        ...(intent ? { intent } : {}),
        ...(context ? { context } : {}),
      }),
    });
  }

  it("keeps generic feedback out of school-lead alerts", async () => {
    const { POST } = await import("@/app/api/feedback/route");

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.enqueueSchoolLeadAlert).not.toHaveBeenCalled();
  });

  it("enqueues only the opaque record for Schools intent", async () => {
    const { POST } = await import("@/app/api/feedback/route");

    const response = await POST(request("schools"));

    expect(response.status).toBe(201);
    expect(mocks.enqueueSchoolLeadAlert).toHaveBeenCalledWith({
      feedbackId: "fb_opaque_1",
    });
    expect(JSON.stringify(mocks.enqueueSchoolLeadAlert.mock.calls)).not.toContain(
      "Example Unified School District",
    );
    expect(JSON.stringify(mocks.enqueueSchoolLeadAlert.mock.calls)).not.toContain(
      "casey@district.example",
    );
    expect(JSON.stringify(mocks.enqueueSchoolLeadAlert.mock.calls)).not.toContain(
      "Curriculum director",
    );
  });

  it("keeps the legacy school-pilot intent compatible", async () => {
    const { POST } = await import("@/app/api/feedback/route");

    const response = await POST(request("school-pilot"));

    expect(response.status).toBe(201);
    expect(mocks.enqueueSchoolLeadAlert).toHaveBeenCalledWith({
      feedbackId: "fb_opaque_1",
    });
  });

  it("attaches safe access context to support messages", async () => {
    const { POST } = await import("@/app/api/feedback/route");

    const response = await POST(
      request("auth", {
        source: "auth",
        authErrorCode: "AccessDenied",
        route: "/auth/error?token=must-not-persist",
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createFeedbackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          source: "auth",
          authErrorCode: "AccessDenied",
          browserCategory: "facebook",
          route: "/auth/error",
        },
      })
    );
    expect(mocks.sendFeedbackNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          source: "auth",
          authErrorCode: "AccessDenied",
          browserCategory: "facebook",
          route: "/auth/error",
        },
      })
    );
    expect(JSON.stringify(mocks.createFeedbackMessage.mock.calls)).not.toContain(
      "must-not-persist"
    );
    expect(JSON.stringify(mocks.createFeedbackMessage.mock.calls)).not.toContain(
      "sensitive-fragment"
    );
    expect(mocks.enqueueSchoolLeadAlert).not.toHaveBeenCalled();
  });
});

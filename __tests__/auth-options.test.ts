import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserRoleByEmail: vi.fn(),
  trackActivity: vi.fn(),
  upsertGoogleUserAndGetRole: vi.fn(),
  enqueueTeacherSignedUpAlert: vi.fn(),
  logAuthDiagnostic: vi.fn(),
}));

vi.mock("@/lib/auth-diagnostics", () => ({
  logAuthDiagnostic: mocks.logAuthDiagnostic,
  safeDiagnosticCode: (value: string) => value,
}));

vi.mock("@/lib/activity", () => ({
  trackActivity: mocks.trackActivity,
}));

vi.mock("@/lib/db", () => ({
  getUserRoleByEmail: mocks.getUserRoleByEmail,
  upsertGoogleUserAndGetRole: mocks.upsertGoogleUserAndGetRole,
}));

vi.mock("@/lib/admin-alert-lifecycle", () => ({
  enqueueTeacherSignedUpAlert: mocks.enqueueTeacherSignedUpAlert,
}));

const managedEnvKeys = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_MICROSOFT_ID",
  "AUTH_MICROSOFT_SECRET",
  "AUTH_MICROSOFT_TENANT_ID",
] as const;

const originalEnv = Object.fromEntries(
  managedEnvKeys.map((key) => [key, process.env[key]])
) as Record<(typeof managedEnvKeys)[number], string | undefined>;

type TestProvider = {
  id: string;
  name: string;
  options?: {
    clientId?: string;
    clientSecret?: string;
  };
};

function setOptionalEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

async function loadAuthOptions({
  microsoftId,
  microsoftSecret,
}: {
  microsoftId?: string;
  microsoftSecret?: string;
} = {}) {
  setOptionalEnv("AUTH_MICROSOFT_ID", microsoftId);
  setOptionalEnv("AUTH_MICROSOFT_SECRET", microsoftSecret);
  vi.resetModules();

  const { authOptions } = await import("@/auth");
  return authOptions;
}

describe("auth options", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret";
    process.env.AUTH_GOOGLE_ID = "google-client-id";
    process.env.AUTH_GOOGLE_SECRET = "google-client-secret";
    delete process.env.AUTH_MICROSOFT_ID;
    delete process.env.AUTH_MICROSOFT_SECRET;
    delete process.env.AUTH_MICROSOFT_TENANT_ID;

    mocks.getUserRoleByEmail.mockReset().mockResolvedValue("student");
    mocks.trackActivity.mockReset().mockResolvedValue(undefined);
    mocks.upsertGoogleUserAndGetRole.mockReset().mockResolvedValue("student");
    mocks.enqueueTeacherSignedUpAlert.mockReset().mockResolvedValue(undefined);
    mocks.logAuthDiagnostic.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const key of managedEnvKeys) {
      setOptionalEnv(key, originalEnv[key]);
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each([
    ["neither Microsoft credential", undefined, undefined],
    ["only a Microsoft client ID", "microsoft-client-id", undefined],
    ["only a Microsoft client secret", undefined, "microsoft-client-secret"],
  ])("keeps Google and omits Microsoft with %s", async (_label, microsoftId, microsoftSecret) => {
    const authOptions = await loadAuthOptions({ microsoftId, microsoftSecret });
    const providers = authOptions.providers as unknown as TestProvider[];

    expect(providers.map(({ id }) => id)).toEqual(["google"]);
  });

  it("adds Microsoft only when both trimmed credentials are present", async () => {
    const authOptions = await loadAuthOptions({
      microsoftId: "  microsoft-client-id  ",
      microsoftSecret: "  microsoft-client-secret  ",
    });
    const providers = authOptions.providers as unknown as TestProvider[];
    const microsoftProvider = providers.find(({ id }) => id === "azure-ad");

    expect(providers.map(({ id }) => id)).toEqual(["google", "azure-ad"]);
    expect(microsoftProvider).toMatchObject({
      id: "azure-ad",
      name: "Microsoft",
      options: {
        clientId: "microsoft-client-id",
        clientSecret: "microsoft-client-secret",
      },
    });
  });

  it("uses the TryHabla sign-in theme", async () => {
    const authOptions = await loadAuthOptions();

    expect(authOptions.theme).toMatchObject({
      logo: "/tryhabla-auth-logo.svg",
      brandColor: "#1374ad",
    });
    expect(authOptions.pages).toEqual({ error: "/auth/error" });
  });

  it("accepts Microsoft sign-in and upserts the exact lowercase email", async () => {
    const authOptions = await loadAuthOptions();

    const result = await authOptions.callbacks!.signIn!({
      account: { provider: "azure-ad", providerAccountId: "account-1", type: "oauth" } as never,
      profile: { email: "Teacher@Example.COM" } as never,
      user: undefined as never,
      credentials: undefined,
    });

    expect(result).toBe(true);
    expect(mocks.upsertGoogleUserAndGetRole).toHaveBeenCalledOnce();
    expect(mocks.upsertGoogleUserAndGetRole).toHaveBeenCalledWith("teacher@example.com");
    expect(mocks.enqueueTeacherSignedUpAlert).not.toHaveBeenCalled();
  });

  it("enqueues a teacher signup only when sign-in commits a teacher transition", async () => {
    mocks.upsertGoogleUserAndGetRole.mockResolvedValue("teacher");
    const authOptions = await loadAuthOptions();

    const result = await authOptions.callbacks!.signIn!({
      account: { provider: "google", providerAccountId: "account-1", type: "oauth" } as never,
      profile: { email: "Teacher@Example.COM", email_verified: true } as never,
      user: undefined as never,
      credentials: undefined,
    });

    expect(result).toBe(true);
    expect(mocks.enqueueTeacherSignedUpAlert).toHaveBeenCalledWith({
      teacherEmail: "teacher@example.com",
      source: "other",
    });
  });

  it("rejects sign-in when the provider profile has no email", async () => {
    const authOptions = await loadAuthOptions();

    const result = await authOptions.callbacks!.signIn!({
      account: { provider: "azure-ad", providerAccountId: "account-1", type: "oauth" } as never,
      profile: {} as never,
      user: undefined as never,
      credentials: undefined,
    });

    expect(result).toBe(false);
    expect(mocks.upsertGoogleUserAndGetRole).not.toHaveBeenCalled();
  });

  it("rejects unsupported identity providers", async () => {
    const authOptions = await loadAuthOptions();

    const result = await authOptions.callbacks!.signIn!({
      account: { provider: "github", providerAccountId: "account-1", type: "oauth" } as never,
      profile: { email: "teacher@example.com" } as never,
      user: undefined as never,
      credentials: undefined,
    });

    expect(result).toBe(false);
    expect(mocks.upsertGoogleUserAndGetRole).not.toHaveBeenCalled();
  });
});

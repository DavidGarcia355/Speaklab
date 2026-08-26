import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dataDir = path.join(process.cwd(), "data");
const localDbPath = path.join(dataDir, "access-provisioning-test.db");

async function loadDbModule() {
  vi.resetModules();
  return await import("@/lib/db");
}

describe("tester access provisioning", () => {
  const originalEnv = {
    TEACHER_ALLOWLIST: process.env.TEACHER_ALLOWLIST,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  beforeAll(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
  });

  beforeEach(() => {
    delete process.env.TEACHER_ALLOWLIST;
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
  });

  afterEach(() => {
    process.env.TEACHER_ALLOWLIST = originalEnv.TEACHER_ALLOWLIST;
    process.env.ADMIN_EMAILS = originalEnv.ADMIN_EMAILS;
    process.env.ADMIN_EMAIL = originalEnv.ADMIN_EMAIL;
  });

  it("grants the teacher role without silently granting AI allowance", async () => {
    process.env.TEACHER_ALLOWLIST = "first-timer@example.com";
    const db = await loadDbModule();

    const role = await db.upsertGoogleUserAndGetRole("first-timer@example.com");

    expect(role).toBe("teacher");
    expect(await db.getUserIsPaid("first-timer@example.com")).toBe(false);
  });

  // Regression: ON CONFLICT DO NOTHING meant an account that had already signed in
  // as a student could never be promoted by adding it to the allowlist. It failed
  // silently - every teacher API just returned 403.
  it("promotes an existing student account once it is added to the allowlist", async () => {
    const db = await loadDbModule();

    const initialRole = await db.upsertGoogleUserAndGetRole("late-add@example.com");
    expect(initialRole).toBe("student");
    expect(await db.getUserIsPaid("late-add@example.com")).toBe(false);

    process.env.TEACHER_ALLOWLIST = "late-add@example.com";
    const promotedRole = await db.upsertGoogleUserAndGetRole("late-add@example.com");

    expect(promotedRole).toBe("teacher");
    expect(await db.getUserIsPaid("late-add@example.com")).toBe(false);
  });

  it("gives admin emails teacher access without silently granting AI allowance", async () => {
    process.env.ADMIN_EMAILS = "owner@example.com, second-admin@example.com";
    const db = await loadDbModule();

    expect(await db.upsertGoogleUserAndGetRole("owner@example.com")).toBe("teacher");
    expect(await db.upsertGoogleUserAndGetRole("second-admin@example.com")).toBe("teacher");
    expect(await db.getUserIsPaid("second-admin@example.com")).toBe(false);
  });

  it("requires an explicit operator grant for manual lifetime AI access", async () => {
    process.env.TEACHER_ALLOWLIST = "pilot@example.com";
    const db = await loadDbModule();

    expect(await db.upsertGoogleUserAndGetRole("pilot@example.com")).toBe("teacher");
    expect(await db.getUserIsPaid("pilot@example.com")).toBe(false);

    expect(await db.setUserPaid("pilot@example.com", true)).toBe(true);
    expect(await db.getUserIsPaid("pilot@example.com")).toBe(true);

    await db.upsertGoogleUserAndGetRole("pilot@example.com");
    expect(await db.getUserIsPaid("pilot@example.com")).toBe(true);
  });

  it("still honors the deprecated single ADMIN_EMAIL variable", async () => {
    process.env.ADMIN_EMAIL = "legacy-admin@example.com";
    const db = await loadDbModule();

    expect(await db.upsertGoogleUserAndGetRole("legacy-admin@example.com")).toBe("teacher");
  });

  it("leaves ordinary students untouched", async () => {
    process.env.TEACHER_ALLOWLIST = "someone-else@example.com";
    const db = await loadDbModule();

    const role = await db.upsertGoogleUserAndGetRole("pupil@example.com");

    expect(role).toBe("student");
    expect(await db.getUserIsPaid("pupil@example.com")).toBe(false);
  });

  it("never demotes a teacher who is not on the allowlist", async () => {
    const db = await loadDbModule();

    await db.setUserRoleTeacher("established@example.com");
    const role = await db.upsertGoogleUserAndGetRole("established@example.com");

    expect(role).toBe("teacher");
  });
});

describe("admin email matching", () => {
  const originalEnv = {
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalEnv.ADMIN_EMAILS;
    process.env.ADMIN_EMAIL = originalEnv.ADMIN_EMAIL;
  });

  async function loadAdminModule() {
    vi.doMock("@/auth", () => ({ authOptions: {} }));
    vi.doMock("next-auth", () => ({ getServerSession: vi.fn() }));
    return await import("@/lib/admin");
  }

  it("allows every email listed in ADMIN_EMAILS", async () => {
    process.env.ADMIN_EMAILS = "one@example.com,two@example.com";
    const admin = await loadAdminModule();

    expect(admin.isAdminEmail("one@example.com")).toBe(true);
    expect(admin.isAdminEmail("two@example.com")).toBe(true);
    expect(admin.isAdminEmail("nope@example.com")).toBe(false);
  });

  it("merges the legacy ADMIN_EMAIL with ADMIN_EMAILS", async () => {
    process.env.ADMIN_EMAILS = "new@example.com";
    process.env.ADMIN_EMAIL = "legacy@example.com";
    const admin = await loadAdminModule();

    expect(admin.isAdminEmail("new@example.com")).toBe(true);
    expect(admin.isAdminEmail("legacy@example.com")).toBe(true);
  });

  it("is case and whitespace insensitive", async () => {
    process.env.ADMIN_EMAILS = "  Mixed.Case@Example.COM , spaced@example.com ";
    const admin = await loadAdminModule();

    expect(admin.isAdminEmail("mixed.case@example.com")).toBe(true);
    expect(admin.isAdminEmail(" spaced@example.com ")).toBe(true);
  });

  it("denies everyone when no admin email is configured", async () => {
    const admin = await loadAdminModule();

    expect(admin.isAdminEmail("anyone@example.com")).toBe(false);
    expect(admin.isAdminEmail("")).toBe(false);
  });
});

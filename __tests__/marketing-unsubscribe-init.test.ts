import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
};

function restoreEnvironmentValue(key: keyof typeof originalEnv) {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("marketing unsubscribe initialization", () => {
  afterEach(() => {
    restoreEnvironmentValue("AUTH_SECRET");
    restoreEnvironmentValue("TURSO_AUTH_TOKEN");
    restoreEnvironmentValue("TURSO_DATABASE_URL");
    vi.resetModules();
  });

  it("can be imported during a build without opening remote storage", async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.AUTH_SECRET = "test-signing-secret";
    vi.resetModules();

    const marketing = await import("@/lib/marketing-unsubscribe");

    expect(marketing.normalizeMarketingEmail(" Teacher@Example.COM ")).toBe(
      "teacher@example.com"
    );
    expect(marketing.createMarketingUnsubscribeToken("teacher@example.com")).toMatch(
      /^[A-Za-z0-9_-]+$/
    );
    await expect(marketing.unsubscribeMarketingEmail("teacher@example.com")).rejects.toThrow(
      "Marketing unsubscribe storage requires Turso configuration."
    );
  });
});

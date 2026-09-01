import { afterEach, describe, expect, it, vi } from "vitest";

describe("production database configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("fails closed instead of creating an ephemeral local database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURSO_DATABASE_URL", "");
    vi.stubEnv("TURSO_AUTH_TOKEN", "");
    vi.resetModules();

    const database = await import("@/lib/db");
    await expect(database.getUserRoleByEmail("teacher@example.com")).rejects.toThrow(
      "local database fallback is disabled"
    );
  }, 15_000);
});

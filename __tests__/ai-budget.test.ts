import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const localDbPath = path.join(process.cwd(), "data", "ai-budget-test.db");

async function loadDbModule() {
  vi.resetModules();
  return import("@/lib/db");
}

describe("AI monthly budget reservation", () => {
  beforeAll(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
  });

  it("atomically refuses reservations that would exceed the monthly cap", async () => {
    const db = await loadDbModule();
    const periodStart = Date.now() - 1_000;
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.reserveAiBudget({
          generationCount: 1,
          periodStart,
          monthlyBudgetUsd: 0.08,
          reservedCostUsdPerGeneration: 0.04,
        })
      )
    );

    expect(attempts.filter(Boolean)).toHaveLength(2);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const transactionEvents = vi.hoisted(() => [] as string[]);

vi.mock("@libsql/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@libsql/client")>();

  return {
    ...actual,
    createClient: (...clientArgs: Parameters<typeof actual.createClient>) => {
      const client = actual.createClient(...clientArgs);
      return new Proxy(client, {
        get(target, property) {
          if (property === "transaction") {
            return async (...transactionArgs: Parameters<typeof client.transaction>) => {
              const transaction = await target.transaction(...transactionArgs);
              return new Proxy(transaction, {
                get(transactionTarget, transactionProperty) {
                  if (transactionProperty === "rollback") {
                    return async () => {
                      transactionEvents.push("rollback:start");
                      await new Promise((resolve) => setTimeout(resolve, 5));
                      await transactionTarget.rollback();
                      transactionEvents.push("rollback:resolved");
                    };
                  }
                  if (transactionProperty === "close") {
                    return () => {
                      transactionEvents.push("close");
                      transactionTarget.close();
                    };
                  }
                  const value = Reflect.get(
                    transactionTarget,
                    transactionProperty,
                    transactionTarget,
                  );
                  return typeof value === "function" ? value.bind(transactionTarget) : value;
                },
              });
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

const localDbPath = path.join(
  os.tmpdir(),
  `speaklab-stripe-transaction-ordering-test-${process.pid}.db`,
);
const originalLocalDbPath = process.env.HABLA_LOCAL_DB_PATH;
const originalTursoUrl = process.env.TURSO_DATABASE_URL;
const originalTursoToken = process.env.TURSO_AUTH_TOKEN;

describe("Stripe billing transaction ordering", () => {
  beforeAll(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
  });

  afterAll(() => {
    if (originalLocalDbPath === undefined) delete process.env.HABLA_LOCAL_DB_PATH;
    else process.env.HABLA_LOCAL_DB_PATH = originalLocalDbPath;
    if (originalTursoUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = originalTursoUrl;
    if (originalTursoToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = originalTursoToken;
  });

  it("waits for a remote-style rollback response before closing the transaction", async () => {
    const db = await import("@/lib/db");

    // Warm schema initialization before measuring the finalizer transaction;
    // initialization owns a separate transaction and close event.
    await db.finalizeAiGradeDelivery({
      attemptId: "schema-warmup-missing-attempt",
      ownerEmail: "ordering@example.com",
      priceBookId: "ordering-test-price-book",
      billingCandidate: false,
      allowUnmeteredAccess: true,
    });
    transactionEvents.length = 0;

    await expect(
      db.finalizeAiGradeDelivery({
        attemptId: "missing-attempt",
        ownerEmail: "ordering@example.com",
        priceBookId: "ordering-test-price-book",
        billingCandidate: false,
        allowUnmeteredAccess: true,
      }),
    ).resolves.toEqual({
      status: "not_applied",
      billingRequired: false,
      reason: "attempt_ineligible",
    });

    expect(transactionEvents).toEqual(["rollback:start", "rollback:resolved", "close"]);
  });
});

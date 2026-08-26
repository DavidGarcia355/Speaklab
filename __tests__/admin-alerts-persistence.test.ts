import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const envKeys = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "HABLA_LOCAL_DB_PATH",
  "DISCORD_ADMIN_ALERTS_ENABLED",
  "DISCORD_ALERTS_ENV",
  "DISCORD_ALERTS_REFERENCE_SECRET",
  "AUTH_SECRET",
  "DISCORD_TEST_WEBHOOK_URL",
  "DISCORD_TRACTION_WEBHOOK_URL",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const TEST_WEBHOOK = "https://discord.com/api/webhooks/12345678901234567/abcdefghijklmnopqrstuvwxyz_ABCD-123456";

async function loadFreshAdminAlerts() {
  const dbPath = path.join(os.tmpdir(), `tryhabla-admin-alerts-${randomUUID()}.db`);
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.HABLA_LOCAL_DB_PATH = dbPath;
  process.env.DISCORD_ALERTS_ENV = "test";
  process.env.DISCORD_ALERTS_REFERENCE_SECRET = "r".repeat(32);
  process.env.DISCORD_TEST_WEBHOOK_URL = TEST_WEBHOOK;
  delete process.env.DISCORD_ADMIN_ALERTS_ENABLED;
  vi.resetModules();
  const alerts = await import("@/lib/admin-alerts");
  const db = await import("@/lib/db");
  return { alerts, db, dbPath };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("durable admin alert outbox", () => {
  it("migrates the outbox schema and deduplicates a safe event", async () => {
    const { alerts, db, dbPath } = await loadFreshAdminAlerts();
    const identity = alerts.deriveAdminAlertIdentity("teacher", "private@example.com");
    const event = {
      type: "teacher.signed_up",
      teacherRef: identity.ref,
      source: "referral",
    } as const;

    const first = await alerts.enqueueAdminAlert(event, {
      dedupeKey: `${identity.dedupeSubject}:signup`,
      now: 1_700_000_000_000,
    });
    const replay = await alerts.enqueueAdminAlert(event, {
      dedupeKey: `${identity.dedupeSubject}:signup`,
      now: 1_700_000_000_100,
    });

    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]?.inserted).toBe(true);
    expect(replay.rows[0]).toMatchObject({ inserted: false, id: first.rows[0]?.id });
    await expect(db.getAdminAlertOutboxHealth(1_700_000_000_200)).resolves.toMatchObject({
      pending: 1,
      due: 1,
      dead: 0,
    });

    const raw = createClient({ url: `file:${dbPath}` });
    const migration = await raw.execute({
      sql: "SELECT name FROM schema_migrations WHERE name = ?",
      args: ["2026-08-26-admin-alert-outbox-v1"],
    });
    const stored = await raw.execute(
      "SELECT safe_payload_json as payload FROM admin_alert_outbox",
    );
    expect(migration.rows).toHaveLength(1);
    expect(String(stored.rows[0]?.payload)).not.toContain("private@example.com");
    raw.close();
  });

  it("keeps the first committed payload when later lifecycle calls share its dedupe key", async () => {
    const { alerts } = await loadFreshAdminAlerts();
    const dedupeKey = "teacher:abc123:signup";
    const first = await alerts.enqueueAdminAlert({
      type: "teacher.signed_up",
      teacherRef: "T-ABCDEF123456",
      source: "direct",
    }, { dedupeKey, now: 100 });

    const replay = await alerts.enqueueAdminAlert({
      type: "teacher.signed_up",
      teacherRef: "T-ABCDEF123456",
      source: "social",
    }, { dedupeKey, now: 101 });
    expect(replay.rows[0]).toMatchObject({
      inserted: false,
      id: first.rows[0]?.id,
    });
  });

  it("keeps queued intents untouched while delivery is disabled", async () => {
    const { alerts, db } = await loadFreshAdminAlerts();
    await alerts.enqueueAdminAlert({
      type: "incident",
      code: "provider.degraded",
      summary: "Provider success rate is below the configured target.",
    }, { dedupeKey: "incident:provider-degraded:1", now: 1_000 });

    const run = await alerts.deliverPendingAdminAlerts({ now: 2_000 });
    expect(run).toMatchObject({ enabled: false, claimed: 0, delivered: 0 });
    await expect(db.getAdminAlertOutboxHealth(2_000)).resolves.toMatchObject({
      pending: 1,
      due: 1,
    });
  });

  it("routes non-production events only to the test webhook and marks them delivered", async () => {
    const { alerts, db } = await loadFreshAdminAlerts();
    process.env.DISCORD_ADMIN_ALERTS_ENABLED = "true";
    process.env.DISCORD_TRACTION_WEBHOOK_URL = "https://not-used.invalid/secret";
    await alerts.enqueueAdminAlert({
      type: "teacher.signed_up",
      teacherRef: "T-ABCDEF123456",
      source: "organic",
    }, { dedupeKey: "teacher:opaque:signup", now: 10_000 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const run = await alerts.deliverPendingAdminAlerts({
      now: 10_000,
      fetchImpl: fetchMock,
    });

    expect(run).toMatchObject({ claimed: 1, delivered: 1, dead: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(TEST_WEBHOOK);
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(requestBody).toContain("TESTING ONLY");
    expect(requestBody).not.toContain("private@example.com");
    await expect(db.getAdminAlertOutboxHealth(10_001)).resolves.toMatchObject({
      pending: 0,
      delivered: 1,
    });
  });

  it("caps oversized delivery requests to one safely leased sequential batch", async () => {
    const { alerts, db } = await loadFreshAdminAlerts();
    process.env.DISCORD_ADMIN_ALERTS_ENABLED = "true";
    await alerts.enqueueAdminAlerts(
      Array.from({ length: 9 }, (_, index) => ({
        event: {
          type: "incident" as const,
          code: "delivery.batch.test",
          summary: "Synthetic bounded delivery batch test.",
        },
        dedupeKey: `incident:delivery-batch:${index}`,
      })),
      { now: 15_000 },
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const run = await alerts.deliverPendingAdminAlerts({
      limit: 100,
      now: 15_000,
      fetchImpl: fetchMock,
    });

    expect(run).toMatchObject({ claimed: 8, delivered: 8 });
    expect(fetchMock).toHaveBeenCalledTimes(8);
    await expect(db.getAdminAlertOutboxHealth(15_001)).resolves.toMatchObject({
      pending: 1,
      delivered: 8,
    });
  });

  it("keeps the entire sequential batch leased beyond the former 30-second race window", async () => {
    const { alerts } = await loadFreshAdminAlerts();
    process.env.DISCORD_ADMIN_ALERTS_ENABLED = "true";
    await alerts.enqueueAdminAlerts(
      Array.from({ length: 8 }, (_, index) => ({
        event: {
          type: "incident" as const,
          code: "delivery.lease.test",
          summary: "Synthetic lease concurrency test.",
        },
        dedupeKey: `incident:delivery-lease:${index}`,
      })),
      { now: 16_000 },
    );

    let signalFirstRequestStarted: (() => void) | undefined;
    const firstRequestStarted = new Promise<void>((resolve) => {
      signalFirstRequestStarted = resolve;
    });
    let releaseFirstRequest: (() => void) | undefined;
    const blockedResponse = new Promise<Response>((resolve) => {
      releaseFirstRequest = () => resolve(new Response(null, { status: 204 }));
    });
    const primaryFetch = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => {
        signalFirstRequestStarted?.();
        return blockedResponse;
      })
      .mockResolvedValue(new Response(null, { status: 204 }));
    const primaryRun = alerts.deliverPendingAdminAlerts({
      limit: 100,
      now: 16_000,
      fetchImpl: primaryFetch,
    });
    await firstRequestStarted;

    const competingFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const competingRun = await alerts.deliverPendingAdminAlerts({
      limit: 100,
      // One millisecond before the conservative three-minute lease expires.
      // The old 30-second lease would have duplicated all rows here.
      now: 195_999,
      fetchImpl: competingFetch,
    });
    expect(competingRun).toMatchObject({ claimed: 0, delivered: 0 });
    expect(competingFetch).not.toHaveBeenCalled();

    releaseFirstRequest?.();
    await expect(primaryRun).resolves.toMatchObject({ claimed: 8, delivered: 8 });
    expect(primaryFetch).toHaveBeenCalledTimes(8);
  });

  it("retries transient failures with backoff and honors Discord retry_after", async () => {
    const { alerts, db } = await loadFreshAdminAlerts();
    process.env.DISCORD_ADMIN_ALERTS_ENABLED = "true";
    await alerts.enqueueAdminAlert({
      type: "incident",
      code: "delivery.test",
      summary: "Synthetic delivery test failed.",
    }, { dedupeKey: "incident:delivery-test:1", now: 20_000 });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const first = await alerts.deliverPendingAdminAlerts({
      now: 20_000,
      fetchImpl: fetchMock,
      random: () => 0.5,
    });
    expect(first).toMatchObject({ rescheduled: 1, delivered: 0 });
    await expect(alerts.deliverPendingAdminAlerts({
      now: 24_999,
      fetchImpl: fetchMock,
    })).resolves.toMatchObject({ claimed: 0 });
    await expect(alerts.deliverPendingAdminAlerts({
      now: 25_000,
      fetchImpl: fetchMock,
    })).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    await expect(db.getAdminAlertOutboxHealth(25_001)).resolves.toMatchObject({ delivered: 1 });

    await alerts.enqueueAdminAlert({
      type: "incident",
      code: "rate.limit.test",
      summary: "Synthetic rate limit test.",
    }, { dedupeKey: "incident:rate-limit-test:1", now: 30_000 });
    const rateLimitedFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 2.5 }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(alerts.deliverPendingAdminAlerts({
      now: 30_000,
      fetchImpl: rateLimitedFetch,
    })).resolves.toMatchObject({ rescheduled: 1 });
    await expect(alerts.deliverPendingAdminAlerts({
      now: 32_499,
      fetchImpl: rateLimitedFetch,
    })).resolves.toMatchObject({ claimed: 0 });
    await expect(alerts.deliverPendingAdminAlerts({
      now: 32_500,
      fetchImpl: rateLimitedFetch,
    })).resolves.toMatchObject({ claimed: 1, delivered: 1 });
  });

  it("marks a Discord 4xx rejection dead without exposing its response body", async () => {
    const { alerts, db } = await loadFreshAdminAlerts();
    process.env.DISCORD_ADMIN_ALERTS_ENABLED = "true";
    await alerts.enqueueAdminAlert({
      type: "incident",
      code: "configuration.test",
      summary: "Synthetic configuration rejection.",
    }, { dedupeKey: "incident:configuration-test:1", now: 40_000 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("webhook secret should never be persisted", { status: 401 }),
    );

    const run = await alerts.deliverPendingAdminAlerts({
      now: 40_000,
      fetchImpl: fetchMock,
    });
    expect(run).toMatchObject({ dead: 1, rescheduled: 0 });
    expect(run.errors).toEqual({ discord_client_rejected: 1 });
    await expect(db.getAdminAlertOutboxHealth(40_001)).resolves.toMatchObject({ dead: 1 });
  });
});

describe("Stripe marker and notification atomicity", () => {
  it("records a Stripe marker and alert exactly once in one transaction", async () => {
    const { alerts, db } = await loadFreshAdminAlerts();
    const input = {
      eventId: "evt_atomic12345",
      eventType: "customer.subscription.created",
      stripeEventCreated: 1_700_000_000,
      processedAt: 1_700_000_000_000,
      alerts: [{
        type: "subscription.started",
        teacherRef: "T-ABCDEF123456",
        amountCents: 2_000,
        freeReviewsUsed: 20,
      }] as const,
    };

    await expect(alerts.recordStripeWebhookProcessedWithAdminAlerts(input)).resolves.toEqual({
      recorded: true,
      insertedAlertCount: 1,
    });
    await expect(alerts.recordStripeWebhookProcessedWithAdminAlerts(input)).resolves.toEqual({
      recorded: false,
      insertedAlertCount: 0,
    });
    await expect(db.hasProcessedStripeWebhookEvent(input.eventId)).resolves.toBe(true);
    await expect(db.getAdminAlertOutboxHealth(input.processedAt)).resolves.toMatchObject({
      pending: 1,
    });
  });

  it("rolls back the Stripe marker when an existing dedupe key has a different scope", async () => {
    const { alerts, db } = await loadFreshAdminAlerts();
    const [original] = alerts.buildAdminAlertOutboxRows({
      event: {
        type: "subscription.started",
        teacherRef: "T-ABCDEF123456",
        amountCents: 2_000,
        freeReviewsUsed: 10,
      },
      dedupeKey: "stripe:evt_conflict12345",
    }, 50_000);
    expect(original).toBeDefined();
    await db.enqueueAdminAlertOutbox([original!]);

    await expect(db.recordProcessedStripeWebhookEventWithAdminAlerts({
      eventId: "evt_conflict12345",
      eventType: "customer.subscription.created",
      stripeEventCreated: 1_700_000_001,
      processedAt: 50_001,
      alerts: [{
        ...original!,
        id: `adminalert_${randomUUID()}`,
        destination: "incidents",
      }],
    })).rejects.toThrow("dedupe conflict");
    await expect(db.hasProcessedStripeWebhookEvent("evt_conflict12345")).resolves.toBe(false);
  });
});

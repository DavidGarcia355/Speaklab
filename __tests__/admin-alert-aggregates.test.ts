import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveAdminAlertOperationalConfig } from "@/lib/admin-alerts/config";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";

const envKeys = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "HABLA_LOCAL_DB_PATH",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const dbPath = path.join(os.tmpdir(), `tryhabla-admin-alert-aggregates-${randomUUID()}.db`);

let db: typeof import("@/lib/db");

beforeAll(async () => {
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.HABLA_LOCAL_DB_PATH = dbPath;
  vi.resetModules();
  db = await import("@/lib/db");

  await db.getAdminAlertMilestoneAggregate({
    now: 1,
    environment: "test",
    livemode: false,
  });
  const raw = createClient({ url: `file:${dbPath}` });
  await raw.batch([
    {
      sql: `INSERT INTO users (email, role, created_at)
        VALUES ('private-teacher@example.com', 'teacher', 1100000)`,
      args: [],
    },
    {
      sql: `INSERT INTO classes (id, name, owner_email, created_at, deleted_at)
        VALUES ('class_private', 'Private class', 'private-teacher@example.com', 1150000, NULL)`,
      args: [],
    },
    {
      sql: `INSERT INTO assignments (id, class_id, title, created_at, deleted_at)
        VALUES ('assignment_private', 'class_private', 'Private assignment', 1200000, NULL)`,
      args: [],
    },
    {
      sql: `INSERT INTO submissions (
          id, assignment_id, student_name, student_email, submitted_at, grade_source, deleted_at
        ) VALUES (
          'submission_private', 'assignment_private', 'Private Student',
          'private-student@example.com', 1300000, 'teacher', NULL
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO ai_grading_attempts (
          id, submission_id, teacher_email, status, delivery_status, duration_seconds,
          suggested_score, cache_key, latency_ms, retries, created_at, completed_at
        ) VALUES (
          'attempt_success_1', 'submission_private', 'private-teacher@example.com',
          'completed', 'delivered', 61, 90, 'semantic-review-1', 1000, 0, 1400000, 1400000
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO ai_grading_attempts (
          id, submission_id, teacher_email, status, delivery_status, duration_seconds,
          suggested_score, cache_key, latency_ms, retries, created_at, completed_at
        ) VALUES (
          'attempt_success_retry', 'submission_private', 'private-teacher@example.com',
          'completed', 'delivered', 62, 90, 'semantic-review-1', 2000, 0, 1450000, 1450000
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO ai_grading_attempts (
          id, submission_id, teacher_email, status, delivery_status, error_code,
          cache_key, latency_ms, retries, created_at, completed_at
        ) VALUES (
          'attempt_failed', 'submission_private', 'private-teacher@example.com',
          'failed', 'not_applicable', 'provider_error', 'semantic-review-2', 3000, 2,
          1500000, 1500000
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO ai_grading_attempts (
          id, submission_id, teacher_email, status, delivery_status, teacher_attention,
          suggested_score, cache_key, latency_ms, retries, created_at, completed_at
        ) VALUES (
          'attempt_unable', 'submission_private', 'private-teacher@example.com',
          'completed', 'delivered', 'unable_to_grade', 50, 'semantic-review-3', 4000,
          0, 1510000, 1510000
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO grading_provider_requests (
          id, submission_id, teacher_email, provider, model, status,
          estimated_cost_microusd, created_at, completed_at
        ) VALUES (
          'provider_request_private', 'submission_private', 'private-teacher@example.com',
          'provider', 'model', 'completed', 40000, 1410000, 1410000
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO stripe_billing_accounts (
          teacher_email, stripe_customer_id, stripe_subscription_id, subscription_status,
          subscription_period_start, subscription_period_end, price_book_id,
          catalog_fingerprint, stripe_account_id, billing_contract_id, livemode,
          stripe_event_created, projection_revision, created_at, updated_at
        ) VALUES (
          'private-teacher@example.com', 'cus_private', 'sub_private', 'active',
          1000000, 3000000, ?, ?, 'acct_test', 'contract_test', 0,
          1400, 1, 1250000, 1250000
        )`,
      args: [STRIPE_CATALOG_MANIFEST.priceBookId, STRIPE_CATALOG_MANIFEST.fingerprint],
    },
    {
      sql: `INSERT INTO users (email, role, created_at)
        VALUES ('davidsgarcia325@gmail.com', 'teacher', 1100000)`,
      args: [],
    },
    {
      sql: `INSERT INTO classes (id, name, owner_email, created_at, deleted_at)
        VALUES ('class_internal', 'Internal class', 'davidsgarcia325@gmail.com', 1150000, NULL)`,
      args: [],
    },
    {
      sql: `INSERT INTO assignments (id, class_id, title, created_at, deleted_at)
        VALUES ('assignment_internal', 'class_internal', 'Internal assignment', 1200000, NULL)`,
      args: [],
    },
    {
      sql: `INSERT INTO submissions (
          id, assignment_id, student_name, submitted_at, grade_source, deleted_at
        ) VALUES (
          'submission_internal', 'assignment_internal', 'Internal Student',
          1300000, 'teacher', NULL
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO ai_grading_attempts (
          id, submission_id, teacher_email, status, delivery_status, duration_seconds,
          suggested_score, cache_key, latency_ms, retries, created_at, completed_at
        ) VALUES (
          'attempt_internal', 'submission_internal', 'davidsgarcia325@gmail.com',
          'completed', 'delivered', 90, 90, 'internal-review', 999999, 0,
          1400000, 1400000
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO grading_provider_requests (
          id, submission_id, teacher_email, provider, model, status,
          estimated_cost_microusd, created_at, completed_at
        ) VALUES (
          'provider_request_internal', 'submission_internal', 'davidsgarcia325@gmail.com',
          'provider', 'model', 'completed', 90000, 1410000, 1410000
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO stripe_billing_accounts (
          teacher_email, stripe_customer_id, stripe_subscription_id, subscription_status,
          subscription_period_start, subscription_period_end, price_book_id,
          catalog_fingerprint, stripe_account_id, billing_contract_id, livemode,
          stripe_event_created, projection_revision, created_at, updated_at
        ) VALUES (
          'davidsgarcia325@gmail.com', 'cus_internal', 'sub_internal', 'active',
          1000000, 3000000, ?, ?, 'acct_test', 'contract_test', 0,
          1400, 1, 1250000, 1250000
        )`,
      args: [STRIPE_CATALOG_MANIFEST.priceBookId, STRIPE_CATALOG_MANIFEST.fingerprint],
    },
  ], "write");
  raw.close();

  const events = [
    { eventType: "teacher.signed_up", destination: "traction", payload: { type: "teacher.signed_up" } },
    { eventType: "teacher.activated", destination: "traction", payload: { type: "teacher.activated" } },
    { eventType: "subscription.started", destination: "revenue", payload: { type: "subscription.started", amountCents: 2_000 } },
    { eventType: "subscription.renewed", destination: "revenue", payload: { type: "subscription.renewed", amountCents: 2_000 } },
    { eventType: "refund.issued", destination: "revenue", payload: { type: "refund.issued", amountCents: 500 } },
    { eventType: "trial.exhausted", destination: "revenue", payload: { type: "trial.exhausted" } },
    { eventType: "allowance.near_limit", destination: "revenue", payload: { type: "allowance.near_limit" } },
    { eventType: "allowance.exhausted", destination: "revenue", payload: { type: "allowance.exhausted" } },
    { eventType: "school.lead", destination: "revenue", payload: { type: "school.lead" } },
  ];
  await db.enqueueAdminAlertOutbox(events.map((event, index) => ({
    id: `aggregate_alert_${index}`,
    dedupeKey: `test:aggregate:${index}`,
    eventType: event.eventType,
    destination: event.destination as "traction" | "revenue",
    safePayloadJson: JSON.stringify(event.payload),
    environment: "test" as const,
    nextAttemptAt: 1_200_000 + index,
    createdAt: 1_200_000 + index,
  })));
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("privacy-safe admin alert aggregates", () => {
  it("returns period metrics without returning account or student identifiers", async () => {
    const aggregate = await db.getAdminAlertPeriodAggregate({
      startAt: 1_000_000,
      endAt: 2_000_000,
      snapshotAt: 1_900_000,
      environment: "test",
      livemode: false,
    });

    expect(aggregate).toMatchObject({
      newTeachers: 1,
      activatedTeachers: 1,
      newPaidTeachers: 1,
      assignmentsPublished: 1,
      recordingsReceived: 1,
      successfulAiReviews: 1,
      aiAttempts: 4,
      aiFailures: 2,
      retryCount: 2,
      durationSampleCount: 1,
      medianDurationSeconds: 61,
      p90DurationSeconds: 61,
      activePaidTeachers: 1,
      mrrCents: 2_000,
      newMrrCents: 2_000,
      recognizedRevenueCents: 4_000,
      refundsCents: 500,
      estimatedProviderSpendCents: 4,
      estimatedStripeFeesCents: 204,
      estimatedContributionCents: 3_292,
      freeTrialsExhausted: 1,
      nearPaidLimitTeachers: 1,
      paidLimitExhaustedTeachers: 1,
      schoolLeads: 1,
    });
    expect(Object.values(aggregate).every((value) => Number.isSafeInteger(value))).toBe(true);
    expect(JSON.stringify(aggregate)).not.toMatch(/private|student|teacher@|cus_|sub_/i);
  });

  it("returns cumulative milestones from unique successful reviews", async () => {
    const aggregate = await db.getAdminAlertMilestoneAggregate({
      now: 1_900_000,
      environment: "test",
      livemode: false,
    });

    expect(aggregate).toEqual({
      totalTeachers: 1,
      activatedTeachers: 1,
      paidTeachers: 1,
      successfulAiReviews: 1,
      studentRecordings: 1,
      mrrCents: 2_000,
      schoolLeads: 1,
      estimatedProviderCostCents: 4,
    });
  });

  it("rejects invalid windows before querying", async () => {
    await expect(db.getAdminAlertPeriodAggregate({
      startAt: 2_000,
      endAt: 2_000,
      environment: "test",
      livemode: false,
    })).rejects.toThrow("endAt must be after startAt");
  });

  it("returns terminal rolling AI health and UTC-month provider spend without internal accounts", async () => {
    await expect(db.getAdminAlertOperationalAggregate(1_900_000)).resolves.toEqual({
      budgetPeriod: "1970-01",
      providerSpendMicrousd: 40_000,
      rollingWindowStartAt: 0,
      rollingWindowEndAt: 1_900_000,
      completedAttempts: 4,
      usableAttempts: 2,
      latencySampleCount: 4,
      p95LatencyMs: 4_000,
    });
  });

  it("uses bounded operational defaults and accepts an explicit p95 target", () => {
    expect(resolveAdminAlertOperationalConfig({})).toEqual({
      monthlyBudgetUsd: 200,
      p95LatencyTargetMs: 60_000,
    });
    expect(resolveAdminAlertOperationalConfig({
      AI_MONTHLY_BUDGET_USD: "350",
      DISCORD_AI_P95_TARGET_MS: "45000",
    })).toEqual({
      monthlyBudgetUsd: 350,
      p95LatencyTargetMs: 45_000,
    });
    expect(resolveAdminAlertOperationalConfig({
      AI_MONTHLY_BUDGET_USD: "0",
      DISCORD_AI_P95_TARGET_MS: "999999999",
    })).toEqual({
      monthlyBudgetUsd: 200,
      p95LatencyTargetMs: 60_000,
    });
  });

  it("scopes outbox incident health by environment and avoids incident feedback loops", async () => {
    await db.enqueueAdminAlertOutbox([
      {
        id: "aggregate_health_test_incident",
        dedupeKey: "test:aggregate:health:incident",
        eventType: "incident",
        destination: "incidents",
        safePayloadJson: JSON.stringify({ type: "incident" }),
        environment: "test",
        nextAttemptAt: 1,
        createdAt: 1,
      },
      {
        id: "aggregate_health_production",
        dedupeKey: "production:aggregate:health",
        eventType: "teacher.signed_up",
        destination: "traction",
        safePayloadJson: JSON.stringify({ type: "teacher.signed_up" }),
        environment: "production",
        nextAttemptAt: 1,
        createdAt: 1,
      },
    ]);

    await expect(db.getAdminAlertOutboxHealthForEnvironment(
      "test",
      1_900_000,
      { excludeIncidentEvents: true },
    )).resolves.toMatchObject({ pending: 9, due: 9, stale: 9 });
    await expect(db.getAdminAlertOutboxHealthForEnvironment(
      "test",
      1_900_000,
    )).resolves.toMatchObject({ pending: 10, due: 10, stale: 10 });
  });
});

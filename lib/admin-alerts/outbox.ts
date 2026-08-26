import "server-only";

import { randomUUID } from "node:crypto";
import {
  enqueueAdminAlertOutbox,
  recordProcessedStripeWebhookEventWithAdminAlerts,
  type AdminAlertDestination,
  type AdminAlertOutboxInsert,
  type AdminAlertOutboxRow,
} from "@/lib/db";
import { resolveAdminAlertsEnvironment } from "@/lib/admin-alerts/config";
import {
  getAdminAlertDestinations,
  parseAdminAlertEvent,
  type AdminAlertEvent,
} from "@/lib/admin-alerts/events";

export type AdminAlertEnqueueInput = {
  event: AdminAlertEvent;
  dedupeKey: string;
};

export type AdminAlertEnqueueResult = {
  eventType: AdminAlertEvent["type"];
  rows: Array<{
    id: string;
    destination: AdminAlertDestination;
    inserted: boolean;
  }>;
};

export class AdminAlertDedupeConflictError extends Error {
  constructor() {
    super("admin_alert_dedupe_conflict");
    this.name = "AdminAlertDedupeConflictError";
  }
}

function normalizeCallerDedupeKey(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(normalized)) {
    throw new Error("admin_alert_dedupe_key_invalid");
  }
  return normalized;
}

function buildDedupeKey(input: {
  environment: string;
  eventType: string;
  callerKey: string;
  destination: AdminAlertDestination;
}) {
  return `${input.environment}:${input.eventType}:${input.callerKey}:${input.destination}`;
}

export function buildAdminAlertOutboxRows(
  input: AdminAlertEnqueueInput,
  now = Date.now(),
): AdminAlertOutboxInsert[] {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError("admin_alert_enqueue_time_invalid");
  }
  const event = parseAdminAlertEvent(input.event);
  const environment = resolveAdminAlertsEnvironment();
  const callerKey = normalizeCallerDedupeKey(input.dedupeKey);
  const safePayloadJson = JSON.stringify(event);
  return getAdminAlertDestinations(event).map((destination) => ({
    id: `adminalert_${randomUUID()}`,
    dedupeKey: buildDedupeKey({
      environment,
      eventType: event.type,
      callerKey,
      destination,
    }),
    eventType: event.type,
    destination,
    safePayloadJson,
    environment,
    nextAttemptAt: now,
    createdAt: now,
  }));
}

function assertMatchingDedupeScope(expected: AdminAlertOutboxInsert, actual: AdminAlertOutboxRow) {
  if (
    expected.eventType !== actual.eventType
    || expected.destination !== actual.destination
    || expected.environment !== actual.environment
  ) {
    throw new AdminAlertDedupeConflictError();
  }
}

export async function enqueueAdminAlerts(
  inputs: readonly AdminAlertEnqueueInput[],
  options: { now?: number } = {},
): Promise<AdminAlertEnqueueResult[]> {
  if (inputs.length === 0) return [];
  const now = options.now ?? Date.now();
  const prepared = inputs.map((input) => ({
    event: parseAdminAlertEvent(input.event),
    rows: buildAdminAlertOutboxRows(input, now),
  }));
  const rows = prepared.flatMap((item) => item.rows);
  if (rows.length > 20) {
    throw new RangeError("admin_alert_enqueue_batch_too_large");
  }
  if (new Set(rows.map((row) => row.dedupeKey)).size !== rows.length) {
    throw new AdminAlertDedupeConflictError();
  }
  const stored = await enqueueAdminAlertOutbox(rows);
  for (let index = 0; index < rows.length; index += 1) {
    assertMatchingDedupeScope(rows[index]!, stored[index]!.row);
  }
  let rowIndex = 0;
  return prepared.map((item) => ({
    eventType: item.event.type,
    rows: item.rows.map((row) => {
      const outcome = stored[rowIndex]!;
      rowIndex += 1;
      return {
        id: outcome.row.id,
        destination: row.destination,
        inserted: outcome.inserted,
      };
    }),
  }));
}

export async function enqueueAdminAlert(
  event: AdminAlertEvent,
  options: { dedupeKey: string; now?: number },
): Promise<AdminAlertEnqueueResult> {
  const [result] = await enqueueAdminAlerts(
    [{ event, dedupeKey: options.dedupeKey }],
    { now: options.now },
  );
  if (!result) throw new Error("admin_alert_enqueue_failed");
  return result;
}

export async function recordStripeWebhookProcessedWithAdminAlerts(input: {
  eventId: string;
  eventType: string;
  stripeEventCreated: number;
  processedAt?: number;
  alerts: readonly AdminAlertEvent[];
}): Promise<{ recorded: boolean; insertedAlertCount: number }> {
  const eventId = input.eventId.trim();
  const eventType = input.eventType.trim();
  if (!/^evt_[A-Za-z0-9_]{5,200}$/.test(eventId)) {
    throw new Error("admin_alert_stripe_event_id_invalid");
  }
  if (!/^[a-z0-9][a-z0-9._]{0,99}$/.test(eventType)) {
    throw new Error("admin_alert_stripe_event_type_invalid");
  }
  if (!Number.isSafeInteger(input.stripeEventCreated) || input.stripeEventCreated < 0) {
    throw new RangeError("admin_alert_stripe_event_created_invalid");
  }
  const processedAt = input.processedAt ?? Date.now();
  const rows = input.alerts.flatMap((event) => buildAdminAlertOutboxRows({
    event: parseAdminAlertEvent(event),
    dedupeKey: `stripe:${eventId}`,
  }, processedAt));
  if (new Set(rows.map((row) => row.dedupeKey)).size !== rows.length) {
    throw new AdminAlertDedupeConflictError();
  }
  return recordProcessedStripeWebhookEventWithAdminAlerts({
    eventId,
    eventType,
    stripeEventCreated: input.stripeEventCreated,
    processedAt,
    alerts: rows,
  });
}

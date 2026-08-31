import "server-only";

import {
  claimPendingAdminAlertOutbox,
  getAdminAlertOutboxHealth,
  markAdminAlertOutboxDelivered,
  markAdminAlertOutboxFailed,
  ADMIN_ALERT_OUTBOX_MAX_CLAIM,
  type AdminAlertEnvironment,
  type AdminAlertOutboxHealth,
  type AdminAlertOutboxRow,
} from "@/lib/db";
import {
  AdminAlertConfigurationError,
  isAdminAlertDeliveryEnabled,
  resolveAdminAlertsEnvironment,
  resolveDiscordWebhookUrl,
} from "@/lib/admin-alerts/config";
import { getAdminAlertDestinations, parseAdminAlertEvent } from "@/lib/admin-alerts/events";
import { formatAdminAlertForDiscord } from "@/lib/admin-alerts/format";
import {
  discordBotErrorStatus,
  isDiscordBotDeliveryConfigured,
  sendDiscordBotAlert,
} from "@/lib/admin-alerts/discord-bot";

const DELIVERY_TIMEOUT_MS = 5_000;
const DELIVERY_LEASE_MS = 3 * 60_000;
export const MAX_ADMIN_ALERT_DELIVERY_BATCH = ADMIN_ALERT_OUTBOX_MAX_CLAIM;
const MAX_DELIVERY_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const MAX_RATE_LIMIT_DELAY_MS = 60 * 60_000;

type DeliveryErrorCode =
  | "alerts_environment_invalid"
  | "alerts_environment_mismatch"
  | "webhook_missing"
  | "webhook_invalid"
  | "payload_invalid"
  | "delivery_timeout"
  | "delivery_network_error"
  | "discord_rate_limited"
  | "discord_client_rejected"
  | "discord_server_error"
  | "discord_unexpected_status"
  | "discord_bot_missing"
  | "discord_bot_timeout"
  | "discord_bot_network_error"
  | "discord_bot_request_failed"
  | "discord_guild_ambiguous"
  | "discord_guild_mismatch"
  | "discord_channel_missing"
  | "lease_lost";

type AttemptResult =
  | { ok: true }
  | {
    ok: false;
    code: DeliveryErrorCode;
    retryable: boolean;
    retryAfterMs?: number;
  };

export type AdminAlertDeliveryRunResult = {
  enabled: boolean;
  environment: AdminAlertEnvironment | null;
  claimed: number;
  delivered: number;
  rescheduled: number;
  dead: number;
  leaseLost: number;
  errors: Partial<Record<DeliveryErrorCode, number>>;
};

function boundedRandom(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(value, 1));
}

export function calculateAdminAlertBackoffMs(
  attemptCount: number,
  randomValue = Math.random(),
) {
  const safeAttempt = Math.max(1, Math.min(Math.floor(attemptCount), MAX_DELIVERY_ATTEMPTS));
  const exponential = Math.min(
    BASE_BACKOFF_MS * (2 ** (safeAttempt - 1)),
    MAX_BACKOFF_MS,
  );
  return Math.round(exponential * (0.5 + boundedRandom(randomValue)));
}

async function readDiscordRetryAfterMs(response: Response): Promise<number | undefined> {
  let seconds: number | undefined;
  try {
    const payload = await response.json() as { retry_after?: unknown };
    const parsed = Number(payload?.retry_after);
    if (Number.isFinite(parsed) && parsed >= 0) seconds = parsed;
  } catch {
    // Some Discord-compatible responses provide only the standard header.
  }
  if (seconds === undefined) {
    const parsed = Number(response.headers.get("retry-after"));
    if (Number.isFinite(parsed) && parsed >= 0) seconds = parsed;
  }
  if (seconds === undefined) return undefined;
  return Math.max(1_000, Math.min(Math.ceil(seconds * 1_000), MAX_RATE_LIMIT_DELAY_MS));
}

function validateStoredAlert(row: AdminAlertOutboxRow) {
  let raw: unknown;
  try {
    raw = JSON.parse(row.safePayloadJson);
  } catch {
    throw new Error("payload_invalid");
  }
  const event = parseAdminAlertEvent(raw);
  if (
    event.type !== row.eventType
    || !getAdminAlertDestinations(event).includes(row.destination)
  ) {
    throw new Error("payload_invalid");
  }
  return event;
}

function botErrorResult(error: unknown): AttemptResult {
  const details = discordBotErrorStatus(error);
  if (!details) {
    return { ok: false, code: "discord_bot_request_failed", retryable: true };
  }
  const code = details.code as DeliveryErrorCode;
  if (details.status === 429) {
    return {
      ok: false,
      code: "discord_rate_limited",
      retryable: true,
      retryAfterMs: details.retryAfterMs,
    };
  }
  if (details.status === 409) {
    return { ok: false, code, retryable: false };
  }
  if (details.status >= 400 && details.status < 500) {
    return { ok: false, code, retryable: false };
  }
  return { ok: false, code, retryable: true, retryAfterMs: details.retryAfterMs };
}

async function attemptDiscordDelivery(input: {
  row: AdminAlertOutboxRow;
  environment: AdminAlertEnvironment;
  fetchImpl: typeof fetch;
}): Promise<AttemptResult> {
  let event;
  try {
    event = validateStoredAlert(input.row);
  } catch {
    return { ok: false, code: "payload_invalid", retryable: false };
  }

  const payload = formatAdminAlertForDiscord({
    event,
    environment: input.environment,
    occurredAt: input.row.createdAt,
  });

  if (isDiscordBotDeliveryConfigured()) {
    try {
      await sendDiscordBotAlert({
        destination: input.row.destination,
        eventType: event.type,
        payload,
        fetchImpl: input.fetchImpl,
      });
      return { ok: true };
    } catch (error) {
      return botErrorResult(error);
    }
  }

  let webhookUrl: string;
  try {
    webhookUrl = resolveDiscordWebhookUrl(input.row.destination, input.environment);
  } catch (error) {
    if (error instanceof AdminAlertConfigurationError) {
      return { ok: false, code: error.code, retryable: true };
    }
    return { ok: false, code: "webhook_invalid", retryable: true };
  }
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await input.fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (response.ok) return { ok: true };
    if (response.status === 429) {
      return {
        ok: false,
        code: "discord_rate_limited",
        retryable: true,
        retryAfterMs: await readDiscordRetryAfterMs(response),
      };
    }
    if (response.status >= 400 && response.status < 500) {
      return { ok: false, code: "discord_client_rejected", retryable: false };
    }
    if (response.status >= 500) {
      return { ok: false, code: "discord_server_error", retryable: true };
    }
    return { ok: false, code: "discord_unexpected_status", retryable: true };
  } catch {
    return {
      ok: false,
      code: controller.signal.aborted ? "delivery_timeout" : "delivery_network_error",
      retryable: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function incrementError(
  errors: Partial<Record<DeliveryErrorCode, number>>,
  code: DeliveryErrorCode,
) {
  errors[code] = (errors[code] ?? 0) + 1;
}

export async function deliverPendingAdminAlerts(options: {
  limit?: number;
  now?: number;
  fetchImpl?: typeof fetch;
  random?: () => number;
} = {}): Promise<AdminAlertDeliveryRunResult> {
  if (!isAdminAlertDeliveryEnabled()) {
    return {
      enabled: false,
      environment: null,
      claimed: 0,
      delivered: 0,
      rescheduled: 0,
      dead: 0,
      leaseLost: 0,
      errors: {},
    };
  }
  let environment: AdminAlertEnvironment;
  try {
    environment = resolveAdminAlertsEnvironment();
  } catch (error) {
    const code = error instanceof AdminAlertConfigurationError
      ? error.code
      : "alerts_environment_invalid";
    return {
      enabled: true,
      environment: null,
      claimed: 0,
      delivered: 0,
      rescheduled: 0,
      dead: 0,
      leaseLost: 0,
      errors: { [code]: 1 },
    };
  }
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError("admin_alert_delivery_time_invalid");
  }
  const claimed = await claimPendingAdminAlertOutbox({
    environment,
    limit: Math.min(options.limit ?? MAX_ADMIN_ALERT_DELIVERY_BATCH, MAX_ADMIN_ALERT_DELIVERY_BATCH),
    now,
    leaseMs: DELIVERY_LEASE_MS,
    maxAttempts: MAX_DELIVERY_ATTEMPTS,
  });
  const result: AdminAlertDeliveryRunResult = {
    enabled: true,
    environment,
    claimed: claimed.length,
    delivered: 0,
    rescheduled: 0,
    dead: 0,
    leaseLost: 0,
    errors: {},
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const random = options.random ?? Math.random;
  for (const row of claimed) {
    const attempt = await attemptDiscordDelivery({ row, environment, fetchImpl });
    if (attempt.ok) {
      const updated = await markAdminAlertOutboxDelivered({
        id: row.id,
        leaseToken: row.leaseToken,
        deliveredAt: now,
      });
      if (updated) result.delivered += 1;
      else {
        result.leaseLost += 1;
        incrementError(result.errors, "lease_lost");
      }
      continue;
    }
    incrementError(result.errors, attempt.code);
    const backoffMs = attempt.retryAfterMs
      ?? calculateAdminAlertBackoffMs(row.attemptCount, random());
    const update = await markAdminAlertOutboxFailed({
      id: row.id,
      leaseToken: row.leaseToken,
      errorCode: attempt.code,
      retryable: attempt.retryable,
      nextAttemptAt: now + backoffMs,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
    });
    if (!update.updated) {
      result.leaseLost += 1;
      incrementError(result.errors, "lease_lost");
    } else if (update.status === "dead") {
      result.dead += 1;
    } else {
      result.rescheduled += 1;
    }
  }
  return result;
}

export async function readAdminAlertOutboxHealth(
  now = Date.now(),
): Promise<AdminAlertOutboxHealth> {
  return getAdminAlertOutboxHealth(now);
}

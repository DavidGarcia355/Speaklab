import "server-only";

import type { AdminAlertDestination, AdminAlertEnvironment } from "@/lib/db";

export type AdminAlertConfigurationErrorCode =
  | "alerts_environment_invalid"
  | "alerts_environment_mismatch"
  | "webhook_missing"
  | "webhook_invalid";

export class AdminAlertConfigurationError extends Error {
  readonly code: AdminAlertConfigurationErrorCode;

  constructor(code: AdminAlertConfigurationErrorCode) {
    super(code);
    this.name = "AdminAlertConfigurationError";
    this.code = code;
  }
}

const ADMIN_ALERT_ENVIRONMENTS = new Set<AdminAlertEnvironment>([
  "production",
  "preview",
  "development",
  "test",
]);

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

function platformEnvironment(source: EnvironmentSource): AdminAlertEnvironment | null {
  switch (source.VERCEL_ENV?.trim().toLowerCase()) {
    case "production":
      return "production";
    case "preview":
      return "preview";
    case "development":
      return "development";
    default:
      return null;
  }
}

export function resolveAdminAlertsEnvironment(
  source: EnvironmentSource = process.env,
): AdminAlertEnvironment {
  const configured = source.DISCORD_ALERTS_ENV?.trim().toLowerCase() || "";
  if (configured && !ADMIN_ALERT_ENVIRONMENTS.has(configured as AdminAlertEnvironment)) {
    throw new AdminAlertConfigurationError("alerts_environment_invalid");
  }
  const deployed = platformEnvironment(source);
  const inferred: AdminAlertEnvironment = deployed
    ?? (source.NODE_ENV === "test"
      ? "test"
      : source.NODE_ENV === "production"
        ? "production"
        : "development");
  const resolved = (configured || inferred) as AdminAlertEnvironment;
  if (deployed && (deployed === "production") !== (resolved === "production")) {
    throw new AdminAlertConfigurationError("alerts_environment_mismatch");
  }
  return resolved;
}

export function isAdminAlertDeliveryEnabled(
  source: EnvironmentSource = process.env,
): boolean {
  const explicit = source.DISCORD_ADMIN_ALERTS_ENABLED?.trim();
  if (explicit === "true") return true;
  if (explicit === "false") return false;

  // The single-channel founder setup is intentionally one-secret: adding a
  // valid private production webhook is enough to turn Habla Pulse on.
  const unified = source.DISCORD_ADMIN_WEBHOOK_URL?.trim() || "";
  if (!unified) return false;
  try {
    validateDiscordWebhookUrl(unified);
    return true;
  } catch {
    return false;
  }
}

export type AdminAlertOperationalConfig = Readonly<{
  monthlyBudgetUsd: number;
  p95LatencyTargetMs: number;
}>;

const DEFAULT_MONTHLY_BUDGET_USD = 200;
const DEFAULT_P95_LATENCY_TARGET_MS = 60_000;

export function resolveAdminAlertOperationalConfig(
  source: EnvironmentSource = process.env,
): AdminAlertOperationalConfig {
  const configuredBudget = Number(source.AI_MONTHLY_BUDGET_USD?.trim());
  const monthlyBudgetUsd = Number.isFinite(configuredBudget) && configuredBudget > 0
    ? configuredBudget
    : DEFAULT_MONTHLY_BUDGET_USD;
  const configuredLatencyTarget = Number(source.DISCORD_AI_P95_TARGET_MS?.trim());
  const p95LatencyTargetMs = Number.isSafeInteger(configuredLatencyTarget)
    && configuredLatencyTarget >= 1_000
    && configuredLatencyTarget <= 600_000
    ? configuredLatencyTarget
    : DEFAULT_P95_LATENCY_TARGET_MS;
  return Object.freeze({ monthlyBudgetUsd, p95LatencyTargetMs });
}

const PRODUCTION_WEBHOOK_VARIABLES: Record<AdminAlertDestination, string> = {
  traction: "DISCORD_TRACTION_WEBHOOK_URL",
  revenue: "DISCORD_REVENUE_WEBHOOK_URL",
  milestones: "DISCORD_MILESTONES_WEBHOOK_URL",
  pulse: "DISCORD_PULSE_WEBHOOK_URL",
  incidents: "DISCORD_INCIDENTS_WEBHOOK_URL",
};

export function validateDiscordWebhookUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AdminAlertConfigurationError("webhook_invalid");
  }
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const validPath = pathSegments.length === 4
    && pathSegments[0] === "api"
    && pathSegments[1] === "webhooks"
    && /^\d{16,32}$/.test(pathSegments[2] ?? "")
    && /^[A-Za-z0-9._-]{20,256}$/.test(pathSegments[3] ?? "");
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "discord.com"
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
    || !validPath
  ) {
    throw new AdminAlertConfigurationError("webhook_invalid");
  }
  return parsed.toString();
}

export function resolveDiscordWebhookUrl(
  destination: AdminAlertDestination,
  environment: AdminAlertEnvironment,
  source: EnvironmentSource = process.env,
): string {
  if (environment === "production") {
    const destinationValue = source[PRODUCTION_WEBHOOK_VARIABLES[destination]]?.trim() || "";
    const unifiedValue = source.DISCORD_ADMIN_WEBHOOK_URL?.trim() || "";
    const value = destinationValue || unifiedValue;
    if (!value) throw new AdminAlertConfigurationError("webhook_missing");
    return validateDiscordWebhookUrl(value);
  }

  const value = source.DISCORD_TEST_WEBHOOK_URL?.trim() || "";
  if (!value) throw new AdminAlertConfigurationError("webhook_missing");
  return validateDiscordWebhookUrl(value);
}

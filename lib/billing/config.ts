export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export const STRIPE_PRICE_ENV_KEYS = Object.freeze({
  aiGrade: "STRIPE_AI_GRADE_PRICE_ID",
  audioMinute: "STRIPE_AI_AUDIO_SECONDS_PRICE_ID",
} as const);

export type StripeBillingEnv = Readonly<Record<string, string | undefined>>;
export type StripeKeyMode = "test" | "live";

export type StripeBillingConfig = Readonly<{
  enabled: true;
  apiVersion: typeof STRIPE_API_VERSION;
  secretKey: string;
  webhookSecret: string;
  keyMode: StripeKeyMode;
  priceIds: Readonly<{
    aiGrade: string;
    audioMinute: string;
  }>;
  automaticTaxEnabled: boolean;
}>;

export type StripeBillingAvailability =
  | Readonly<{
      enabled: true;
      available: true;
      keyMode: StripeKeyMode;
      automaticTaxEnabled: boolean;
      issues: readonly [];
    }>
  | Readonly<{
      enabled: boolean;
      available: false;
      reason: "disabled" | "invalid_configuration";
      issues: readonly string[];
    }>;

export type StripeBillingConfigResult =
  | Readonly<{
      ok: true;
      config: StripeBillingConfig;
      availability: Extract<StripeBillingAvailability, { available: true }>;
    }>
  | Readonly<{
      ok: false;
      availability: Extract<StripeBillingAvailability, { available: false }>;
    }>;

export class StripeBillingConfigurationError extends Error {
  readonly availability: Extract<StripeBillingAvailability, { available: false }>;

  constructor(availability: Extract<StripeBillingAvailability, { available: false }>) {
    const detail = availability.issues.length > 0 ? ` ${availability.issues.join(" ")}` : "";
    super(
      availability.reason === "disabled"
        ? "Stripe billing is disabled."
        : `Stripe billing configuration is invalid.${detail}`,
    );
    this.name = "StripeBillingConfigurationError";
    this.availability = availability;
  }
}

type BooleanSetting = { value: boolean; issue?: string };

function booleanSetting(
  env: StripeBillingEnv,
  key: string,
  fallback: boolean,
): BooleanSetting {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return { value: fallback };
  if (raw === "true") return { value: true };
  if (raw === "false") return { value: false };
  return { value: fallback, issue: `${key} must be either "true" or "false".` };
}

function requiredValue(env: StripeBillingEnv, key: string, issues: string[]) {
  const value = env[key]?.trim() ?? "";
  if (!value) issues.push(`${key} is required when Stripe billing is enabled.`);
  return value;
}

function keyMode(secretKey: string): StripeKeyMode | null {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return null;
}

function invalidAvailability(
  enabled: boolean,
  issues: string[],
): Extract<StripeBillingAvailability, { available: false }> {
  return {
    enabled,
    available: false,
    reason: "invalid_configuration",
    issues,
  };
}

/** Pure, fail-closed parsing. It never reads anything beyond the supplied environment. */
export function parseStripeBillingConfig(env: StripeBillingEnv): StripeBillingConfigResult {
  const enabled = booleanSetting(env, "STRIPE_BILLING_ENABLED", false);
  if (enabled.issue) {
    return { ok: false, availability: invalidAvailability(false, [enabled.issue]) };
  }
  if (!enabled.value) {
    return {
      ok: false,
      availability: {
        enabled: false,
        available: false,
        reason: "disabled",
        issues: [],
      },
    };
  }

  const issues: string[] = [];
  const automaticTax = booleanSetting(env, "STRIPE_AUTOMATIC_TAX_ENABLED", false);
  const allowLive = booleanSetting(env, "STRIPE_ALLOW_LIVE", false);
  if (automaticTax.issue) issues.push(automaticTax.issue);
  if (allowLive.issue) issues.push(allowLive.issue);

  const secretKey = requiredValue(env, "STRIPE_SECRET_KEY", issues);
  const webhookSecret = requiredValue(env, "STRIPE_WEBHOOK_SECRET", issues);
  const priceIds = {
    aiGrade: requiredValue(env, STRIPE_PRICE_ENV_KEYS.aiGrade, issues),
    audioMinute: requiredValue(env, STRIPE_PRICE_ENV_KEYS.audioMinute, issues),
  };

  const mode = keyMode(secretKey);
  if (secretKey && !mode) {
    issues.push("STRIPE_SECRET_KEY must be a Stripe test or live secret key.");
  }
  if (webhookSecret && !webhookSecret.startsWith("whsec_")) {
    issues.push("STRIPE_WEBHOOK_SECRET must start with whsec_.");
  }
  for (const [name, value] of Object.entries(priceIds)) {
    if (value && !value.startsWith("price_")) {
      issues.push(`${STRIPE_PRICE_ENV_KEYS[name as keyof typeof priceIds]} must start with price_.`);
    }
  }
  const configuredPriceIds = Object.values(priceIds).filter(Boolean);
  if (new Set(configuredPriceIds).size !== configuredPriceIds.length) {
    issues.push("Stripe metered price IDs must be distinct.");
  }
  if (
    mode === "live" &&
    (env.NODE_ENV?.trim().toLowerCase() !== "production" || !allowLive.value)
  ) {
    issues.push(
      "Live Stripe keys require NODE_ENV=production and STRIPE_ALLOW_LIVE=true.",
    );
  }

  if (!mode || issues.length > 0) {
    return { ok: false, availability: invalidAvailability(true, issues) };
  }

  const config: StripeBillingConfig = {
    enabled: true,
    apiVersion: STRIPE_API_VERSION,
    secretKey,
    webhookSecret,
    keyMode: mode,
    priceIds,
    automaticTaxEnabled: automaticTax.value,
  };
  return {
    ok: true,
    config,
    availability: {
      enabled: true,
      available: true,
      keyMode: mode,
      automaticTaxEnabled: automaticTax.value,
      issues: [],
    },
  };
}

/** Safe status for diagnostics; secret values and price IDs are never exposed. */
export function getStripeBillingAvailability(
  env: StripeBillingEnv = process.env,
): StripeBillingAvailability {
  return parseStripeBillingConfig(env).availability;
}

export function requireStripeBillingConfig(
  env: StripeBillingEnv = process.env,
): StripeBillingConfig {
  const parsed = parseStripeBillingConfig(env);
  if (!parsed.ok) throw new StripeBillingConfigurationError(parsed.availability);
  return parsed.config;
}

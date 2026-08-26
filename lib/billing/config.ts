export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export const STRIPE_PRICE_ENV_KEYS = Object.freeze({
  aiGrade: "STRIPE_AI_GRADE_PRICE_ID",
  audioMinute: "STRIPE_AI_AUDIO_SECONDS_PRICE_ID",
} as const);

export type StripeBillingEnv = Readonly<Record<string, string | undefined>>;
export type StripeKeyMode = "test" | "live";

export type StripeClientConfig = Readonly<{
  apiVersion: typeof STRIPE_API_VERSION;
  secretKey: string;
  keyMode: StripeKeyMode;
  accountId: string;
}>;

export type StripePortalConfig = StripeClientConfig &
  Readonly<{
    portalConfigurationId: string;
    paymentMethodConfigurationId: string;
  }>;

export type StripeWebhookConfig = StripeClientConfig &
  Readonly<{
    webhookSecret: string;
  }>;

export type StripeCatalogConfig = StripeClientConfig &
  Readonly<{
    priceIds: Readonly<{
      aiGrade: string;
      audioMinute: string;
    }>;
    automaticTaxEnabled: boolean;
  }>;

export type StripeUsageBillingConfig = StripeWebhookConfig &
  StripeCatalogConfig &
  Readonly<{
    /** Compatibility marker for existing billing consumers. */
    enabled: true;
    usageBillingEnabled: true;
  }>;

export type StripeCheckoutConfig = StripeUsageBillingConfig &
  Readonly<{
    checkoutEnabled: true;
  }>;

export type StripeAvailabilityReason =
  | "disabled"
  | "not_configured"
  | "invalid_configuration";

type StripeUnavailable = Readonly<{
  enabled: boolean;
  available: false;
  reason: StripeAvailabilityReason;
  issues: readonly string[];
}>;

type StripeAvailable<Details extends object = object> = Readonly<
  {
    enabled: true;
    available: true;
    issues: readonly [];
  } & Details
>;

export type StripeClientAvailability =
  | StripeAvailable<{ keyMode: StripeKeyMode }>
  | StripeUnavailable;
export type StripePortalAvailability =
  | StripeAvailable<{
      keyMode: StripeKeyMode;
      portalConfigurationId: string;
      paymentMethodConfigurationId: string;
    }>
  | StripeUnavailable;
export type StripeWebhookAvailability =
  | StripeAvailable<{ keyMode: StripeKeyMode }>
  | StripeUnavailable;
export type StripeCatalogAvailability =
  | StripeAvailable<{
      keyMode: StripeKeyMode;
      automaticTaxEnabled: boolean;
    }>
  | StripeUnavailable;
export type StripeUsageBillingAvailability =
  | StripeAvailable<{
      keyMode: StripeKeyMode;
      automaticTaxEnabled: boolean;
      usageBillingEnabled: true;
    }>
  | StripeUnavailable;
export type StripeCheckoutAvailability =
  | StripeAvailable<{
      keyMode: StripeKeyMode;
      automaticTaxEnabled: boolean;
      usageBillingEnabled: true;
      checkoutEnabled: true;
    }>
  | StripeUnavailable;

type StripeConfigResult<Config, Availability> =
  | Readonly<{
      ok: true;
      config: Config;
      availability: Extract<Availability, { available: true }>;
    }>
  | Readonly<{
      ok: false;
      availability: Extract<Availability, { available: false }>;
    }>;

export type StripeClientConfigResult = StripeConfigResult<
  StripeClientConfig,
  StripeClientAvailability
>;
export type StripePortalConfigResult = StripeConfigResult<
  StripePortalConfig,
  StripePortalAvailability
>;
export type StripeWebhookConfigResult = StripeConfigResult<
  StripeWebhookConfig,
  StripeWebhookAvailability
>;
export type StripeCatalogConfigResult = StripeConfigResult<
  StripeCatalogConfig,
  StripeCatalogAvailability
>;
export type StripeUsageBillingConfigResult = StripeConfigResult<
  StripeUsageBillingConfig,
  StripeUsageBillingAvailability
>;
export type StripeCheckoutConfigResult = StripeConfigResult<
  StripeCheckoutConfig,
  StripeCheckoutAvailability
>;

export class StripeBillingConfigurationError extends Error {
  readonly availability: StripeUnavailable;

  constructor(availability: StripeUnavailable) {
    const detail = availability.issues.length > 0 ? ` ${availability.issues.join(" ")}` : "";
    const summary =
      availability.reason === "disabled"
        ? "Stripe billing is disabled."
        : availability.reason === "not_configured"
          ? "Stripe billing is not configured."
          : "Stripe billing configuration is invalid.";
    super(`${summary}${detail}`);
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

function configuredValue(env: StripeBillingEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function keyMode(secretKey: string): StripeKeyMode | null {
  if (
    secretKey.startsWith("sk_test_") ||
    secretKey.startsWith("rk_test_") ||
    secretKey.startsWith("rkcs_test_")
  ) {
    return "test";
  }
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) return "live";
  return null;
}

function uniqueIssues(issues: readonly (string | undefined)[]) {
  return [...new Set(issues.filter((issue): issue is string => Boolean(issue)))];
}

function unavailable(
  enabled: boolean,
  reason: StripeAvailabilityReason,
  issues: readonly string[] = [],
): StripeUnavailable {
  return Object.freeze({
    enabled,
    available: false,
    reason,
    issues: Object.freeze(uniqueIssues(issues)),
  });
}

function disabled(): StripeUnavailable {
  return unavailable(false, "disabled");
}

function requiredIssue(key: string) {
  return `${key} is required for this Stripe capability.`;
}

function legacyBillingFlagIssue(env: StripeBillingEnv) {
  const legacy = booleanSetting(env, "STRIPE_BILLING_ENABLED", false);
  if (legacy.issue) return legacy.issue;
  if (legacy.value) {
    return "STRIPE_BILLING_ENABLED is obsolete; migrate to STRIPE_USAGE_BILLING_ENABLED and STRIPE_CHECKOUT_ENABLED.";
  }
  return undefined;
}

function vercelStripeModeIssue(
  env: StripeBillingEnv,
  mode: StripeKeyMode | null,
) {
  if (!mode) return undefined;
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  const targetEnv = env.VERCEL_TARGET_ENV?.trim().toLowerCase();
  const isVercel = env.VERCEL?.trim() === "1" || Boolean(vercelEnv || targetEnv);
  if (!isVercel) return undefined;
  const declaredEnvironments = [vercelEnv, targetEnv].filter(
    (value): value is string => Boolean(value),
  );
  const isProductionTarget =
    declaredEnvironments.length > 0 &&
    declaredEnvironments.every((value) => value === "production");
  if (mode === "live" && !isProductionTarget) {
    return "Live Stripe keys are only allowed in a Vercel production environment.";
  }
  if (mode === "test" && declaredEnvironments.includes("production")) {
    return "Stripe test keys are not allowed in a Vercel production environment.";
  }
  return undefined;
}

/** Pure, local credential parsing. No feature flag is consulted and no network request is made. */
export function parseStripeClientConfig(env: StripeBillingEnv): StripeClientConfigResult {
  const secretKey = configuredValue(env, "STRIPE_SECRET_KEY");
  const accountId = configuredValue(env, "STRIPE_ACCOUNT_ID");
  const allowLive = booleanSetting(env, "STRIPE_ALLOW_LIVE", false);
  if (!secretKey && !allowLive.issue) {
    return {
      ok: false,
      availability: unavailable(false, "not_configured", [requiredIssue("STRIPE_SECRET_KEY")]),
    };
  }

  const issues: string[] = [];
  if (allowLive.issue) issues.push(allowLive.issue);
  const mode = keyMode(secretKey);
  if (secretKey && !mode) {
    issues.push(
      "STRIPE_SECRET_KEY must be an sk_, rk_, or supported rkcs_test_ Stripe secret key.",
    );
  }
  if (
    mode === "live" &&
    (env.NODE_ENV?.trim().toLowerCase() !== "production" || !allowLive.value)
  ) {
    issues.push("Live Stripe keys require NODE_ENV=production and STRIPE_ALLOW_LIVE=true.");
  }
  const vercelModeIssue = vercelStripeModeIssue(env, mode);
  if (vercelModeIssue) issues.push(vercelModeIssue);
  if (!secretKey) issues.push(requiredIssue("STRIPE_SECRET_KEY"));
  if (!accountId) issues.push(requiredIssue("STRIPE_ACCOUNT_ID"));
  else if (!accountId.startsWith("acct_")) {
    issues.push("STRIPE_ACCOUNT_ID must start with acct_.");
  }
  if (!mode || issues.length > 0) {
    return { ok: false, availability: unavailable(true, "invalid_configuration", issues) };
  }

  const config: StripeClientConfig = Object.freeze({
    apiVersion: STRIPE_API_VERSION,
    secretKey,
    keyMode: mode,
    accountId,
  });
  return {
    ok: true,
    config,
    availability: Object.freeze({
      enabled: true,
      available: true,
      keyMode: mode,
      issues: [] as const,
    }),
  };
}

/** Pure Customer Portal configuration parsing, independent of webhook and billing flags. */
export function parseStripePortalConfig(env: StripeBillingEnv): StripePortalConfigResult {
  const client = parseStripeClientConfig(env);
  const portalConfigurationId = configuredValue(env, "STRIPE_PORTAL_CONFIGURATION_ID");
  const paymentMethodConfigurationId = configuredValue(
    env,
    "STRIPE_PAYMENT_METHOD_CONFIGURATION_ID",
  );
  const issues = client.ok ? [] : [...client.availability.issues];
  if (!portalConfigurationId) {
    issues.push(requiredIssue("STRIPE_PORTAL_CONFIGURATION_ID"));
  } else if (!portalConfigurationId.startsWith("bpc_")) {
    issues.push("STRIPE_PORTAL_CONFIGURATION_ID must start with bpc_.");
  }
  if (!paymentMethodConfigurationId) {
    issues.push(requiredIssue("STRIPE_PAYMENT_METHOD_CONFIGURATION_ID"));
  } else if (!paymentMethodConfigurationId.startsWith("pmc_")) {
    issues.push("STRIPE_PAYMENT_METHOD_CONFIGURATION_ID must start with pmc_.");
  }
  if (!client.ok || issues.length > 0) {
    const whollyMissing =
      !configuredValue(env, "STRIPE_SECRET_KEY") &&
      !portalConfigurationId &&
      !paymentMethodConfigurationId;
    return {
      ok: false,
      availability: unavailable(
        !whollyMissing,
        whollyMissing ? "not_configured" : "invalid_configuration",
        issues,
      ),
    };
  }

  const config: StripePortalConfig = Object.freeze({
    ...client.config,
    portalConfigurationId,
    paymentMethodConfigurationId,
  });
  return {
    ok: true,
    config,
    availability: Object.freeze({
      enabled: true,
      available: true,
      keyMode: client.config.keyMode,
      portalConfigurationId,
      paymentMethodConfigurationId,
      issues: [] as const,
    }),
  };
}

/** Pure webhook configuration parsing, independent of runtime and Checkout flags. */
export function parseStripeWebhookConfig(env: StripeBillingEnv): StripeWebhookConfigResult {
  const client = parseStripeClientConfig(env);
  const webhookSecret = configuredValue(env, "STRIPE_WEBHOOK_SECRET");
  const issues = client.ok ? [] : [...client.availability.issues];
  if (!webhookSecret) issues.push(requiredIssue("STRIPE_WEBHOOK_SECRET"));
  else if (!webhookSecret.startsWith("whsec_")) {
    issues.push("STRIPE_WEBHOOK_SECRET must start with whsec_.");
  }
  if (!client.ok || issues.length > 0) {
    const whollyMissing = !configuredValue(env, "STRIPE_SECRET_KEY") && !webhookSecret;
    return {
      ok: false,
      availability: unavailable(
        !whollyMissing,
        whollyMissing ? "not_configured" : "invalid_configuration",
        issues,
      ),
    };
  }

  const config: StripeWebhookConfig = Object.freeze({
    ...client.config,
    webhookSecret,
  });
  return {
    ok: true,
    config,
    availability: Object.freeze({
      enabled: true,
      available: true,
      keyMode: client.config.keyMode,
      issues: [] as const,
    }),
  };
}

/** Pure catalog configuration parsing, independent of runtime and Checkout flags. */
export function parseStripeCatalogConfig(env: StripeBillingEnv): StripeCatalogConfigResult {
  const client = parseStripeClientConfig(env);
  const automaticTax = booleanSetting(env, "STRIPE_AUTOMATIC_TAX_ENABLED", false);
  const priceIds = {
    aiGrade: configuredValue(env, STRIPE_PRICE_ENV_KEYS.aiGrade),
    audioMinute: configuredValue(env, STRIPE_PRICE_ENV_KEYS.audioMinute),
  };
  const issues = client.ok ? [] : [...client.availability.issues];
  if (automaticTax.issue) issues.push(automaticTax.issue);
  if (automaticTax.value) {
    issues.push(
      "STRIPE_AUTOMATIC_TAX_ENABLED must remain false until Habla pins and reviews explicit Stripe product tax codes and Price tax behavior.",
    );
  }
  for (const [name, value] of Object.entries(priceIds)) {
    const environmentKey = STRIPE_PRICE_ENV_KEYS[name as keyof typeof priceIds];
    if (!value) issues.push(requiredIssue(environmentKey));
    else if (!value.startsWith("price_")) issues.push(`${environmentKey} must start with price_.`);
  }
  const configuredPriceIds = Object.values(priceIds).filter(Boolean);
  if (
    configuredPriceIds.length === Object.keys(priceIds).length &&
    new Set(configuredPriceIds).size !== configuredPriceIds.length
  ) {
    issues.push("Stripe metered price IDs must be distinct.");
  }
  if (!client.ok || issues.length > 0) {
    const whollyMissing =
      !configuredValue(env, "STRIPE_SECRET_KEY") && configuredPriceIds.length === 0;
    return {
      ok: false,
      availability: unavailable(
        !whollyMissing,
        whollyMissing ? "not_configured" : "invalid_configuration",
        issues,
      ),
    };
  }

  const config: StripeCatalogConfig = Object.freeze({
    ...client.config,
    priceIds: Object.freeze(priceIds),
    automaticTaxEnabled: automaticTax.value,
  });
  return {
    ok: true,
    config,
    availability: Object.freeze({
      enabled: true,
      available: true,
      keyMode: client.config.keyMode,
      automaticTaxEnabled: automaticTax.value,
      issues: [] as const,
    }),
  };
}

/** Pure usage-runtime parsing. Remote Stripe catalog validation is deliberately separate. */
export function parseStripeUsageBillingConfig(
  env: StripeBillingEnv,
): StripeUsageBillingConfigResult {
  const usage = booleanSetting(env, "STRIPE_USAGE_BILLING_ENABLED", false);
  const flagIssues = uniqueIssues([usage.issue, legacyBillingFlagIssue(env)]);
  if (flagIssues.length > 0) {
    return {
      ok: false,
      availability: unavailable(usage.value, "invalid_configuration", flagIssues),
    };
  }
  if (!usage.value) return { ok: false, availability: disabled() };

  const webhook = parseStripeWebhookConfig(env);
  const catalog = parseStripeCatalogConfig(env);
  const recoveryIssue = configuredValue(env, "CRON_SECRET")
    ? undefined
    : requiredIssue("CRON_SECRET");
  if (!webhook.ok || !catalog.ok || recoveryIssue) {
    return {
      ok: false,
      availability: unavailable(
        true,
        "invalid_configuration",
        uniqueIssues([
          ...(webhook.ok ? [] : webhook.availability.issues),
          ...(catalog.ok ? [] : catalog.availability.issues),
          recoveryIssue,
        ]),
      ),
    };
  }

  const config: StripeUsageBillingConfig = Object.freeze({
    ...catalog.config,
    webhookSecret: webhook.config.webhookSecret,
    enabled: true,
    usageBillingEnabled: true,
  });
  return {
    ok: true,
    config,
    availability: Object.freeze({
      enabled: true,
      available: true,
      keyMode: config.keyMode,
      automaticTaxEnabled: config.automaticTaxEnabled,
      usageBillingEnabled: true,
      issues: [] as const,
    }),
  };
}

/** Pure Checkout-acquisition parsing. Checkout can only run on a valid usage runtime. */
export function parseStripeCheckoutConfig(env: StripeBillingEnv): StripeCheckoutConfigResult {
  const checkout = booleanSetting(env, "STRIPE_CHECKOUT_ENABLED", false);
  const flagIssues = uniqueIssues([checkout.issue, legacyBillingFlagIssue(env)]);
  if (flagIssues.length > 0) {
    return {
      ok: false,
      availability: unavailable(checkout.value, "invalid_configuration", flagIssues),
    };
  }
  if (!checkout.value) return { ok: false, availability: disabled() };

  const usage = parseStripeUsageBillingConfig(env);
  if (!usage.ok) {
    const issues =
      usage.availability.reason === "disabled"
        ? ["STRIPE_CHECKOUT_ENABLED=true requires STRIPE_USAGE_BILLING_ENABLED=true."]
        : [...usage.availability.issues];
    return {
      ok: false,
      availability: unavailable(true, "invalid_configuration", issues),
    };
  }

  const config: StripeCheckoutConfig = Object.freeze({
    ...usage.config,
    checkoutEnabled: true,
  });
  return {
    ok: true,
    config,
    availability: Object.freeze({
      enabled: true,
      available: true,
      keyMode: config.keyMode,
      automaticTaxEnabled: config.automaticTaxEnabled,
      usageBillingEnabled: true,
      checkoutEnabled: true,
      issues: [] as const,
    }),
  };
}

function requireConfig<Config>(
  parsed:
    | Readonly<{ ok: true; config: Config }>
    | Readonly<{ ok: false; availability: StripeUnavailable }>,
): Config {
  if (!parsed.ok) {
    throw new StripeBillingConfigurationError(parsed.availability);
  }
  return parsed.config;
}

export function getStripeClientAvailability(
  env: StripeBillingEnv = process.env,
): StripeClientAvailability {
  return parseStripeClientConfig(env).availability;
}

export function requireStripeClientConfig(
  env: StripeBillingEnv = process.env,
): StripeClientConfig {
  return requireConfig(parseStripeClientConfig(env));
}

export function getStripePortalAvailability(
  env: StripeBillingEnv = process.env,
): StripePortalAvailability {
  return parseStripePortalConfig(env).availability;
}

export function requireStripePortalConfig(
  env: StripeBillingEnv = process.env,
): StripePortalConfig {
  return requireConfig(parseStripePortalConfig(env));
}

export function getStripeWebhookAvailability(
  env: StripeBillingEnv = process.env,
): StripeWebhookAvailability {
  return parseStripeWebhookConfig(env).availability;
}

export function requireStripeWebhookConfig(
  env: StripeBillingEnv = process.env,
): StripeWebhookConfig {
  return requireConfig(parseStripeWebhookConfig(env));
}

export function getStripeCatalogAvailability(
  env: StripeBillingEnv = process.env,
): StripeCatalogAvailability {
  return parseStripeCatalogConfig(env).availability;
}

export function requireStripeCatalogConfig(
  env: StripeBillingEnv = process.env,
): StripeCatalogConfig {
  return requireConfig(parseStripeCatalogConfig(env));
}

export function getStripeUsageBillingAvailability(
  env: StripeBillingEnv = process.env,
): StripeUsageBillingAvailability {
  return parseStripeUsageBillingConfig(env).availability;
}

export function requireStripeUsageBillingConfig(
  env: StripeBillingEnv = process.env,
): StripeUsageBillingConfig {
  return requireConfig(parseStripeUsageBillingConfig(env));
}

export function getStripeCheckoutAvailability(
  env: StripeBillingEnv = process.env,
): StripeCheckoutAvailability {
  return parseStripeCheckoutConfig(env).availability;
}

export function requireStripeCheckoutConfig(
  env: StripeBillingEnv = process.env,
): StripeCheckoutConfig {
  return requireConfig(parseStripeCheckoutConfig(env));
}

/** @deprecated Use StripeUsageBillingConfig or a narrower capability config. */
export type StripeBillingConfig = StripeUsageBillingConfig;
/** @deprecated Use StripeUsageBillingAvailability. */
export type StripeBillingAvailability = StripeUsageBillingAvailability;
/** @deprecated Use StripeUsageBillingConfigResult. */
export type StripeBillingConfigResult = StripeUsageBillingConfigResult;
/** @deprecated Use parseStripeUsageBillingConfig. */
export const parseStripeBillingConfig = parseStripeUsageBillingConfig;
/** @deprecated Use getStripeUsageBillingAvailability. */
export const getStripeBillingAvailability = getStripeUsageBillingAvailability;
/** @deprecated Use requireStripeUsageBillingConfig. */
export const requireStripeBillingConfig = requireStripeUsageBillingConfig;

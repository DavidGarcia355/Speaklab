export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export const STRIPE_PRICE_ENV_KEYS = Object.freeze({
  teacher: "STRIPE_TRYHABLA_TEACHER_PRICE_ID",
} as const);

const OBSOLETE_STRIPE_PRICE_ENV_KEYS = Object.freeze([
  "STRIPE_AI_GRADE_PRICE_ID",
  "STRIPE_AI_AUDIO_SECONDS_PRICE_ID",
] as const);

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
      teacher: string;
    }>;
    automaticTaxEnabled: boolean;
  }>;

export type StripeSubscriptionBillingConfig = StripeWebhookConfig &
  StripeCatalogConfig &
  Readonly<{
    enabled: true;
    subscriptionBillingEnabled: true;
  }>;

/** @deprecated Metered billing is retired. Use StripeSubscriptionBillingConfig. */
export type StripeUsageBillingConfig = StripeSubscriptionBillingConfig;

export type StripeCheckoutConfig = StripeSubscriptionBillingConfig &
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
export type StripeSubscriptionBillingAvailability =
  | StripeAvailable<{
      keyMode: StripeKeyMode;
      automaticTaxEnabled: boolean;
      subscriptionBillingEnabled: true;
    }>
  | StripeUnavailable;
/** @deprecated Metered billing is retired. Use StripeSubscriptionBillingAvailability. */
export type StripeUsageBillingAvailability = StripeSubscriptionBillingAvailability;
export type StripeCheckoutAvailability =
  | StripeAvailable<{
      keyMode: StripeKeyMode;
      automaticTaxEnabled: boolean;
      subscriptionBillingEnabled: true;
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
export type StripeSubscriptionBillingConfigResult = StripeConfigResult<
  StripeSubscriptionBillingConfig,
  StripeSubscriptionBillingAvailability
>;
/** @deprecated Metered billing is retired. Use StripeSubscriptionBillingConfigResult. */
export type StripeUsageBillingConfigResult = StripeSubscriptionBillingConfigResult;
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
    return "STRIPE_BILLING_ENABLED is obsolete; migrate to STRIPE_SUBSCRIPTION_BILLING_ENABLED and STRIPE_CHECKOUT_ENABLED.";
  }
  return undefined;
}

function obsoleteUsageBillingFlagIssue(env: StripeBillingEnv) {
  const raw = configuredValue(env, "STRIPE_USAGE_BILLING_ENABLED");
  if (!raw) return undefined;
  const parsed = booleanSetting(env, "STRIPE_USAGE_BILLING_ENABLED", false);
  if (parsed.issue) return parsed.issue;
  return "STRIPE_USAGE_BILLING_ENABLED is obsolete; remove it and use STRIPE_SUBSCRIPTION_BILLING_ENABLED.";
}

function obsoletePriceEnvironmentIssues(env: StripeBillingEnv) {
  return OBSOLETE_STRIPE_PRICE_ENV_KEYS.filter((key) => configuredValue(env, key)).map(
    (key) =>
      `${key} is obsolete; remove both retired metered Price variables before enabling Stripe billing.`,
  );
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
    teacher: configuredValue(env, STRIPE_PRICE_ENV_KEYS.teacher),
  };
  const issues = client.ok ? [] : [...client.availability.issues];
  issues.push(...obsoletePriceEnvironmentIssues(env));
  if (automaticTax.issue) issues.push(automaticTax.issue);
  if (automaticTax.value) {
    issues.push(
      "STRIPE_AUTOMATIC_TAX_ENABLED must remain false until TryHabla pins and reviews explicit Stripe product tax codes and Price tax behavior.",
    );
  }
  for (const [name, value] of Object.entries(priceIds)) {
    const environmentKey = STRIPE_PRICE_ENV_KEYS[name as keyof typeof priceIds];
    if (!value) issues.push(requiredIssue(environmentKey));
    else if (!value.startsWith("price_")) issues.push(`${environmentKey} must start with price_.`);
  }
  const configuredPriceIds = Object.values(priceIds).filter(Boolean);
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

/** Pure licensed-subscription parsing. Remote Stripe catalog validation is separate. */
export function parseStripeSubscriptionBillingConfig(
  env: StripeBillingEnv,
): StripeSubscriptionBillingConfigResult {
  const subscription = booleanSetting(env, "STRIPE_SUBSCRIPTION_BILLING_ENABLED", false);
  const flagIssues = uniqueIssues([
    subscription.issue,
    legacyBillingFlagIssue(env),
    obsoleteUsageBillingFlagIssue(env),
  ]);
  if (flagIssues.length > 0) {
    return {
      ok: false,
      availability: unavailable(subscription.value, "invalid_configuration", flagIssues),
    };
  }
  if (!subscription.value) return { ok: false, availability: disabled() };

  const webhook = parseStripeWebhookConfig(env);
  const catalog = parseStripeCatalogConfig(env);
  if (!webhook.ok || !catalog.ok) {
    return {
      ok: false,
      availability: unavailable(
        true,
        "invalid_configuration",
        uniqueIssues([
          ...(webhook.ok ? [] : webhook.availability.issues),
          ...(catalog.ok ? [] : catalog.availability.issues),
        ]),
      ),
    };
  }

  const config: StripeSubscriptionBillingConfig = Object.freeze({
    ...catalog.config,
    webhookSecret: webhook.config.webhookSecret,
    enabled: true,
    subscriptionBillingEnabled: true,
  });
  return {
    ok: true,
    config,
    availability: Object.freeze({
      enabled: true,
      available: true,
      keyMode: config.keyMode,
      automaticTaxEnabled: config.automaticTaxEnabled,
      subscriptionBillingEnabled: true,
      issues: [] as const,
    }),
  };
}

/**
 * @deprecated Meter-event billing is retired. This parser always fails closed so
 * legacy callers cannot emit usage against the licensed Teacher subscription.
 */
export function parseStripeUsageBillingConfig(
  env: StripeBillingEnv,
): StripeUsageBillingConfigResult {
  const legacy = booleanSetting(env, "STRIPE_USAGE_BILLING_ENABLED", false);
  if (legacy.issue) {
    return {
      ok: false,
      availability: unavailable(false, "invalid_configuration", [legacy.issue]),
    };
  }
  if (legacy.value) {
    return {
      ok: false,
      availability: unavailable(true, "invalid_configuration", [
        "STRIPE_USAGE_BILLING_ENABLED is obsolete; metered delivery is disabled for the licensed Teacher plan.",
      ]),
    };
  }
  return { ok: false, availability: disabled() };
}

/** Pure Checkout parsing. Checkout requires the licensed-subscription runtime. */
export function parseStripeCheckoutConfig(env: StripeBillingEnv): StripeCheckoutConfigResult {
  const checkout = booleanSetting(env, "STRIPE_CHECKOUT_ENABLED", false);
  const flagIssues = uniqueIssues([
    checkout.issue,
    legacyBillingFlagIssue(env),
    obsoleteUsageBillingFlagIssue(env),
  ]);
  if (flagIssues.length > 0) {
    return {
      ok: false,
      availability: unavailable(checkout.value, "invalid_configuration", flagIssues),
    };
  }
  if (!checkout.value) return { ok: false, availability: disabled() };

  const subscription = parseStripeSubscriptionBillingConfig(env);
  if (!subscription.ok) {
    const issues =
      subscription.availability.reason === "disabled"
        ? ["STRIPE_CHECKOUT_ENABLED=true requires STRIPE_SUBSCRIPTION_BILLING_ENABLED=true."]
        : [...subscription.availability.issues];
    return {
      ok: false,
      availability: unavailable(true, "invalid_configuration", issues),
    };
  }

  const config: StripeCheckoutConfig = Object.freeze({
    ...subscription.config,
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
      subscriptionBillingEnabled: true,
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

export function getStripeSubscriptionBillingAvailability(
  env: StripeBillingEnv = process.env,
): StripeSubscriptionBillingAvailability {
  return parseStripeSubscriptionBillingConfig(env).availability;
}

export function requireStripeSubscriptionBillingConfig(
  env: StripeBillingEnv = process.env,
): StripeSubscriptionBillingConfig {
  return requireConfig(parseStripeSubscriptionBillingConfig(env));
}

/** @deprecated Meter-event billing is retired and this capability fails closed. */
export function getStripeUsageBillingAvailability(
  env: StripeBillingEnv = process.env,
): StripeUsageBillingAvailability {
  return parseStripeUsageBillingConfig(env).availability;
}

/** @deprecated Meter-event billing is retired and this capability fails closed. */
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

/** Compatibility alias for the licensed subscription billing configuration. */
export type StripeBillingConfig = StripeSubscriptionBillingConfig;
/** Compatibility alias for the licensed subscription billing availability. */
export type StripeBillingAvailability = StripeSubscriptionBillingAvailability;
/** Compatibility alias for the licensed subscription billing result. */
export type StripeBillingConfigResult = StripeSubscriptionBillingConfigResult;
export const parseStripeBillingConfig = parseStripeSubscriptionBillingConfig;
export const getStripeBillingAvailability = getStripeSubscriptionBillingAvailability;
export const requireStripeBillingConfig = requireStripeSubscriptionBillingConfig;

import { createHash } from "node:crypto";
import type Stripe from "stripe";
import {
  assertConfiguredStripeAccount,
  type StripeAccountReadClient,
} from "@/lib/billing/account-validation";
import { getStripeClient } from "@/lib/billing/client";
import {
  requireStripePortalConfig,
  type StripeBillingEnv,
  type StripeKeyMode,
  type StripePortalConfig,
} from "@/lib/billing/config";

export const STRIPE_PORTAL_CONFIGURATION_MANIFEST = Object.freeze({
  schemaVersion: 3 as const,
  // Legacy exact live Stripe contract. Rename only with a replacement bpc_ ID cutover.
  name: "Habla teacher billing portal v3",
  defaultReturnUrl: "https://tryhabla.com/billing",
  businessProfile: Object.freeze({
    headline: "Manage your Habla teacher billing.",
    privacyPolicyUrl: "https://tryhabla.com/privacy",
    termsOfServiceUrl: "https://tryhabla.com/terms",
  }),
  metadata: Object.freeze({
    habla_app: "tryhabla",
    habla_portal_role: "teacher_billing",
    habla_portal_schema_version: "3",
  }),
  loginPageEnabled: true,
  customerUpdateEnabled: true,
  customerUpdateAllowedUpdates: Object.freeze(["address", "name", "tax_id"] as const),
  invoiceHistoryEnabled: true,
  paymentMethodUpdateEnabled: true,
  subscriptionCancel: Object.freeze({
    enabled: true,
    mode: "at_period_end" as const,
    prorationBehavior: "none" as const,
  }),
  subscriptionUpdateEnabled: false,
});

export type StripePortalConfigurationManifest =
  typeof STRIPE_PORTAL_CONFIGURATION_MANIFEST;

export type StripePortalReadConfiguration = Readonly<{
  id: string;
  name: string | null;
  active: boolean;
  livemode: boolean;
  defaultReturnUrl: string | null;
  businessProfileHeadline: string | null;
  businessProfilePrivacyPolicyUrl: string | null;
  businessProfileTermsOfServiceUrl: string | null;
  loginPageEnabled: boolean;
  customerUpdateEnabled: boolean;
  customerUpdateAllowedUpdates: readonly string[];
  invoiceHistoryEnabled: boolean;
  paymentMethodUpdateEnabled: boolean;
  paymentMethodConfigurationId: string | null;
  subscriptionCancelEnabled: boolean;
  subscriptionCancelMode: string;
  subscriptionCancelProrationBehavior: string;
  subscriptionUpdateEnabled: boolean;
  metadata: Readonly<Record<string, string>>;
}>;

export type StripePortalReadPaymentMethodConfiguration = Readonly<{
  id: string;
  active: boolean;
  livemode: boolean;
  cardAvailable: boolean;
  methodPreferences: Readonly<Record<string, string>>;
}>;

export interface StripePortalConfigurationReadClient extends StripeAccountReadClient {
  retrieveConfiguration(configurationId: string): Promise<StripePortalReadConfiguration>;
  retrievePaymentMethodConfiguration(
    configurationId: string,
  ): Promise<StripePortalReadPaymentMethodConfiguration>;
}

export type StripePortalValidationErrorCode =
  | "portal_configuration_read_failed"
  | "portal_configuration_mode_mismatch"
  | "portal_configuration_contract_mismatch"
  | "portal_configuration_metadata_mismatch"
  | "payment_method_configuration_read_failed"
  | "payment_method_configuration_mode_mismatch"
  | "payment_method_configuration_contract_mismatch";

export class StripePortalValidationError extends Error {
  readonly code: StripePortalValidationErrorCode;
  readonly field: string;

  constructor(code: StripePortalValidationErrorCode, field: string) {
    super(`Stripe Customer Portal configuration validation failed (${field}).`);
    this.name = "StripePortalValidationError";
    this.code = code;
    this.field = field;
  }
}

export type StripePortalValidationResult = Readonly<{
  valid: true;
  cached: boolean;
  checkedAt: string;
  keyMode: StripeKeyMode;
  configurationId: string;
  schemaVersion: 3;
  paymentMethodConfigurationId: string;
}>;

export type AssertConfiguredStripePortalOptions = Readonly<{
  client?: StripePortalConfigurationReadClient;
  manifest?: StripePortalConfigurationManifest;
  cache?: boolean;
  cacheTtlMs?: number;
  now?: () => number;
}>;

const DEFAULT_SUCCESS_CACHE_TTL_MS = 60_000;
const MAX_SUCCESS_CACHE_TTL_MS = 300_000;
const MAX_CACHE_ENTRIES = 32;

const successfulValidations = new Map<
  string,
  { expiresAt: number; result: StripePortalValidationResult }
>();

export function normalizeStripePortalConfiguration(
  configuration: Stripe.BillingPortal.Configuration,
): StripePortalReadConfiguration {
  return Object.freeze({
    id: configuration.id,
    name: configuration.name,
    active: configuration.active,
    livemode: configuration.livemode,
    defaultReturnUrl: configuration.default_return_url,
    businessProfileHeadline: configuration.business_profile.headline,
    businessProfilePrivacyPolicyUrl:
      configuration.business_profile.privacy_policy_url,
    businessProfileTermsOfServiceUrl:
      configuration.business_profile.terms_of_service_url,
    loginPageEnabled: configuration.login_page.enabled,
    customerUpdateEnabled: configuration.features.customer_update.enabled,
    customerUpdateAllowedUpdates: Object.freeze(
      [...configuration.features.customer_update.allowed_updates].sort(),
    ),
    invoiceHistoryEnabled: configuration.features.invoice_history.enabled,
    paymentMethodUpdateEnabled: configuration.features.payment_method_update.enabled,
    paymentMethodConfigurationId:
      configuration.features.payment_method_update.payment_method_configuration,
    subscriptionCancelEnabled: configuration.features.subscription_cancel.enabled,
    subscriptionCancelMode: configuration.features.subscription_cancel.mode,
    subscriptionCancelProrationBehavior:
      configuration.features.subscription_cancel.proration_behavior,
    subscriptionUpdateEnabled: configuration.features.subscription_update.enabled,
    metadata: Object.freeze({ ...(configuration.metadata ?? {}) }),
  });
}

function metadataMatches(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
) {
  const actualEntries = Object.entries(actual).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

export function assertStripePortalConfigurationContract(
  configuration: StripePortalReadConfiguration,
  input: Readonly<{
    configurationId: string;
    keyMode: StripeKeyMode;
    paymentMethodConfigurationId: string;
    manifest?: StripePortalConfigurationManifest;
  }>,
) {
  const manifest = input.manifest ?? STRIPE_PORTAL_CONFIGURATION_MANIFEST;
  if (configuration.livemode !== (input.keyMode === "live")) {
    throw new StripePortalValidationError(
      "portal_configuration_mode_mismatch",
      "livemode",
    );
  }
  if (!metadataMatches(configuration.metadata, manifest.metadata)) {
    throw new StripePortalValidationError(
      "portal_configuration_metadata_mismatch",
      "metadata",
    );
  }
  if (
    configuration.id !== input.configurationId ||
    configuration.name !== manifest.name ||
    configuration.active !== true ||
    configuration.defaultReturnUrl !== manifest.defaultReturnUrl ||
    configuration.businessProfileHeadline !== manifest.businessProfile.headline ||
    configuration.businessProfilePrivacyPolicyUrl !==
      manifest.businessProfile.privacyPolicyUrl ||
    configuration.businessProfileTermsOfServiceUrl !==
      manifest.businessProfile.termsOfServiceUrl ||
    configuration.loginPageEnabled !== manifest.loginPageEnabled ||
    configuration.customerUpdateEnabled !== manifest.customerUpdateEnabled ||
    JSON.stringify([...configuration.customerUpdateAllowedUpdates].sort()) !==
      JSON.stringify([...manifest.customerUpdateAllowedUpdates].sort()) ||
    configuration.invoiceHistoryEnabled !== manifest.invoiceHistoryEnabled ||
    configuration.paymentMethodUpdateEnabled !== manifest.paymentMethodUpdateEnabled ||
    configuration.paymentMethodConfigurationId !== input.paymentMethodConfigurationId ||
    configuration.subscriptionCancelEnabled !== manifest.subscriptionCancel.enabled ||
    configuration.subscriptionCancelMode !== manifest.subscriptionCancel.mode ||
    configuration.subscriptionCancelProrationBehavior !==
      manifest.subscriptionCancel.prorationBehavior ||
    configuration.subscriptionUpdateEnabled !== manifest.subscriptionUpdateEnabled
  ) {
    throw new StripePortalValidationError(
      "portal_configuration_contract_mismatch",
      "contract",
    );
  }
}

function createReadClient(config: StripePortalConfig): StripePortalConfigurationReadClient {
  const stripe = getStripeClient(config);
  return {
    async retrieveAccountId() {
      return (await stripe.accounts.retrieve(null)).id;
    },
    async retrieveConfiguration(configurationId) {
      return normalizeStripePortalConfiguration(
        await stripe.billingPortal.configurations.retrieve(configurationId),
      );
    },
    async retrievePaymentMethodConfiguration(configurationId) {
      const configuration = await stripe.paymentMethodConfigurations.retrieve(configurationId);
      const methodPreferences = Object.fromEntries(
        Object.entries(configuration)
        .flatMap(([name, value]) => {
          if (!value || typeof value !== "object") return [];
          if (!("available" in value) && !("display_preference" in value)) return [];
          if (!("display_preference" in value)) return [[name, "<missing>"]];
          const displayPreference = value.display_preference;
          if (!displayPreference || typeof displayPreference !== "object") {
            return [[name, "<missing>"]];
          }
          if (!("value" in displayPreference)) return [[name, "<missing>"]];
          return [[name, String(displayPreference.value)]];
        })
        .sort(([left], [right]) => left.localeCompare(right)),
      );
      return Object.freeze({
        id: configuration.id,
        active: configuration.active,
        livemode: configuration.livemode,
        cardAvailable: configuration.card?.available === true,
        methodPreferences: Object.freeze(methodPreferences),
      });
    },
  };
}

function cacheKey(
  config: StripePortalConfig,
  manifest: StripePortalConfigurationManifest,
) {
  return createHash("sha256")
    .update(
      [
        config.secretKey,
        config.apiVersion,
        config.keyMode,
        config.accountId,
        config.portalConfigurationId,
        config.paymentMethodConfigurationId,
        JSON.stringify(manifest),
      ].join("\0"),
    )
    .digest("hex");
}

function pruneCache(now: number) {
  for (const [key, entry] of successfulValidations) {
    if (entry.expiresAt <= now) successfulValidations.delete(key);
  }
  while (successfulValidations.size >= MAX_CACHE_ENTRIES) {
    const oldest = successfulValidations.keys().next().value as string | undefined;
    if (!oldest) break;
    successfulValidations.delete(oldest);
  }
}

/** Reads and validates the pinned Portal configuration. It never mutates Stripe state. */
export async function assertConfiguredStripePortal(
  config: StripePortalConfig,
  options: AssertConfiguredStripePortalOptions = {},
): Promise<StripePortalValidationResult> {
  const manifest = options.manifest ?? STRIPE_PORTAL_CONFIGURATION_MANIFEST;
  const now = options.now?.() ?? Date.now();
  const useCache = options.cache !== false;
  const key = cacheKey(config, manifest);
  if (useCache) {
    const cached = successfulValidations.get(key);
    if (cached && cached.expiresAt > now) {
      return Object.freeze({ ...cached.result, cached: true });
    }
  }

  const client = options.client ?? createReadClient(config);
  await assertConfiguredStripeAccount(config, {
    client,
    cache: useCache,
    cacheTtlMs: options.cacheTtlMs,
    now: options.now,
  });
  let configuration: StripePortalReadConfiguration;
  try {
    configuration = await client.retrieveConfiguration(config.portalConfigurationId);
  } catch {
    throw new StripePortalValidationError(
      "portal_configuration_read_failed",
      "remote_read",
    );
  }
  assertStripePortalConfigurationContract(configuration, {
    configurationId: config.portalConfigurationId,
    keyMode: config.keyMode,
    paymentMethodConfigurationId: config.paymentMethodConfigurationId,
    manifest,
  });

  let paymentMethodConfiguration: StripePortalReadPaymentMethodConfiguration;
  try {
    paymentMethodConfiguration = await client.retrievePaymentMethodConfiguration(
      config.paymentMethodConfigurationId,
    );
  } catch {
    throw new StripePortalValidationError(
      "payment_method_configuration_read_failed",
      "remote_read",
    );
  }
  if (paymentMethodConfiguration.livemode !== (config.keyMode === "live")) {
    throw new StripePortalValidationError(
      "payment_method_configuration_mode_mismatch",
      "livemode",
    );
  }
  if (
    paymentMethodConfiguration.id !== config.paymentMethodConfigurationId ||
    paymentMethodConfiguration.active !== true ||
    paymentMethodConfiguration.cardAvailable !== true ||
    paymentMethodConfiguration.methodPreferences.card !== "on" ||
    Object.entries(paymentMethodConfiguration.methodPreferences).some(
      ([method, preference]) => method !== "card" && preference !== "off",
    )
  ) {
    throw new StripePortalValidationError(
      "payment_method_configuration_contract_mismatch",
      "card_only",
    );
  }

  const result: StripePortalValidationResult = Object.freeze({
    valid: true,
    cached: false,
    checkedAt: new Date(now).toISOString(),
    keyMode: config.keyMode,
    configurationId: config.portalConfigurationId,
    schemaVersion: manifest.schemaVersion,
    paymentMethodConfigurationId: config.paymentMethodConfigurationId,
  });
  if (useCache) {
    pruneCache(now);
    const requestedTtl = options.cacheTtlMs ?? DEFAULT_SUCCESS_CACHE_TTL_MS;
    const cacheTtlMs = Math.max(1, Math.min(requestedTtl, MAX_SUCCESS_CACHE_TTL_MS));
    successfulValidations.set(key, { expiresAt: now + cacheTtlMs, result });
  }
  return result;
}

export async function isStripePortalRuntimeReady(
  env: StripeBillingEnv = process.env,
  options: AssertConfiguredStripePortalOptions = {},
) {
  try {
    const config = requireStripePortalConfig(env);
    await assertConfiguredStripePortal(config, options);
    return true;
  } catch {
    return false;
  }
}

export function clearStripePortalValidationCacheForTests() {
  successfulValidations.clear();
}

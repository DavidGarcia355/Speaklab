import { createHash } from "node:crypto";
import Stripe from "stripe";
import {
  STRIPE_CATALOG_MANIFEST,
  type StripeCatalogDimension,
  type StripeCatalogDimensionKey,
  type StripeCatalogManifest,
} from "@/lib/billing/catalog-manifest";
import { getStripeClient } from "@/lib/billing/client";
import {
  assertConfiguredStripeAccount,
  type StripeAccountReadClient,
} from "@/lib/billing/account-validation";
import {
  requireStripeUsageBillingConfig,
  type StripeBillingEnv,
  type StripeCatalogConfig,
  type StripeKeyMode,
} from "@/lib/billing/config";

export type StripeCatalogValidationErrorCode =
  | "catalog_manifest_invalid"
  | "catalog_price_read_failed"
  | "catalog_price_mode_mismatch"
  | "catalog_price_contract_mismatch"
  | "catalog_price_currency_mismatch"
  | "catalog_price_rate_mismatch"
  | "catalog_price_metadata_mismatch"
  | "catalog_product_read_failed"
  | "catalog_product_mode_mismatch"
  | "catalog_product_contract_mismatch"
  | "catalog_product_metadata_mismatch"
  | "catalog_fingerprint_mismatch"
  | "catalog_meter_read_failed"
  | "catalog_meter_mode_mismatch"
  | "catalog_meter_contract_mismatch"
  | "catalog_meter_reused";

type StripeCatalogResource = "manifest" | "price" | "product" | "meter";

export class StripeCatalogValidationError extends Error {
  readonly code: StripeCatalogValidationErrorCode;
  readonly resource: StripeCatalogResource;
  readonly dimension?: StripeCatalogDimensionKey;
  readonly field?: string;

  constructor(input: {
    code: StripeCatalogValidationErrorCode;
    resource: StripeCatalogResource;
    dimension?: StripeCatalogDimensionKey;
    field?: string;
  }) {
    const dimension = input.dimension ? ` for ${input.dimension}` : "";
    const field = input.field ? ` (${input.field})` : "";
    super(`Stripe catalog ${input.resource} validation failed${dimension}${field}.`);
    this.name = "StripeCatalogValidationError";
    this.code = input.code;
    this.resource = input.resource;
    this.dimension = input.dimension;
    this.field = input.field;
  }
}

export type StripeCatalogReadPrice = Readonly<{
  id: string;
  livemode: boolean;
  active: boolean;
  lookupKey: string | null;
  nickname: string | null;
  currency: string;
  billingScheme: string;
  type: string;
  productId: string;
  unitAmountDecimalCents: string | null;
  currencyOptions: Readonly<
    Record<string, Readonly<{ unitAmountDecimalCents: string | null }>>
  > | null;
  recurring: Readonly<{
    interval: string;
    intervalCount: number;
    usageType: string;
    meterId: string | null;
    trialPeriodDays: number | null;
  }> | null;
  taxBehavior: string | null;
  customUnitAmount: unknown;
  tiersMode: string | null;
  transformQuantity: unknown;
  metadata: Readonly<Record<string, string>>;
}>;

export type StripeCatalogReadProduct = Readonly<{
  id: string;
  livemode: boolean;
  active: boolean;
  name: string;
  description: string | null;
  unitLabel: string | null;
  type: string;
  metadata: Readonly<Record<string, string>>;
}>;

export type StripeCatalogReadMeter = Readonly<{
  id: string;
  livemode: boolean;
  status: string;
  displayName: string;
  eventName: string;
  aggregationFormula: string;
  customerMappingType: string;
  customerPayloadKey: string;
  valuePayloadKey: string;
  eventTimeWindow: string | null;
}>;

export interface StripeCatalogReadClient extends StripeAccountReadClient {
  retrievePrice(priceId: string): Promise<StripeCatalogReadPrice>;
  retrieveProduct(productId: string): Promise<StripeCatalogReadProduct>;
  retrieveMeter(meterId: string): Promise<StripeCatalogReadMeter>;
}

export type StripeCatalogValidationResult = Readonly<{
  valid: true;
  cached: boolean;
  checkedAt: string;
  keyMode: StripeKeyMode;
  priceBookId: string;
  fingerprint: string;
  dimensions: readonly StripeCatalogDimensionKey[];
}>;

export type AssertConfiguredStripeCatalogOptions = Readonly<{
  client?: StripeCatalogReadClient;
  manifest?: StripeCatalogManifest;
  cache?: boolean;
  cacheTtlMs?: number;
  now?: () => number;
}>;

const DEFAULT_SUCCESS_CACHE_TTL_MS = 60_000;
const MAX_SUCCESS_CACHE_TTL_MS = 300_000;
const MAX_CACHE_ENTRIES = 32;

const successfulValidations = new Map<
  string,
  { expiresAt: number; result: StripeCatalogValidationResult }
>();

function normalizePrice(price: Stripe.Price): StripeCatalogReadPrice {
  return {
    id: price.id,
    livemode: price.livemode,
    active: price.active,
    lookupKey: price.lookup_key,
    nickname: price.nickname,
    currency: price.currency,
    billingScheme: price.billing_scheme,
    type: price.type,
    productId: typeof price.product === "string" ? price.product : price.product.id,
    unitAmountDecimalCents: price.unit_amount_decimal?.toString() ?? null,
    currencyOptions: price.currency_options
      ? Object.freeze(
          Object.fromEntries(
            Object.entries(price.currency_options).map(([currency, option]) => [
              currency,
              Object.freeze({
                unitAmountDecimalCents: option.unit_amount_decimal?.toString() ?? null,
              }),
            ]),
          ),
        )
      : null,
    recurring: price.recurring
      ? {
          interval: price.recurring.interval,
          intervalCount: price.recurring.interval_count,
          usageType: price.recurring.usage_type,
          meterId: price.recurring.meter,
          trialPeriodDays: price.recurring.trial_period_days,
        }
      : null,
    taxBehavior: price.tax_behavior,
    customUnitAmount: price.custom_unit_amount,
    tiersMode: price.tiers_mode,
    transformQuantity: price.transform_quantity,
    metadata: { ...price.metadata },
  };
}

function normalizeProduct(product: Stripe.Product): StripeCatalogReadProduct {
  return {
    id: product.id,
    livemode: product.livemode,
    active: product.active,
    name: product.name,
    description: product.description,
    unitLabel: product.unit_label ?? null,
    type: product.type,
    metadata: { ...product.metadata },
  };
}

function normalizeMeter(meter: Stripe.Billing.Meter): StripeCatalogReadMeter {
  return {
    id: meter.id,
    livemode: meter.livemode,
    status: meter.status,
    displayName: meter.display_name,
    eventName: meter.event_name,
    aggregationFormula: meter.default_aggregation.formula,
    customerMappingType: meter.customer_mapping.type,
    customerPayloadKey: meter.customer_mapping.event_payload_key,
    valuePayloadKey: meter.value_settings.event_payload_key,
    eventTimeWindow: meter.event_time_window,
  };
}

function createReadClient(config: StripeCatalogConfig): StripeCatalogReadClient {
  const stripe = getStripeClient(config);
  return {
    async retrieveAccountId() {
      return (await stripe.accounts.retrieve(null)).id;
    },
    async retrievePrice(priceId) {
      return normalizePrice(
        await stripe.prices.retrieve(priceId, { expand: ["currency_options"] }),
      );
    },
    async retrieveProduct(productId) {
      return normalizeProduct(await stripe.products.retrieve(productId));
    },
    async retrieveMeter(meterId) {
      return normalizeMeter(await stripe.billing.meters.retrieve(meterId));
    },
  };
}

function validationError(
  code: StripeCatalogValidationErrorCode,
  resource: StripeCatalogResource,
  dimension?: StripeCatalogDimensionKey,
  field?: string,
): never {
  throw new StripeCatalogValidationError({ code, resource, dimension, field });
}

function expectedLiveMode(keyMode: StripeKeyMode) {
  return keyMode === "live";
}

function metadataMatches(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
) {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function assertFingerprint(
  metadata: Readonly<Record<string, string>>,
  manifest: StripeCatalogManifest,
  resource: "price" | "product",
  dimension: StripeCatalogDimensionKey,
) {
  if (metadata.catalog_fingerprint !== manifest.fingerprint) {
    validationError("catalog_fingerprint_mismatch", resource, dimension, "fingerprint");
  }
}

function assertPrice(
  price: StripeCatalogReadPrice,
  configuredPriceId: string,
  dimension: StripeCatalogDimension,
  manifest: StripeCatalogManifest,
  keyMode: StripeKeyMode,
) {
  if (price.livemode !== expectedLiveMode(keyMode)) {
    validationError("catalog_price_mode_mismatch", "price", dimension.key, "mode");
  }
  assertFingerprint(price.metadata, manifest, "price", dimension.key);
  if (!metadataMatches(price.metadata, dimension.metadata)) {
    validationError("catalog_price_metadata_mismatch", "price", dimension.key, "metadata");
  }
  const recurring = price.recurring;
  const contractMatches =
    price.id === configuredPriceId &&
    price.active === true &&
    price.lookupKey === dimension.priceLookupKey &&
    price.nickname === dimension.priceNickname &&
    price.currency === manifest.currency &&
    price.billingScheme === "per_unit" &&
    price.type === "recurring" &&
    price.productId === dimension.productId &&
    recurring?.interval === "month" &&
    recurring.intervalCount === 1 &&
    recurring.usageType === "metered" &&
    typeof recurring.meterId === "string" &&
    recurring.meterId.length > 0 &&
    recurring.trialPeriodDays === null &&
    (price.taxBehavior ?? "unspecified") === "unspecified" &&
    price.customUnitAmount === null &&
    price.tiersMode === null &&
    price.transformQuantity === null;
  if (!contractMatches) {
    validationError("catalog_price_contract_mismatch", "price", dimension.key, "contract");
  }
  if (
    price.currencyOptions === null ||
    Object.keys(price.currencyOptions).some((currency) => currency !== manifest.currency)
  ) {
    validationError(
      "catalog_price_currency_mismatch",
      "price",
      dimension.key,
      "currency_options",
    );
  }
  const defaultCurrencyOption = price.currencyOptions[manifest.currency];
  if (defaultCurrencyOption) {
    try {
      if (
        defaultCurrencyOption.unitAmountDecimalCents === null ||
        !Stripe.Decimal.from(defaultCurrencyOption.unitAmountDecimalCents).eq(
          Stripe.Decimal.from(dimension.unitAmountDecimalCents),
        )
      ) {
        validationError("catalog_price_rate_mismatch", "price", dimension.key, "rate");
      }
    } catch (error) {
      if (error instanceof StripeCatalogValidationError) throw error;
      validationError("catalog_price_rate_mismatch", "price", dimension.key, "rate");
    }
  }
  if (price.unitAmountDecimalCents === null) {
    validationError("catalog_price_rate_mismatch", "price", dimension.key, "rate");
  }
  try {
    if (
      !Stripe.Decimal.from(price.unitAmountDecimalCents).eq(
        Stripe.Decimal.from(dimension.unitAmountDecimalCents),
      )
    ) {
      validationError("catalog_price_rate_mismatch", "price", dimension.key, "rate");
    }
  } catch (error) {
    if (error instanceof StripeCatalogValidationError) throw error;
    validationError("catalog_price_rate_mismatch", "price", dimension.key, "rate");
  }
  return recurring.meterId;
}

function assertProduct(
  product: StripeCatalogReadProduct,
  dimension: StripeCatalogDimension,
  manifest: StripeCatalogManifest,
  keyMode: StripeKeyMode,
) {
  if (product.livemode !== expectedLiveMode(keyMode)) {
    validationError("catalog_product_mode_mismatch", "product", dimension.key, "mode");
  }
  assertFingerprint(product.metadata, manifest, "product", dimension.key);
  if (!metadataMatches(product.metadata, dimension.metadata)) {
    validationError("catalog_product_metadata_mismatch", "product", dimension.key, "metadata");
  }
  if (
    product.id !== dimension.productId ||
    product.active !== true ||
    product.name !== dimension.productName ||
    product.description !== dimension.productDescription ||
    product.unitLabel !== dimension.productUnitLabel ||
    product.type !== "service"
  ) {
    validationError("catalog_product_contract_mismatch", "product", dimension.key, "contract");
  }
}

function assertMeter(
  meter: StripeCatalogReadMeter,
  expectedMeterId: string,
  dimension: StripeCatalogDimension,
  keyMode: StripeKeyMode,
) {
  if (meter.livemode !== expectedLiveMode(keyMode)) {
    validationError("catalog_meter_mode_mismatch", "meter", dimension.key, "mode");
  }
  if (
    meter.id !== expectedMeterId ||
    meter.status !== "active" ||
    meter.displayName !== dimension.meterDisplayName ||
    meter.eventName !== dimension.meterEventName ||
    meter.aggregationFormula !== "sum" ||
    meter.customerMappingType !== "by_id" ||
    meter.customerPayloadKey !== "stripe_customer_id" ||
    meter.valuePayloadKey !== "value" ||
    meter.eventTimeWindow !== null
  ) {
    validationError("catalog_meter_contract_mismatch", "meter", dimension.key, "contract");
  }
}

async function readRemote<T>(
  read: () => Promise<T>,
  code: StripeCatalogValidationErrorCode,
  resource: "price" | "product" | "meter",
  dimension: StripeCatalogDimensionKey,
) {
  try {
    return await read();
  } catch {
    return validationError(code, resource, dimension, "remote_read");
  }
}

function configuredPriceId(
  config: StripeCatalogConfig,
  dimension: StripeCatalogDimensionKey,
) {
  return dimension === "successful_grade" ? config.priceIds.aiGrade : config.priceIds.audioMinute;
}

function assertManifest(manifest: StripeCatalogManifest, config: StripeCatalogConfig) {
  const keys = manifest.dimensions.map((dimension) => dimension.key);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== config.apiVersion ||
    manifest.priceBookStatus !== "active" ||
    manifest.currency !== "usd" ||
    !/^[a-f0-9]{64}$/.test(manifest.fingerprint) ||
    keys.length !== 2 ||
    new Set(keys).size !== 2 ||
    !keys.includes("successful_grade") ||
    !keys.includes("audio_second")
  ) {
    validationError("catalog_manifest_invalid", "manifest", undefined, "contract");
  }
}

function cacheKey(config: StripeCatalogConfig, manifest: StripeCatalogManifest) {
  return createHash("sha256")
    .update(
      [
        config.secretKey,
        config.apiVersion,
        config.keyMode,
        config.accountId,
        config.priceIds.aiGrade,
        config.priceIds.audioMinute,
        config.automaticTaxEnabled ? "tax_on" : "tax_off",
        manifest.fingerprint,
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

/**
 * Reads and validates the configured Stripe catalog exactly. This function never creates,
 * updates, archives, or deletes a Stripe resource. Only successful checks are cached.
 */
export async function assertConfiguredStripeCatalog(
  config: StripeCatalogConfig,
  options: AssertConfiguredStripeCatalogOptions = {},
): Promise<StripeCatalogValidationResult> {
  const manifest = options.manifest ?? STRIPE_CATALOG_MANIFEST;
  assertManifest(manifest, config);
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
  const checked = await Promise.all(
    manifest.dimensions.map(async (dimension) => {
      const priceId = configuredPriceId(config, dimension.key);
      const price = await readRemote(
        () => client.retrievePrice(priceId),
        "catalog_price_read_failed",
        "price",
        dimension.key,
      );
      const meterId = assertPrice(price, priceId, dimension, manifest, config.keyMode);
      const [product, meter] = await Promise.all([
        readRemote(
          () => client.retrieveProduct(dimension.productId),
          "catalog_product_read_failed",
          "product",
          dimension.key,
        ),
        readRemote(
          () => client.retrieveMeter(meterId),
          "catalog_meter_read_failed",
          "meter",
          dimension.key,
        ),
      ]);
      assertProduct(product, dimension, manifest, config.keyMode);
      assertMeter(meter, meterId, dimension, config.keyMode);
      return { dimension: dimension.key, meterId } as const;
    }),
  );

  if (new Set(checked.map((item) => item.meterId)).size !== checked.length) {
    validationError("catalog_meter_reused", "meter", undefined, "identity");
  }

  const result: StripeCatalogValidationResult = Object.freeze({
    valid: true,
    cached: false,
    checkedAt: new Date(now).toISOString(),
    keyMode: config.keyMode,
    priceBookId: manifest.priceBookId,
    fingerprint: manifest.fingerprint,
    dimensions: Object.freeze(checked.map((item) => item.dimension)),
  });
  if (useCache) {
    pruneCache(now);
    const requestedTtl = options.cacheTtlMs ?? DEFAULT_SUCCESS_CACHE_TTL_MS;
    const cacheTtlMs = Math.max(1, Math.min(requestedTtl, MAX_SUCCESS_CACHE_TTL_MS));
    successfulValidations.set(key, { expiresAt: now + cacheTtlMs, result });
  }
  return result;
}

/** Configuration plus remote-catalog readiness for usage entitlement and metering. */
export async function isStripeUsageRuntimeReady(
  env: StripeBillingEnv = process.env,
  options: AssertConfiguredStripeCatalogOptions = {},
) {
  try {
    const config = requireStripeUsageBillingConfig(env);
    await assertConfiguredStripeCatalog(config, options);
    return true;
  } catch {
    return false;
  }
}

export function clearStripeCatalogValidationCacheForTests() {
  successfulValidations.clear();
}

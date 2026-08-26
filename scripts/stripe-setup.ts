import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";
import {
  createStripeCatalogManifest,
  type StripeCatalogDimension,
  type StripeCatalogDimensionKey,
  type StripeCatalogManifest,
  type StripeCatalogMetadata as CatalogMetadata,
} from "@/lib/billing/catalog-manifest";
import { STRIPE_API_VERSION, type StripeKeyMode } from "@/lib/billing/config";

export { STRIPE_API_VERSION } from "@/lib/billing/config";
export {
  STRIPE_CATALOG_MANIFEST,
  createStripeCatalogManifest,
  type StripeCatalogDimension,
  type StripeCatalogDimensionKey,
  type StripeCatalogManifest,
  type StripeCatalogMetadata,
} from "@/lib/billing/catalog-manifest";

export type CatalogMeterRecord = {
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
};

export type CatalogProductRecord = {
  id: string;
  livemode: boolean;
  active: boolean;
  type: string;
  name: string;
  description: string | null;
  unitLabel: string | null;
  metadata: Record<string, string>;
};

export type CatalogPriceRecord = {
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
  currencyOptions: Record<string, { unitAmountDecimalCents: string | null }> | null;
  recurring: {
    interval: string;
    intervalCount: number;
    usageType: string;
    meterId: string | null;
    trialPeriodDays: number | null;
  } | null;
  taxBehavior: string | null;
  customUnitAmount: unknown;
  tiersMode: string | null;
  transformQuantity: unknown;
  metadata: Record<string, string>;
};

export interface StripeCatalogClient {
  retrieveAccountId(): Promise<string>;
  listMeters(): Promise<readonly CatalogMeterRecord[]>;
  createMeter(
    dimension: StripeCatalogDimension,
    idempotencyKey: string,
  ): Promise<CatalogMeterRecord>;
  updateMeter(
    meterId: string,
    dimension: StripeCatalogDimension,
  ): Promise<CatalogMeterRecord>;
  getProduct(productId: string): Promise<CatalogProductRecord | null>;
  createProduct(
    dimension: StripeCatalogDimension,
    idempotencyKey: string,
  ): Promise<CatalogProductRecord>;
  updateProduct(
    productId: string,
    dimension: StripeCatalogDimension,
    currentMetadata: Readonly<Record<string, string>>,
  ): Promise<CatalogProductRecord>;
  listPrices(lookupKey: string): Promise<readonly CatalogPriceRecord[]>;
  createPrice(
    dimension: StripeCatalogDimension,
    meterId: string,
    idempotencyKey: string,
  ): Promise<CatalogPriceRecord>;
}

export type CatalogAction = {
  dimension: StripeCatalogDimensionKey;
  resource: "meter" | "product" | "price";
  action: "create" | "update" | "unchanged";
  id: string;
};

export type StripeCatalogResult = {
  applied: boolean;
  priceBookId: string;
  fingerprint: string;
  actions: readonly CatalogAction[];
  priceEnvironment: Readonly<Record<string, string>>;
};

export class StripeCatalogDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeCatalogDriftError";
  }
}

export function assertTestStripeKey(value: string | undefined) {
  const key = value?.trim();
  if (!key) {
    throw new Error("STRIPE_TEST_SECRET_KEY is required to inspect or apply the test catalog.");
  }
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    throw new Error("Refusing to use a live Stripe key. This setup command is test-mode only.");
  }
  if (
    !key.startsWith("sk_test_") &&
    !key.startsWith("rk_test_") &&
    !key.startsWith("rkcs_test_")
  ) {
    throw new Error("STRIPE_TEST_SECRET_KEY must be a Stripe test or sandbox key.");
  }
  return key;
}

export function assertStripeCatalogAccountId(value: string | undefined) {
  const accountId = value?.trim();
  if (!accountId?.startsWith("acct_")) {
    throw new Error("STRIPE_ACCOUNT_ID must be the exact Stripe acct_ ID.");
  }
  return accountId;
}

async function assertStripeCatalogAccount(
  client: Pick<StripeCatalogClient, "retrieveAccountId">,
  expectedAccountId: string,
) {
  let actualAccountId: string;
  try {
    actualAccountId = (await client.retrieveAccountId()).trim();
  } catch {
    throw new Error("Could not verify the Stripe account identity.");
  }
  if (actualAccountId !== assertStripeCatalogAccountId(expectedAccountId)) {
    throw new Error(
      "Stripe account mismatch. Refusing to inspect or mutate catalog resources.",
    );
  }
}

function assertResourceMode(
  resource: { id: string; livemode: boolean },
  label: string,
  keyMode: StripeKeyMode,
) {
  const expectedLiveMode = keyMode === "live";
  if (resource.livemode !== expectedLiveMode) {
    throw new Error(
      `Refusing ${label} ${resource.id}: Stripe returned a ${resource.livemode ? "live" : "test"}-mode resource during ${keyMode}-mode provisioning.`,
    );
  }
}

function drift(resource: string, field: string, expected: unknown, actual: unknown): never {
  throw new StripeCatalogDriftError(
    `${resource} has incompatible ${field}; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}. Bump the price-book version instead of mutating this catalog.`,
  );
}

function requireEqual(resource: string, field: string, expected: unknown, actual: unknown) {
  if (actual !== expected) drift(resource, field, expected, actual);
}

function metadataMatches(actual: Record<string, string>, expected: CatalogMetadata) {
  const actualEntries = Object.entries(actual).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function metadataMismatchKeys(
  actual: Readonly<Record<string, string>>,
  expected: CatalogMetadata,
) {
  return [...new Set([...Object.keys(actual), ...Object.keys(expected)])]
    .filter((key) => actual[key] !== expected[key as keyof CatalogMetadata])
    .sort();
}

function metadataDrift(
  resource: string,
  actual: Readonly<Record<string, string>>,
  expected: CatalogMetadata,
): never {
  const keys = metadataMismatchKeys(actual, expected).join(", ") || "unknown";
  throw new StripeCatalogDriftError(
    `${resource} has incompatible metadata keys: ${keys}. Bump the price-book version instead of mutating this catalog.`,
  );
}

function assertIdentityMetadata(
  resource: string,
  actual: Record<string, string>,
  expected: CatalogMetadata,
) {
  for (const key of ["habla_catalog", "price_book_id", "dimension"] as const) {
    const value = actual[key];
    if (value !== undefined && value !== expected[key]) {
      metadataDrift(resource, actual, expected);
    }
  }
}

function assertMeterImmutable(
  meter: CatalogMeterRecord,
  dimension: StripeCatalogDimension,
  keyMode: StripeKeyMode,
) {
  const resource = `meter ${meter.id}`;
  assertResourceMode(meter, "meter", keyMode);
  requireEqual(resource, "event_name", dimension.meterEventName, meter.eventName);
  requireEqual(resource, "status", "active", meter.status);
  requireEqual(resource, "aggregation", "sum", meter.aggregationFormula);
  requireEqual(resource, "customer mapping", "by_id", meter.customerMappingType);
  requireEqual(resource, "customer payload key", "stripe_customer_id", meter.customerPayloadKey);
  requireEqual(resource, "value payload key", "value", meter.valuePayloadKey);
  requireEqual(resource, "event time window", null, meter.eventTimeWindow);
}

function productNeedsUpdate(
  product: CatalogProductRecord,
  dimension: StripeCatalogDimension,
  keyMode: StripeKeyMode,
) {
  assertResourceMode(product, "product", keyMode);
  assertIdentityMetadata(`product ${product.id}`, product.metadata, dimension.metadata);
  requireEqual(`product ${product.id}`, "type", "service", product.type);
  return (
    !product.active ||
    product.name !== dimension.productName ||
    product.description !== dimension.productDescription ||
    product.unitLabel !== dimension.productUnitLabel ||
    !metadataMatches(product.metadata, dimension.metadata)
  );
}

function assertPriceImmutable(
  price: CatalogPriceRecord,
  dimension: StripeCatalogDimension,
  meterId: string,
  keyMode: StripeKeyMode,
) {
  const resource = `price ${price.id}`;
  assertResourceMode(price, "price", keyMode);
  if (!metadataMatches(price.metadata, dimension.metadata)) {
    metadataDrift(resource, price.metadata, dimension.metadata);
  }
  requireEqual(resource, "active", true, price.active);
  requireEqual(resource, "lookup_key", dimension.priceLookupKey, price.lookupKey);
  requireEqual(resource, "nickname", dimension.priceNickname, price.nickname);
  requireEqual(resource, "currency", "usd", price.currency);
  if (
    price.currencyOptions === null ||
    Object.keys(price.currencyOptions).some((currency) => currency !== "usd")
  ) {
    drift(resource, "currency_options", "USD only", price.currencyOptions);
  }
  requireEqual(resource, "billing_scheme", "per_unit", price.billingScheme);
  requireEqual(resource, "type", "recurring", price.type);
  requireEqual(resource, "product", dimension.productId, price.productId);
  requireEqual(resource, "recurring.interval", "month", price.recurring?.interval);
  requireEqual(resource, "recurring.interval_count", 1, price.recurring?.intervalCount);
  requireEqual(resource, "recurring.usage_type", "metered", price.recurring?.usageType);
  requireEqual(resource, "recurring.meter", meterId, price.recurring?.meterId);
  requireEqual(resource, "recurring.trial_period_days", null, price.recurring?.trialPeriodDays);
  requireEqual(resource, "tax_behavior", "unspecified", price.taxBehavior ?? "unspecified");
  requireEqual(resource, "custom_unit_amount", null, price.customUnitAmount);
  requireEqual(resource, "tiers_mode", null, price.tiersMode);
  requireEqual(resource, "transform_quantity", null, price.transformQuantity);

  if (price.unitAmountDecimalCents === null) {
    drift(resource, "unit_amount_decimal", dimension.unitAmountDecimalCents, null);
  }
  const actualAmount = Stripe.Decimal.from(price.unitAmountDecimalCents);
  const expectedAmount = Stripe.Decimal.from(dimension.unitAmountDecimalCents);
  if (!actualAmount.eq(expectedAmount)) {
    drift(
      resource,
      "unit_amount_decimal",
      dimension.unitAmountDecimalCents,
      price.unitAmountDecimalCents,
    );
  }
  const usdOption = price.currencyOptions.usd;
  if (
    usdOption?.unitAmountDecimalCents !== undefined &&
    (usdOption.unitAmountDecimalCents === null ||
      !Stripe.Decimal.from(usdOption.unitAmountDecimalCents).eq(expectedAmount))
  ) {
    drift(
      resource,
      "currency_options.usd.unit_amount_decimal",
      dimension.unitAmountDecimalCents,
      usdOption.unitAmountDecimalCents,
    );
  }
}

function operationKey(
  manifest: StripeCatalogManifest,
  resource: "meter" | "product" | "price",
  identity: string,
  keyMode: StripeKeyMode,
) {
  const modeNamespace = keyMode === "live" ? "live:" : "";
  return `habla:${modeNamespace}${manifest.priceBookId}:${resource}:${identity}:${manifest.fingerprint.slice(0, 16)}`;
}

export async function reconcileStripeCatalog(
  client: StripeCatalogClient,
  options: {
    apply: boolean;
    accountId: string;
    keyMode: StripeKeyMode;
    allowLiveProvisioning?: boolean;
    manifest?: StripeCatalogManifest;
  },
): Promise<StripeCatalogResult> {
  if (options.keyMode === "live" && options.allowLiveProvisioning !== true) {
    throw new Error("Refusing to provision a live Stripe catalog without explicit authorization.");
  }
  await assertStripeCatalogAccount(client, options.accountId);
  const manifest = options.manifest ?? createStripeCatalogManifest();
  const actions: CatalogAction[] = [];
  const priceEnvironment: Record<string, string> = {};
  const allMeters = await client.listMeters();
  for (const meter of allMeters) assertResourceMode(meter, "meter", options.keyMode);

  for (const dimension of manifest.dimensions) {
    const meterMatches = allMeters.filter((meter) => meter.eventName === dimension.meterEventName);
    if (meterMatches.length > 1) {
      throw new StripeCatalogDriftError(
        `Multiple Stripe meters use event_name ${dimension.meterEventName}; refusing to guess.`,
      );
    }

    let meter = meterMatches[0];
    if (!meter) {
      actions.push({
        dimension: dimension.key,
        resource: "meter",
        action: "create",
        id: `<${dimension.meterEventName}>`,
      });
      if (options.apply) {
        meter = await client.createMeter(
          dimension,
          operationKey(
            manifest,
            "meter",
            dimension.meterEventName,
            options.keyMode,
          ),
        );
        assertMeterImmutable(meter, dimension, options.keyMode);
        requireEqual(
          `meter ${meter.id}`,
          "display_name",
          dimension.meterDisplayName,
          meter.displayName,
        );
        actions[actions.length - 1] = { ...actions[actions.length - 1], id: meter.id };
      }
    } else {
      assertMeterImmutable(meter, dimension, options.keyMode);
      if (meter.displayName !== dimension.meterDisplayName) {
        actions.push({
          dimension: dimension.key,
          resource: "meter",
          action: "update",
          id: meter.id,
        });
        if (options.apply) {
          meter = await client.updateMeter(meter.id, dimension);
          assertMeterImmutable(meter, dimension, options.keyMode);
          requireEqual(
            `meter ${meter.id}`,
            "display_name",
            dimension.meterDisplayName,
            meter.displayName,
          );
        }
      } else {
        actions.push({
          dimension: dimension.key,
          resource: "meter",
          action: "unchanged",
          id: meter.id,
        });
      }
    }

    let product = await client.getProduct(dimension.productId);
    if (!product) {
      actions.push({
        dimension: dimension.key,
        resource: "product",
        action: "create",
        id: dimension.productId,
      });
      if (options.apply) {
        product = await client.createProduct(
          dimension,
          operationKey(manifest, "product", dimension.productId, options.keyMode),
        );
        assertResourceMode(product, "product", options.keyMode);
        if (productNeedsUpdate(product, dimension, options.keyMode)) {
          throw new Error(`Stripe created product ${product.id} with unexpected fields.`);
        }
      }
    } else if (productNeedsUpdate(product, dimension, options.keyMode)) {
      actions.push({
        dimension: dimension.key,
        resource: "product",
        action: "update",
        id: product.id,
      });
      if (options.apply) {
        product = await client.updateProduct(product.id, dimension, product.metadata);
        if (productNeedsUpdate(product, dimension, options.keyMode)) {
          throw new Error(`Stripe updated product ${product.id} with unexpected fields.`);
        }
      }
    } else {
      actions.push({
        dimension: dimension.key,
        resource: "product",
        action: "unchanged",
        id: product.id,
      });
    }

    const prices = await client.listPrices(dimension.priceLookupKey);
    for (const candidate of prices) {
      assertResourceMode(candidate, "price", options.keyMode);
    }
    if (prices.length > 1) {
      throw new StripeCatalogDriftError(
        `Multiple Stripe prices use lookup_key ${dimension.priceLookupKey}; refusing to guess.`,
      );
    }

    let price = prices[0];
    if (!price) {
      actions.push({
        dimension: dimension.key,
        resource: "price",
        action: "create",
        id: `<${dimension.priceLookupKey}>`,
      });
      if (options.apply) {
        if (!meter) throw new Error(`Cannot create ${dimension.key} price without its Stripe meter.`);
        price = await client.createPrice(
          dimension,
          meter.id,
          operationKey(
            manifest,
            "price",
            dimension.priceLookupKey,
            options.keyMode,
          ),
        );
        assertPriceImmutable(price, dimension, meter.id, options.keyMode);
        actions[actions.length - 1] = { ...actions[actions.length - 1], id: price.id };
      }
    } else {
      if (!meter) {
        throw new StripeCatalogDriftError(
          `Price ${price.id} exists but meter ${dimension.meterEventName} is missing.`,
        );
      }
      assertPriceImmutable(price, dimension, meter.id, options.keyMode);
      actions.push({
        dimension: dimension.key,
        resource: "price",
        action: "unchanged",
        id: price.id,
      });
    }

    priceEnvironment[dimension.priceEnvironmentVariable] =
      price?.id ?? `<created by --apply for ${dimension.priceLookupKey}>`;
  }

  return Object.freeze({
    applied: options.apply,
    priceBookId: manifest.priceBookId,
    fingerprint: manifest.fingerprint,
    actions: Object.freeze(actions),
    priceEnvironment: Object.freeze(priceEnvironment),
  });
}

function isMissingStripeResource(error: unknown) {
  return error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing";
}

function normalizeMeter(meter: Stripe.Billing.Meter): CatalogMeterRecord {
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

function normalizeProduct(product: Stripe.Product): CatalogProductRecord {
  return {
    id: product.id,
    livemode: product.livemode,
    active: product.active,
    type: product.type,
    name: product.name,
    description: product.description,
    unitLabel: product.unit_label ?? null,
    metadata: { ...product.metadata },
  };
}

function normalizePrice(price: Stripe.Price): CatalogPriceRecord {
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
      ? Object.fromEntries(
          Object.entries(price.currency_options).map(([currency, option]) => [
            currency,
            { unitAmountDecimalCents: option.unit_amount_decimal?.toString() ?? null },
          ]),
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

export class StripeSdkCatalogClient implements StripeCatalogClient {
  constructor(private readonly stripe: Stripe) {}

  async retrieveAccountId() {
    return (await this.stripe.accounts.retrieve(null)).id;
  }

  async listMeters() {
    const found: CatalogMeterRecord[] = [];
    for (const status of ["active", "inactive"] as const) {
      for await (const meter of this.stripe.billing.meters.list({ limit: 100, status })) {
        found.push(normalizeMeter(meter));
      }
    }
    return found;
  }

  async createMeter(dimension: StripeCatalogDimension, idempotencyKey: string) {
    const meter = await this.stripe.billing.meters.create(
      {
        display_name: dimension.meterDisplayName,
        event_name: dimension.meterEventName,
        default_aggregation: { formula: "sum" },
        customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
        value_settings: { event_payload_key: "value" },
      },
      { idempotencyKey },
    );
    return normalizeMeter(meter);
  }

  async updateMeter(meterId: string, dimension: StripeCatalogDimension) {
    return normalizeMeter(
      await this.stripe.billing.meters.update(meterId, {
        display_name: dimension.meterDisplayName,
      }),
    );
  }

  async getProduct(productId: string) {
    try {
      return normalizeProduct(await this.stripe.products.retrieve(productId));
    } catch (error) {
      if (isMissingStripeResource(error)) return null;
      throw error;
    }
  }

  async createProduct(dimension: StripeCatalogDimension, idempotencyKey: string) {
    return normalizeProduct(
      await this.stripe.products.create(
        {
          id: dimension.productId,
          name: dimension.productName,
          description: dimension.productDescription,
          unit_label: dimension.productUnitLabel,
          metadata: { ...dimension.metadata },
        },
        { idempotencyKey },
      ),
    );
  }

  async updateProduct(
    productId: string,
    dimension: StripeCatalogDimension,
    currentMetadata: Readonly<Record<string, string>>,
  ) {
    const metadata: Stripe.MetadataParam = Object.fromEntries(
      Object.keys(currentMetadata).map((key) => [key, null]),
    );
    Object.assign(metadata, dimension.metadata);
    return normalizeProduct(
      await this.stripe.products.update(productId, {
        active: true,
        name: dimension.productName,
        description: dimension.productDescription,
        unit_label: dimension.productUnitLabel,
        metadata,
      }),
    );
  }

  async listPrices(lookupKey: string) {
    const found = new Map<string, CatalogPriceRecord>();
    for (const active of [true, false] as const) {
      for await (const price of this.stripe.prices.list({
        active,
        expand: ["data.currency_options"],
        lookup_keys: [lookupKey],
        limit: 100,
      })) {
        found.set(price.id, normalizePrice(price));
      }
    }
    return [...found.values()];
  }

  async createPrice(
    dimension: StripeCatalogDimension,
    meterId: string,
    idempotencyKey: string,
  ) {
    return normalizePrice(
      await this.stripe.prices.create(
        {
          active: true,
          billing_scheme: "per_unit",
          currency: "usd",
          expand: ["currency_options"],
          lookup_key: dimension.priceLookupKey,
          metadata: { ...dimension.metadata },
          nickname: dimension.priceNickname,
          product: dimension.productId,
          recurring: {
            interval: "month",
            meter: meterId,
            usage_type: "metered",
          },
          tax_behavior: "unspecified",
          unit_amount_decimal: Stripe.Decimal.from(dimension.unitAmountDecimalCents),
        },
        { idempotencyKey },
      ),
    );
  }
}

function printResult(result: StripeCatalogResult) {
  console.log(`Stripe test catalog ${result.applied ? "apply" : "dry-run"}`);
  console.log(`Price book: ${result.priceBookId}`);
  console.log(`Fingerprint: ${result.fingerprint}`);
  console.log("");
  for (const action of result.actions) {
    const verb = action.action === "unchanged" ? "unchanged" : result.applied ? action.action : `would ${action.action}`;
    console.log(`- ${action.dimension} ${action.resource}: ${verb} (${action.id})`);
  }
  console.log("\nRequired price environment variables:");
  for (const [name, value] of Object.entries(result.priceEnvironment)) {
    console.log(`${name}=${value}`);
  }
  if (!result.applied) {
    console.log("\nNo Stripe resources were changed. Re-run with --apply to create or update test resources.");
  }
}

function printHelp() {
  console.log(`Usage: npx tsx scripts/stripe-setup.ts [--apply]

Reconciles the Habla teacher AI catalog in Stripe test/sandbox mode.
The command is a read-only dry-run unless --apply is present.

Environment:
  STRIPE_TEST_SECRET_KEY   Required sk_test_, rk_test_, or rkcs_test_ key.
  STRIPE_ACCOUNT_ID        Required exact acct_ ID for the same sandbox.
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    printHelp();
    return;
  }

  loadEnvConfig(process.cwd());
  const key = assertTestStripeKey(process.env.STRIPE_TEST_SECRET_KEY);
  const accountId = assertStripeCatalogAccountId(process.env.STRIPE_ACCOUNT_ID);
  const stripe = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "habla-stripe-catalog", version: "1" },
    maxNetworkRetries: 2,
    telemetry: false,
    timeout: 30_000,
  });
  const result = await reconcileStripeCatalog(new StripeSdkCatalogClient(stripe), {
    apply: values.apply,
    accountId,
    keyMode: "test",
  });
  printResult(result);
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

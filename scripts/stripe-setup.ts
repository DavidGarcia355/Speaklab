import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";
import {
  TEACHER_AI_PRICE_BOOK,
  type TeacherAiPriceBook,
} from "@/lib/teacher-ai-pricing";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export type StripeCatalogDimensionKey =
  | "successful_grade"
  | "audio_second"
  | "feedback_token";

type CatalogMetadata = Readonly<Record<string, string>>;

export type StripeCatalogDimension = {
  key: StripeCatalogDimensionKey;
  meterDisplayName: string;
  meterEventName: string;
  billingUnit: "grade" | "second" | "token";
  productId: string;
  productName: string;
  productDescription: string;
  productUnitLabel: string;
  priceLookupKey: string;
  priceNickname: string;
  priceEnvironmentVariable: string;
  unitAmountDecimalCents: string;
  metadata: CatalogMetadata;
};

export type StripeCatalogManifest = {
  schemaVersion: 1;
  apiVersion: typeof STRIPE_API_VERSION;
  priceBookId: string;
  priceBookStatus: TeacherAiPriceBook["status"];
  currency: "usd";
  publishedAt: string;
  effectiveAt: string | null;
  fingerprint: string;
  dimensions: readonly StripeCatalogDimension[];
};

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
  currency: string;
  billingScheme: string;
  type: string;
  productId: string;
  unitAmountDecimalCents: string | null;
  recurring: {
    interval: string;
    intervalCount: number;
    usageType: string;
    meterId: string | null;
  } | null;
  taxBehavior: string | null;
  transformQuantity: unknown;
  metadata: Record<string, string>;
};

export interface StripeCatalogClient {
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

const HUNDRED = Stripe.Decimal.from("100");
const SIXTY = Stripe.Decimal.from("60");
const THOUSAND = Stripe.Decimal.from("1000");

function usdToCents(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite USD amount.`);
  }
  return Stripe.Decimal.from(value.toString()).mul(HUNDRED);
}

function productToken(priceBookId: string) {
  const token = priceBookId.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!token) throw new Error("The teacher AI price book ID cannot produce a Stripe identifier.");
  return token;
}

function catalogFingerprint(
  priceBook: TeacherAiPriceBook,
  dimensions: readonly Omit<StripeCatalogDimension, "metadata">[],
) {
  const contract = {
    schemaVersion: 1,
    priceBook: {
      id: priceBook.id,
      currency: priceBook.currency,
      status: priceBook.status,
      publishedAt: priceBook.publishedAt,
      effectiveAt: priceBook.effectiveAt,
      baseSuccessfulGradeUsd: priceBook.baseSuccessfulGradeUsd,
      audioMinuteUsd: priceBook.audioMinuteUsd,
      outputThousandTokensUsd: priceBook.outputThousandTokensUsd,
      freeCreditPolicy: priceBook.freeCreditPolicy,
    },
    dimensions: dimensions.map((dimension) => ({
      key: dimension.key,
      meterEventName: dimension.meterEventName,
      billingUnit: dimension.billingUnit,
      productId: dimension.productId,
      priceLookupKey: dimension.priceLookupKey,
      unitAmountDecimalCents: dimension.unitAmountDecimalCents,
    })),
  };
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

export function createStripeCatalogManifest(
  priceBook: TeacherAiPriceBook = TEACHER_AI_PRICE_BOOK,
): StripeCatalogManifest {
  if (priceBook.currency !== "USD") {
    throw new Error(`Stripe teacher AI setup supports USD only, received ${priceBook.currency}.`);
  }
  if (!priceBook.id.trim()) throw new Error("The teacher AI price book ID is required.");

  const token = productToken(priceBook.id);
  const successfulGradeCents = usdToCents(
    priceBook.baseSuccessfulGradeUsd,
    "baseSuccessfulGradeUsd",
  );
  const audioSecondCents = usdToCents(priceBook.audioMinuteUsd, "audioMinuteUsd").div(
    SIXTY,
    12,
    "half-up",
  );
  const feedbackTokenCents = usdToCents(
    priceBook.outputThousandTokensUsd,
    "outputThousandTokensUsd",
  ).div(THOUSAND, 12, "half-up");

  const dimensionsWithoutMetadata: readonly Omit<StripeCatalogDimension, "metadata">[] = [
    {
      key: "successful_grade",
      meterDisplayName: "Habla successful AI grades",
      meterEventName: "habla_ai_successful_grade",
      billingUnit: "grade",
      productId: `${token}_successful_grade`,
      productName: "Habla AI successful grades",
      productDescription: "Successful, unique AI grading results for Habla teachers.",
      productUnitLabel: "grade",
      priceLookupKey: `${token}_successful_grade_monthly`,
      priceNickname: `${priceBook.id}: successful grade`,
      priceEnvironmentVariable: "STRIPE_AI_GRADE_PRICE_ID",
      unitAmountDecimalCents: successfulGradeCents.toString(),
    },
    {
      key: "audio_second",
      meterDisplayName: "Habla processed AI audio seconds",
      meterEventName: "habla_ai_audio_seconds",
      billingUnit: "second",
      productId: `${token}_audio_second`,
      productName: "Habla AI processed audio",
      productDescription:
        "Processed audio for Habla AI grading, billed by second at the published per-minute rate.",
      productUnitLabel: "second",
      priceLookupKey: `${token}_audio_second_monthly`,
      priceNickname: `${priceBook.id}: audio second`,
      priceEnvironmentVariable: "STRIPE_AI_AUDIO_SECONDS_PRICE_ID",
      unitAmountDecimalCents: audioSecondCents.toString(),
    },
    {
      key: "feedback_token",
      meterDisplayName: "Habla AI feedback tokens",
      meterEventName: "habla_ai_feedback_tokens",
      billingUnit: "token",
      productId: `${token}_feedback_token`,
      productName: "Habla AI feedback tokens",
      productDescription:
        "Final feedback output tokens for Habla AI grading, published per 1,000 tokens.",
      productUnitLabel: "token",
      priceLookupKey: `${token}_feedback_token_monthly`,
      priceNickname: `${priceBook.id}: feedback token`,
      priceEnvironmentVariable: "STRIPE_AI_FEEDBACK_TOKENS_PRICE_ID",
      unitAmountDecimalCents: feedbackTokenCents.toString(),
    },
  ];

  const fingerprint = catalogFingerprint(priceBook, dimensionsWithoutMetadata);
  const dimensions = dimensionsWithoutMetadata.map((dimension) => ({
    ...dimension,
    metadata: Object.freeze({
      habla_catalog: "teacher_ai",
      catalog_schema_version: "1",
      catalog_fingerprint: fingerprint,
      price_book_id: priceBook.id,
      price_book_status: priceBook.status,
      published_at: priceBook.publishedAt,
      effective_at: priceBook.effectiveAt ?? "pending",
      dimension: dimension.key,
      billing_unit: dimension.billingUnit,
      unit_amount_decimal_cents: dimension.unitAmountDecimalCents,
    }),
  }));

  return Object.freeze({
    schemaVersion: 1,
    apiVersion: STRIPE_API_VERSION,
    priceBookId: priceBook.id,
    priceBookStatus: priceBook.status,
    currency: "usd",
    publishedAt: priceBook.publishedAt,
    effectiveAt: priceBook.effectiveAt,
    fingerprint,
    dimensions: Object.freeze(dimensions),
  });
}

export function assertTestStripeKey(value: string | undefined) {
  const key = value?.trim();
  if (!key) {
    throw new Error("STRIPE_TEST_SECRET_KEY is required to inspect or apply the test catalog.");
  }
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    throw new Error("Refusing to use a live Stripe key. This setup command is test-mode only.");
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error("STRIPE_TEST_SECRET_KEY must be a Stripe test or sandbox key.");
  }
  return key;
}

function assertTestResource(resource: { id: string; livemode: boolean }, label: string) {
  if (resource.livemode !== false) {
    throw new Error(`Refusing ${label} ${resource.id}: Stripe returned a live-mode resource.`);
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
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function assertIdentityMetadata(
  resource: string,
  actual: Record<string, string>,
  expected: CatalogMetadata,
) {
  for (const key of ["habla_catalog", "price_book_id", "dimension"] as const) {
    const value = actual[key];
    if (value !== undefined && value !== expected[key]) {
      drift(resource, `metadata.${key}`, expected[key], value);
    }
  }
}

function assertMeterImmutable(meter: CatalogMeterRecord, dimension: StripeCatalogDimension) {
  const resource = `meter ${meter.id}`;
  assertTestResource(meter, "meter");
  requireEqual(resource, "event_name", dimension.meterEventName, meter.eventName);
  requireEqual(resource, "status", "active", meter.status);
  requireEqual(resource, "aggregation", "sum", meter.aggregationFormula);
  requireEqual(resource, "customer mapping", "by_id", meter.customerMappingType);
  requireEqual(resource, "customer payload key", "stripe_customer_id", meter.customerPayloadKey);
  requireEqual(resource, "value payload key", "value", meter.valuePayloadKey);
  requireEqual(resource, "event time window", null, meter.eventTimeWindow);
}

function productNeedsUpdate(product: CatalogProductRecord, dimension: StripeCatalogDimension) {
  assertTestResource(product, "product");
  assertIdentityMetadata(`product ${product.id}`, product.metadata, dimension.metadata);
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
) {
  const resource = `price ${price.id}`;
  assertTestResource(price, "price");
  if (!metadataMatches(price.metadata, dimension.metadata)) {
    drift(resource, "metadata", dimension.metadata, price.metadata);
  }
  requireEqual(resource, "active", true, price.active);
  requireEqual(resource, "lookup_key", dimension.priceLookupKey, price.lookupKey);
  requireEqual(resource, "currency", "usd", price.currency);
  requireEqual(resource, "billing_scheme", "per_unit", price.billingScheme);
  requireEqual(resource, "type", "recurring", price.type);
  requireEqual(resource, "product", dimension.productId, price.productId);
  requireEqual(resource, "recurring.interval", "month", price.recurring?.interval);
  requireEqual(resource, "recurring.interval_count", 1, price.recurring?.intervalCount);
  requireEqual(resource, "recurring.usage_type", "metered", price.recurring?.usageType);
  requireEqual(resource, "recurring.meter", meterId, price.recurring?.meterId);
  requireEqual(resource, "tax_behavior", "unspecified", price.taxBehavior ?? "unspecified");
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
}

function operationKey(
  manifest: StripeCatalogManifest,
  resource: "meter" | "product" | "price",
  identity: string,
) {
  return `habla:${manifest.priceBookId}:${resource}:${identity}:${manifest.fingerprint.slice(0, 16)}`;
}

export async function reconcileStripeCatalog(
  client: StripeCatalogClient,
  options: { apply: boolean; manifest?: StripeCatalogManifest },
): Promise<StripeCatalogResult> {
  const manifest = options.manifest ?? createStripeCatalogManifest();
  const actions: CatalogAction[] = [];
  const priceEnvironment: Record<string, string> = {};
  const allMeters = await client.listMeters();
  for (const meter of allMeters) assertTestResource(meter, "meter");

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
          operationKey(manifest, "meter", dimension.meterEventName),
        );
        assertMeterImmutable(meter, dimension);
        actions[actions.length - 1] = { ...actions[actions.length - 1], id: meter.id };
      }
    } else {
      assertMeterImmutable(meter, dimension);
      if (meter.displayName !== dimension.meterDisplayName) {
        actions.push({
          dimension: dimension.key,
          resource: "meter",
          action: "update",
          id: meter.id,
        });
        if (options.apply) {
          meter = await client.updateMeter(meter.id, dimension);
          assertMeterImmutable(meter, dimension);
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
          operationKey(manifest, "product", dimension.productId),
        );
        assertTestResource(product, "product");
        if (productNeedsUpdate(product, dimension)) {
          throw new Error(`Stripe created product ${product.id} with unexpected fields.`);
        }
      }
    } else if (productNeedsUpdate(product, dimension)) {
      actions.push({
        dimension: dimension.key,
        resource: "product",
        action: "update",
        id: product.id,
      });
      if (options.apply) {
        product = await client.updateProduct(product.id, dimension);
        if (productNeedsUpdate(product, dimension)) {
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
    for (const candidate of prices) assertTestResource(candidate, "price");
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
          operationKey(manifest, "price", dimension.priceLookupKey),
        );
        assertPriceImmutable(price, dimension, meter.id);
        actions[actions.length - 1] = { ...actions[actions.length - 1], id: price.id };
      }
    } else {
      if (!meter) {
        throw new StripeCatalogDriftError(
          `Price ${price.id} exists but meter ${dimension.meterEventName} is missing.`,
        );
      }
      assertPriceImmutable(price, dimension, meter.id);
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
    currency: price.currency,
    billingScheme: price.billing_scheme,
    type: price.type,
    productId: typeof price.product === "string" ? price.product : price.product.id,
    unitAmountDecimalCents: price.unit_amount_decimal?.toString() ?? null,
    recurring: price.recurring
      ? {
          interval: price.recurring.interval,
          intervalCount: price.recurring.interval_count,
          usageType: price.recurring.usage_type,
          meterId: price.recurring.meter,
        }
      : null,
    taxBehavior: price.tax_behavior,
    transformQuantity: price.transform_quantity,
    metadata: { ...price.metadata },
  };
}

export class StripeSdkCatalogClient implements StripeCatalogClient {
  constructor(private readonly stripe: Stripe) {}

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

  async updateProduct(productId: string, dimension: StripeCatalogDimension) {
    return normalizeProduct(
      await this.stripe.products.update(productId, {
        active: true,
        name: dimension.productName,
        description: dimension.productDescription,
        unit_label: dimension.productUnitLabel,
        metadata: { ...dimension.metadata },
      }),
    );
  }

  async listPrices(lookupKey: string) {
    const found = new Map<string, CatalogPriceRecord>();
    for (const active of [true, false] as const) {
      for await (const price of this.stripe.prices.list({
        active,
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
  STRIPE_TEST_SECRET_KEY   Required sk_test_ or rk_test_ key.
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
  const stripe = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "habla-stripe-catalog", version: "1" },
    maxNetworkRetries: 2,
    telemetry: false,
    timeout: 30_000,
  });
  const result = await reconcileStripeCatalog(new StripeSdkCatalogClient(stripe), {
    apply: values.apply,
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

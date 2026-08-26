import { beforeEach, describe, expect, it } from "vitest";
import {
  STRIPE_CATALOG_MANIFEST,
  StripeCatalogValidationError,
  assertConfiguredStripeCatalog,
  clearStripeAccountValidationCacheForTests,
  clearStripeCatalogValidationCacheForTests,
  isStripeUsageRuntimeReady,
  requireStripeUsageBillingConfig,
  type StripeCatalogDimensionKey,
  type StripeCatalogReadClient,
  type StripeCatalogReadMeter,
  type StripeCatalogReadPrice,
  type StripeCatalogReadProduct,
} from "@/lib/billing";

const ENV = {
  NODE_ENV: "test",
  STRIPE_USAGE_BILLING_ENABLED: "true",
  CRON_SECRET: "test-cron-secret",
  STRIPE_SECRET_KEY: "rkcs_test_catalog",
  STRIPE_WEBHOOK_SECRET: "whsec_catalog",
  STRIPE_ACCOUNT_ID: "acct_habla_test",
  STRIPE_AI_GRADE_PRICE_ID: "price_successful_grade",
  STRIPE_AI_AUDIO_SECONDS_PRICE_ID: "price_audio_second",
};

const config = requireStripeUsageBillingConfig(ENV);

function priceId(dimension: StripeCatalogDimensionKey) {
  return dimension === "successful_grade"
    ? ENV.STRIPE_AI_GRADE_PRICE_ID
    : ENV.STRIPE_AI_AUDIO_SECONDS_PRICE_ID;
}

class FakeReadClient implements StripeCatalogReadClient {
  readonly prices = new Map<string, StripeCatalogReadPrice>();
  readonly products = new Map<string, StripeCatalogReadProduct>();
  readonly meters = new Map<string, StripeCatalogReadMeter>();
  accountId = ENV.STRIPE_ACCOUNT_ID;
  reads = 0;

  constructor() {
    for (const dimension of STRIPE_CATALOG_MANIFEST.dimensions) {
      const meterId = `mtr_${dimension.key}`;
      const configuredPriceId = priceId(dimension.key);
      this.prices.set(configuredPriceId, {
        id: configuredPriceId,
        livemode: false,
        active: true,
        lookupKey: dimension.priceLookupKey,
        nickname: dimension.priceNickname,
        currency: "usd",
        billingScheme: "per_unit",
        type: "recurring",
        productId: dimension.productId,
        unitAmountDecimalCents: dimension.unitAmountDecimalCents,
        currencyOptions: {},
        recurring: {
          interval: "month",
          intervalCount: 1,
          usageType: "metered",
          meterId,
          trialPeriodDays: null,
        },
        taxBehavior: "unspecified",
        customUnitAmount: null,
        tiersMode: null,
        transformQuantity: null,
        metadata: { ...dimension.metadata },
      });
      this.products.set(dimension.productId, {
        id: dimension.productId,
        livemode: false,
        active: true,
        name: dimension.productName,
        description: dimension.productDescription,
        unitLabel: dimension.productUnitLabel,
        type: "service",
        metadata: { ...dimension.metadata },
      });
      this.meters.set(meterId, {
        id: meterId,
        livemode: false,
        status: "active",
        displayName: dimension.meterDisplayName,
        eventName: dimension.meterEventName,
        aggregationFormula: "sum",
        customerMappingType: "by_id",
        customerPayloadKey: "stripe_customer_id",
        valuePayloadKey: "value",
        eventTimeWindow: null,
      });
    }
  }

  async retrieveAccountId() {
    this.reads += 1;
    return this.accountId;
  }

  async retrievePrice(id: string) {
    this.reads += 1;
    const value = this.prices.get(id);
    if (!value) throw new Error(`missing ${id}`);
    return value;
  }

  async retrieveProduct(id: string) {
    this.reads += 1;
    const value = this.products.get(id);
    if (!value) throw new Error(`missing ${id}`);
    return value;
  }

  async retrieveMeter(id: string) {
    this.reads += 1;
    const value = this.meters.get(id);
    if (!value) throw new Error(`missing ${id}`);
    return value;
  }
}

beforeEach(() => {
  clearStripeAccountValidationCacheForTests();
  clearStripeCatalogValidationCacheForTests();
});

describe("configured Stripe catalog validation", () => {
  it("validates the exact current catalog and caches only successful reads briefly", async () => {
    const client = new FakeReadClient();
    const first = await assertConfiguredStripeCatalog(config, { client, now: () => 1_000 });
    expect(first).toMatchObject({
      valid: true,
      cached: false,
      keyMode: "test",
      priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
      fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
    });
    expect(client.reads).toBe(7);

    const second = await assertConfiguredStripeCatalog(config, { client, now: () => 2_000 });
    expect(second.cached).toBe(true);
    expect(client.reads).toBe(7);
  });

  it("rejects exact rate and fingerprint drift with safe codes and messages", async () => {
    const rateClient = new FakeReadClient();
    const ratePrice = rateClient.prices.get(ENV.STRIPE_AI_GRADE_PRICE_ID)!;
    rateClient.prices.set(ratePrice.id, { ...ratePrice, unitAmountDecimalCents: "6" });
    await expect(
      assertConfiguredStripeCatalog(config, { client: rateClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_price_rate_mismatch" });

    const fingerprintClient = new FakeReadClient();
    const fingerprintPrice = fingerprintClient.prices.get(ENV.STRIPE_AI_GRADE_PRICE_ID)!;
    fingerprintClient.prices.set(fingerprintPrice.id, {
      ...fingerprintPrice,
      metadata: { ...fingerprintPrice.metadata, catalog_fingerprint: "wrong" },
    });
    const failure = await assertConfiguredStripeCatalog(config, {
      client: fingerprintClient,
      cache: false,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StripeCatalogValidationError);
    expect(failure).toMatchObject({ code: "catalog_fingerprint_mismatch" });
    expect((failure as Error).message).not.toContain(ENV.STRIPE_AI_GRADE_PRICE_ID);
  });

  it("requires expanded USD-only currency options and rejects alternate currencies", async () => {
    const unexpandedClient = new FakeReadClient();
    const unexpanded = unexpandedClient.prices.get(ENV.STRIPE_AI_GRADE_PRICE_ID)!;
    unexpandedClient.prices.set(unexpanded.id, { ...unexpanded, currencyOptions: null });
    await expect(
      assertConfiguredStripeCatalog(config, { client: unexpandedClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_price_currency_mismatch" });

    const alternateClient = new FakeReadClient();
    const alternate = alternateClient.prices.get(ENV.STRIPE_AI_GRADE_PRICE_ID)!;
    alternateClient.prices.set(alternate.id, {
      ...alternate,
      currencyOptions: {
        eur: { unitAmountDecimalCents: alternate.unitAmountDecimalCents },
      },
    });
    await expect(
      assertConfiguredStripeCatalog(config, { client: alternateClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_price_currency_mismatch" });

    const wrongUsdClient = new FakeReadClient();
    const wrongUsd = wrongUsdClient.prices.get(ENV.STRIPE_AI_GRADE_PRICE_ID)!;
    wrongUsdClient.prices.set(wrongUsd.id, {
      ...wrongUsd,
      currencyOptions: { usd: { unitAmountDecimalCents: "999" } },
    });
    await expect(
      assertConfiguredStripeCatalog(config, { client: wrongUsdClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_price_rate_mismatch" });
  });

  it("rejects mode, product, and meter contract drift", async () => {
    const modeClient = new FakeReadClient();
    const price = modeClient.prices.get(ENV.STRIPE_AI_GRADE_PRICE_ID)!;
    modeClient.prices.set(price.id, { ...price, livemode: true });
    await expect(
      assertConfiguredStripeCatalog(config, { client: modeClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_price_mode_mismatch" });

    const productClient = new FakeReadClient();
    const dimension = STRIPE_CATALOG_MANIFEST.dimensions[0];
    const product = productClient.products.get(dimension.productId)!;
    productClient.products.set(product.id, { ...product, active: false });
    await expect(
      assertConfiguredStripeCatalog(config, { client: productClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_product_contract_mismatch" });

    const meterClient = new FakeReadClient();
    const meter = meterClient.meters.get(`mtr_${dimension.key}`)!;
    meterClient.meters.set(meter.id, { ...meter, aggregationFormula: "count" });
    await expect(
      assertConfiguredStripeCatalog(config, { client: meterClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_meter_contract_mismatch" });
  });

  it("rejects a credential from any account other than the pinned Stripe account", async () => {
    const client = new FakeReadClient();
    client.accountId = "acct_foreign";

    await expect(
      assertConfiguredStripeCatalog(config, { client, cache: false }),
    ).rejects.toMatchObject({ code: "stripe_account_mismatch" });
    expect(client.reads).toBe(1);
  });

  it("wraps remote failures without leaking resource IDs and never caches them", async () => {
    const client = new FakeReadClient();
    client.prices.delete(ENV.STRIPE_AI_GRADE_PRICE_ID);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failure = await assertConfiguredStripeCatalog(config, { client }).catch(
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ code: "catalog_price_read_failed" });
      expect((failure as Error).message).not.toContain(ENV.STRIPE_AI_GRADE_PRICE_ID);
    }
    expect(client.reads).toBeGreaterThanOrEqual(4);
  });

  it("reports usage runtime readiness only after local and remote validation", async () => {
    await expect(isStripeUsageRuntimeReady(ENV, { client: new FakeReadClient() })).resolves.toBe(
      true,
    );
    await expect(
      isStripeUsageRuntimeReady({ ...ENV, STRIPE_USAGE_BILLING_ENABLED: "false" }, {
        client: new FakeReadClient(),
      }),
    ).resolves.toBe(false);
    const broken = new FakeReadClient();
    broken.prices.delete(ENV.STRIPE_AI_GRADE_PRICE_ID);
    await expect(isStripeUsageRuntimeReady(ENV, { client: broken, cache: false })).resolves.toBe(
      false,
    );
  });
});

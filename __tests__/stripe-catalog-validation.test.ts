import { beforeEach, describe, expect, it } from "vitest";
import {
  STRIPE_CATALOG_MANIFEST,
  assertConfiguredStripeCatalog,
  clearStripeAccountValidationCacheForTests,
  clearStripeCatalogValidationCacheForTests,
  isStripeSubscriptionRuntimeReady,
  isStripeUsageRuntimeReady,
  requireStripeSubscriptionBillingConfig,
  type StripeCatalogReadClient,
  type StripeCatalogReadPrice,
  type StripeCatalogReadProduct,
} from "@/lib/billing";

const ENV = Object.freeze({
  NODE_ENV: "test",
  STRIPE_SUBSCRIPTION_BILLING_ENABLED: "true",
  STRIPE_SECRET_KEY: "rkcs_test_catalog",
  STRIPE_WEBHOOK_SECRET: "whsec_catalog",
  STRIPE_ACCOUNT_ID: "acct_habla_test",
  STRIPE_TRYHABLA_TEACHER_PRICE_ID: "price_teacher_monthly",
  STRIPE_AUTOMATIC_TAX_ENABLED: "false",
});

const config = requireStripeSubscriptionBillingConfig(ENV);
const dimension = STRIPE_CATALOG_MANIFEST.dimensions[0];

class FakeReadClient implements StripeCatalogReadClient {
  readonly prices = new Map<string, StripeCatalogReadPrice>();
  readonly products = new Map<string, StripeCatalogReadProduct>();
  accountId: string = ENV.STRIPE_ACCOUNT_ID;
  reads = 0;

  constructor() {
    this.prices.set(ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID, {
      id: ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID,
      livemode: false,
      active: true,
      lookupKey: dimension.priceLookupKey,
      nickname: dimension.priceNickname,
      currency: "usd",
      billingScheme: "per_unit",
      type: "recurring",
      productId: dimension.productId,
      unitAmountCents: dimension.unitAmountCents,
      unitAmountDecimalCents: String(dimension.unitAmountCents),
      currencyOptions: {
        usd: {
          unitAmountCents: dimension.unitAmountCents,
          unitAmountDecimalCents: String(dimension.unitAmountCents),
        },
      },
      recurring: {
        interval: "month",
        intervalCount: 1,
        usageType: "licensed",
        meterId: null,
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
}

beforeEach(() => {
  clearStripeAccountValidationCacheForTests();
  clearStripeCatalogValidationCacheForTests();
});

describe("configured fixed Stripe catalog validation", () => {
  it("validates one exact licensed Price and caches only successful reads", async () => {
    const client = new FakeReadClient();
    const first = await assertConfiguredStripeCatalog(config, { client, now: () => 1_000 });

    expect(first).toMatchObject({
      valid: true,
      cached: false,
      keyMode: "test",
      priceBookId: "tryhabla-teacher-usd-v3",
      fingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      dimensions: ["teacher"],
    });
    expect(client.reads).toBe(3);

    const second = await assertConfiguredStripeCatalog(config, { client, now: () => 2_000 });
    expect(second.cached).toBe(true);
    expect(client.reads).toBe(3);

    clearStripeAccountValidationCacheForTests();
    clearStripeCatalogValidationCacheForTests();
    const singleCurrencyClient = new FakeReadClient();
    const singleCurrencyPrice = singleCurrencyClient.prices.get(
      ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID,
    )!;
    singleCurrencyClient.prices.set(singleCurrencyPrice.id, {
      ...singleCurrencyPrice,
      currencyOptions: null,
    });
    await expect(
      assertConfiguredStripeCatalog(config, {
        client: singleCurrencyClient,
        cache: false,
      }),
    ).resolves.toMatchObject({ valid: true });
  });

  it("rejects amount and catalog-fingerprint drift with safe error codes", async () => {
    const amountClient = new FakeReadClient();
    const price = amountClient.prices.get(ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID)!;
    amountClient.prices.set(price.id, {
      ...price,
      unitAmountCents: 4_900,
      unitAmountDecimalCents: "4900",
    });
    await expect(
      assertConfiguredStripeCatalog(config, { client: amountClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_price_rate_mismatch", field: "rate" });

    const fingerprintClient = new FakeReadClient();
    const fingerprintPrice = fingerprintClient.prices.get(
      ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID,
    )!;
    fingerprintClient.prices.set(fingerprintPrice.id, {
      ...fingerprintPrice,
      metadata: { ...fingerprintPrice.metadata, catalog_fingerprint: "wrong" },
    });
    await expect(
      assertConfiguredStripeCatalog(config, { client: fingerprintClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_fingerprint_mismatch" });
  });

  it("rejects metered, trial, alternate-currency, and wrong-mode Prices", async () => {
    const mutations: Array<
      (price: StripeCatalogReadPrice) => StripeCatalogReadPrice
    > = [
      (price) => ({
        ...price,
        recurring: { ...price.recurring!, usageType: "metered", meterId: "mtr_retired" },
      }),
      (price) => ({
        ...price,
        recurring: { ...price.recurring!, trialPeriodDays: 14 },
      }),
      (price) => ({
        ...price,
        currencyOptions: {
          ...price.currencyOptions,
          eur: { unitAmountCents: 2_000, unitAmountDecimalCents: "2000" },
        },
      }),
      (price) => ({ ...price, livemode: true }),
    ];

    const codes = [
      "catalog_price_contract_mismatch",
      "catalog_price_contract_mismatch",
      "catalog_price_currency_mismatch",
      "catalog_price_mode_mismatch",
    ];

    for (const [index, mutate] of mutations.entries()) {
      const client = new FakeReadClient();
      const current = client.prices.get(ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID)!;
      client.prices.set(current.id, mutate(current));
      await expect(
        assertConfiguredStripeCatalog(config, { client, cache: false }),
      ).rejects.toMatchObject({ code: codes[index] });
    }
  });

  it("rejects Product presentation or metadata drift", async () => {
    const presentationClient = new FakeReadClient();
    const product = presentationClient.products.get(dimension.productId)!;
    presentationClient.products.set(product.id, { ...product, name: "TryHabla Teacher" });
    await expect(
      assertConfiguredStripeCatalog(config, {
        client: presentationClient,
        cache: false,
      }),
    ).rejects.toMatchObject({ code: "catalog_product_contract_mismatch" });

    const metadataClient = new FakeReadClient();
    const metadataProduct = metadataClient.products.get(dimension.productId)!;
    metadataClient.products.set(metadataProduct.id, {
      ...metadataProduct,
      metadata: { ...metadataProduct.metadata, unexpected: "drift" },
    });
    await expect(
      assertConfiguredStripeCatalog(config, { client: metadataClient, cache: false }),
    ).rejects.toMatchObject({ code: "catalog_product_metadata_mismatch" });
  });

  it("verifies account identity before reading catalog objects", async () => {
    const client = new FakeReadClient();
    client.accountId = "acct_wrong";

    await expect(
      assertConfiguredStripeCatalog(config, { client, cache: false }),
    ).rejects.toMatchObject({ code: "stripe_account_mismatch" });
    expect(client.reads).toBe(1);
  });

  it("rejects a non-v3 manifest before any remote read", async () => {
    const client = new FakeReadClient();
    const invalidManifest = {
      ...STRIPE_CATALOG_MANIFEST,
      schemaVersion: 1,
    } as unknown as typeof STRIPE_CATALOG_MANIFEST;

    await expect(
      assertConfiguredStripeCatalog(config, {
        client,
        manifest: invalidManifest,
        cache: false,
      }),
    ).rejects.toMatchObject({ code: "catalog_manifest_invalid" });
    expect(client.reads).toBe(0);
  });

  it("masks configured IDs when remote reads fail", async () => {
    const client = new FakeReadClient();
    client.prices.delete(ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID);

    const failure = await assertConfiguredStripeCatalog(config, {
      client,
      cache: false,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "catalog_price_read_failed" });
    expect((failure as Error).message).not.toContain(
      ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID,
    );
  });

  it("reports only the licensed subscription runtime ready", async () => {
    expect(await isStripeSubscriptionRuntimeReady(ENV, { client: new FakeReadClient() })).toBe(
      true,
    );
    expect(await isStripeUsageRuntimeReady(ENV, { client: new FakeReadClient() })).toBe(false);

    const broken = new FakeReadClient();
    broken.prices.delete(ENV.STRIPE_TRYHABLA_TEACHER_PRICE_ID);
    expect(
      await isStripeSubscriptionRuntimeReady(ENV, { client: broken, cache: false }),
    ).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  StripeCatalogDriftError,
  assertStripeCatalogAccountId,
  assertTestStripeKey,
  createStripeCatalogManifest,
  reconcileStripeCatalog,
  type CatalogMeterRecord,
  type CatalogPriceRecord,
  type CatalogProductRecord,
  type StripeCatalogClient,
  type StripeCatalogDimension,
} from "@/scripts/stripe-setup";

class FakeStripeCatalogClient implements StripeCatalogClient {
  accountId = "acct_habla_test";
  readonly meters: CatalogMeterRecord[] = [];
  readonly products = new Map<string, CatalogProductRecord>();
  readonly prices: CatalogPriceRecord[] = [];
  readonly idempotencyKeys: string[] = [];
  createdMeterDisplayName: string | null = null;
  writes = 0;

  constructor(private readonly resourceLivemode = false) {}

  async retrieveAccountId() {
    return this.accountId;
  }

  async listMeters() {
    return this.meters;
  }

  async createMeter(dimension: StripeCatalogDimension, idempotencyKey: string) {
    this.writes += 1;
    this.idempotencyKeys.push(idempotencyKey);
    const meter: CatalogMeterRecord = {
      id: `mtr_test_${dimension.key}`,
      livemode: this.resourceLivemode,
      status: "active",
      displayName: this.createdMeterDisplayName ?? dimension.meterDisplayName,
      eventName: dimension.meterEventName,
      aggregationFormula: "sum",
      customerMappingType: "by_id",
      customerPayloadKey: "stripe_customer_id",
      valuePayloadKey: "value",
      eventTimeWindow: null,
    };
    this.meters.push(meter);
    return meter;
  }

  async updateMeter(meterId: string, dimension: StripeCatalogDimension) {
    this.writes += 1;
    const meter = this.meters.find((item) => item.id === meterId);
    if (!meter) throw new Error(`Unknown fake meter ${meterId}.`);
    meter.displayName = dimension.meterDisplayName;
    return meter;
  }

  async getProduct(productId: string) {
    return this.products.get(productId) ?? null;
  }

  async createProduct(dimension: StripeCatalogDimension, idempotencyKey: string) {
    this.writes += 1;
    this.idempotencyKeys.push(idempotencyKey);
    const product: CatalogProductRecord = {
      id: dimension.productId,
      livemode: this.resourceLivemode,
      active: true,
      type: "service",
      name: dimension.productName,
      description: dimension.productDescription,
      unitLabel: dimension.productUnitLabel,
      metadata: { ...dimension.metadata },
    };
    this.products.set(product.id, product);
    return product;
  }

  async updateProduct(productId: string, dimension: StripeCatalogDimension) {
    this.writes += 1;
    const product = this.products.get(productId);
    if (!product) throw new Error(`Unknown fake product ${productId}.`);
    Object.assign(product, {
      active: true,
      type: "service",
      name: dimension.productName,
      description: dimension.productDescription,
      unitLabel: dimension.productUnitLabel,
      metadata: { ...dimension.metadata },
    });
    return product;
  }

  async listPrices(lookupKey: string) {
    return this.prices.filter((price) => price.lookupKey === lookupKey);
  }

  async createPrice(
    dimension: StripeCatalogDimension,
    meterId: string,
    idempotencyKey: string,
  ) {
    this.writes += 1;
    this.idempotencyKeys.push(idempotencyKey);
    const price: CatalogPriceRecord = {
      id: `price_test_${dimension.key}`,
      livemode: this.resourceLivemode,
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
    };
    this.prices.push(price);
    return price;
  }
}

describe("Stripe teacher AI catalog", () => {
  it("derives both customer-facing Stripe prices from the canonical launch price book", () => {
    const manifest = createStripeCatalogManifest();
    const dimensions = Object.fromEntries(manifest.dimensions.map((item) => [item.key, item]));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      apiVersion: "2026-07-29.dahlia",
      priceBookId: "habla-teacher-ai-usd-v2",
      priceBookStatus: "active",
      currency: "usd",
      publishedAt: "2026-08-21",
      effectiveAt: "2026-08-21",
    });
    expect(manifest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(dimensions.successful_grade).toMatchObject({
      meterEventName: "habla_ai_successful_grade",
      unitAmountDecimalCents: "5",
      priceEnvironmentVariable: "STRIPE_AI_GRADE_PRICE_ID",
    });
    expect(dimensions.audio_second).toMatchObject({
      meterEventName: "habla_ai_audio_seconds",
      unitAmountDecimalCents: "0.016666666667",
      priceEnvironmentVariable: "STRIPE_AI_AUDIO_SECONDS_PRICE_ID",
    });
    expect(manifest.dimensions).toHaveLength(2);
    expect(
      manifest.dimensions.every(
        (dimension) =>
          dimension.metadata.price_book_id === manifest.priceBookId &&
          dimension.metadata.catalog_fingerprint === manifest.fingerprint,
      ),
    ).toBe(true);
  });

  it("accepts only Stripe test or sandbox secret keys", () => {
    expect(assertTestStripeKey(" sk_test_example ")).toBe("sk_test_example");
    expect(assertTestStripeKey("rk_test_example")).toBe("rk_test_example");
    expect(assertTestStripeKey("rkcs_test_example")).toBe("rkcs_test_example");
    expect(() => assertTestStripeKey(undefined)).toThrow(/STRIPE_TEST_SECRET_KEY/);
    expect(() => assertTestStripeKey("sk_live_example")).toThrow(/live Stripe key/);
    expect(() => assertTestStripeKey("rk_live_example")).toThrow(/live Stripe key/);
    expect(() => assertTestStripeKey("not-a-stripe-key")).toThrow(/test or sandbox key/);
    expect(assertStripeCatalogAccountId(" acct_habla_test ")).toBe("acct_habla_test");
    expect(() => assertStripeCatalogAccountId(undefined)).toThrow(/STRIPE_ACCOUNT_ID/);
  });

  it("verifies the exact Stripe account before listing or writing catalog resources", async () => {
    const client = new FakeStripeCatalogClient();
    client.accountId = "acct_wrong_sandbox";
    const listMeters = vi.spyOn(client, "listMeters");

    await expect(
      reconcileStripeCatalog(client, {
        apply: true,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toThrow(/account mismatch/);
    expect(listMeters).not.toHaveBeenCalled();
    expect(client.writes).toBe(0);

    const liveClient = new FakeStripeCatalogClient();
    const retrieveAccountId = vi.spyOn(liveClient, "retrieveAccountId");
    await expect(
      reconcileStripeCatalog(liveClient, {
        apply: true,
        accountId: "acct_habla_test",
        keyMode: "live",
      }),
    ).rejects.toThrow(/live Stripe catalog/);
    expect(retrieveAccountId).not.toHaveBeenCalled();
    expect(liveClient.writes).toBe(0);
  });

  it("allows live resources only through the separately authorized reconciler path", async () => {
    const client = new FakeStripeCatalogClient(true);
    const result = await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "live",
      allowLiveProvisioning: true,
    });

    expect(result.applied).toBe(true);
    expect(client.writes).toBe(6);
    expect(client.meters.every((resource) => resource.livemode)).toBe(true);
    expect([...client.products.values()].every((resource) => resource.livemode)).toBe(
      true,
    );
    expect(client.prices.every((resource) => resource.livemode)).toBe(true);
    expect(client.idempotencyKeys).toHaveLength(6);
    expect(client.idempotencyKeys.every((key) => key.startsWith("habla:live:"))).toBe(
      true,
    );
  });

  it("plans all missing resources without writing by default", async () => {
    const client = new FakeStripeCatalogClient();
    const result = await reconcileStripeCatalog(client, {
      apply: false,
      accountId: "acct_habla_test",
      keyMode: "test",
    });

    expect(client.writes).toBe(0);
    expect(result.applied).toBe(false);
    expect(result.actions).toHaveLength(6);
    expect(result.actions.every((action) => action.action === "create")).toBe(true);
    expect(result.priceEnvironment).toEqual({
      STRIPE_AI_GRADE_PRICE_ID:
        "<created by --apply for habla_teacher_ai_usd_v2_successful_grade_monthly>",
      STRIPE_AI_AUDIO_SECONDS_PRICE_ID:
        "<created by --apply for habla_teacher_ai_usd_v2_audio_second_monthly>",
    });
  });

  it("creates the test catalog once and makes later applies no-ops", async () => {
    const client = new FakeStripeCatalogClient();
    const created = await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });

    expect(created.actions.every((action) => action.action === "create")).toBe(true);
    expect(client.writes).toBe(6);
    expect(client.idempotencyKeys).toHaveLength(6);
    expect(
      client.idempotencyKeys.every((key) =>
        key.startsWith("habla:habla-teacher-ai-usd-v2:"),
      ),
    ).toBe(true);
    expect(created.priceEnvironment).toEqual({
      STRIPE_AI_GRADE_PRICE_ID: "price_test_successful_grade",
      STRIPE_AI_AUDIO_SECONDS_PRICE_ID: "price_test_audio_second",
    });

    const rerun = await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    expect(rerun.actions.every((action) => action.action === "unchanged")).toBe(true);
    expect(client.writes).toBe(6);
  });

  it("rejects a stale idempotent meter create response before reporting apply success", async () => {
    const client = new FakeStripeCatalogClient();
    client.createdMeterDisplayName = "Stale meter display";

    await expect(
      reconcileStripeCatalog(client, {
        apply: true,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toBeInstanceOf(StripeCatalogDriftError);
    expect(client.writes).toBe(1);
    expect(client.products.size).toBe(0);
    expect(client.prices).toHaveLength(0);
  });

  it("reconciles mutable meter and Product presentation fields", async () => {
    const client = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    client.meters[0].displayName = "Old display name";
    const product = client.products.values().next().value as CatalogProductRecord;
    product.name = "Old Product name";
    delete product.metadata.catalog_fingerprint;
    product.metadata.unexpected = "remove-me";

    const result = await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: "meter", action: "update" }),
        expect.objectContaining({ resource: "product", action: "update" }),
      ]),
    );
    expect(client.meters[0].displayName).toBe("Habla successful AI grades");
    expect(product.name).toBe("Habla AI successful grades");
    expect(product.metadata).toEqual(
      createStripeCatalogManifest().dimensions[0].metadata,
    );
    expect(client.writes).toBe(8);
  });

  it("rejects every immutable Price field enforced by the runtime verifier", async () => {
    const mutations: Array<(price: CatalogPriceRecord) => void> = [
      (price) => {
        price.nickname = "wrong";
      },
      (price) => {
        if (!price.recurring) throw new Error("missing fake recurring data");
        price.recurring.trialPeriodDays = 14;
      },
      (price) => {
        price.customUnitAmount = { enabled: true };
      },
      (price) => {
        price.tiersMode = "graduated";
      },
      (price) => {
        price.metadata.unexpected = "drift";
      },
    ];

    for (const mutate of mutations) {
      const client = new FakeStripeCatalogClient();
      await reconcileStripeCatalog(client, {
        apply: true,
        accountId: "acct_habla_test",
        keyMode: "test",
      });
      mutate(client.prices[0]);
      await expect(
        reconcileStripeCatalog(client, {
          apply: false,
          accountId: "acct_habla_test",
          keyMode: "test",
        }),
      ).rejects.toBeInstanceOf(StripeCatalogDriftError);
    }
  });

  it("fails closed on live resources, immutable drift, or identity metadata drift", async () => {
    const liveClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(liveClient, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    liveClient.meters[0].livemode = true;
    await expect(
      reconcileStripeCatalog(liveClient, {
        apply: false,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toThrow(/live-mode/);

    const amountClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(amountClient, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    amountClient.prices[0].unitAmountDecimalCents = "2";
    await expect(
      reconcileStripeCatalog(amountClient, {
        apply: false,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toBeInstanceOf(StripeCatalogDriftError);

    const metadataClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(metadataClient, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    metadataClient.prices[0].metadata.price_book_id = "different-book";
    await expect(
      reconcileStripeCatalog(metadataClient, {
        apply: false,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toThrow(/metadata/);

    const alternateCurrencyClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(alternateCurrencyClient, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    alternateCurrencyClient.prices[0].currencyOptions = {
      eur: { unitAmountDecimalCents: "5" },
    };
    await expect(
      reconcileStripeCatalog(alternateCurrencyClient, {
        apply: false,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toThrow(/currency_options/);
  });
});

import { describe, expect, it } from "vitest";
import {
  StripeCatalogDriftError,
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
  readonly meters: CatalogMeterRecord[] = [];
  readonly products = new Map<string, CatalogProductRecord>();
  readonly prices: CatalogPriceRecord[] = [];
  writes = 0;

  async listMeters() {
    return this.meters;
  }

  async createMeter(dimension: StripeCatalogDimension) {
    this.writes += 1;
    const meter: CatalogMeterRecord = {
      id: `mtr_test_${dimension.key}`,
      livemode: false,
      status: "active",
      displayName: dimension.meterDisplayName,
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

  async createProduct(dimension: StripeCatalogDimension) {
    this.writes += 1;
    const product: CatalogProductRecord = {
      id: dimension.productId,
      livemode: false,
      active: true,
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
  ) {
    this.writes += 1;
    const price: CatalogPriceRecord = {
      id: `price_test_${dimension.key}`,
      livemode: false,
      active: true,
      lookupKey: dimension.priceLookupKey,
      currency: "usd",
      billingScheme: "per_unit",
      type: "recurring",
      productId: dimension.productId,
      unitAmountDecimalCents: dimension.unitAmountDecimalCents,
      recurring: {
        interval: "month",
        intervalCount: 1,
        usageType: "metered",
        meterId,
      },
      taxBehavior: "unspecified",
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
    expect(() => assertTestStripeKey(undefined)).toThrow(/STRIPE_TEST_SECRET_KEY/);
    expect(() => assertTestStripeKey("sk_live_example")).toThrow(/live Stripe key/);
    expect(() => assertTestStripeKey("rk_live_example")).toThrow(/live Stripe key/);
    expect(() => assertTestStripeKey("not-a-stripe-key")).toThrow(/test or sandbox key/);
  });

  it("plans all missing resources without writing by default", async () => {
    const client = new FakeStripeCatalogClient();
    const result = await reconcileStripeCatalog(client, { apply: false });

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
    const created = await reconcileStripeCatalog(client, { apply: true });

    expect(created.actions.every((action) => action.action === "create")).toBe(true);
    expect(client.writes).toBe(6);
    expect(created.priceEnvironment).toEqual({
      STRIPE_AI_GRADE_PRICE_ID: "price_test_successful_grade",
      STRIPE_AI_AUDIO_SECONDS_PRICE_ID: "price_test_audio_second",
    });

    const rerun = await reconcileStripeCatalog(client, { apply: true });
    expect(rerun.actions.every((action) => action.action === "unchanged")).toBe(true);
    expect(client.writes).toBe(6);
  });

  it("reconciles mutable meter and Product presentation fields", async () => {
    const client = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(client, { apply: true });
    client.meters[0].displayName = "Old display name";
    const product = client.products.values().next().value as CatalogProductRecord;
    product.name = "Old Product name";
    delete product.metadata.catalog_fingerprint;

    const result = await reconcileStripeCatalog(client, { apply: true });

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: "meter", action: "update" }),
        expect.objectContaining({ resource: "product", action: "update" }),
      ]),
    );
    expect(client.meters[0].displayName).toBe("Habla successful AI grades");
    expect(product.name).toBe("Habla AI successful grades");
    expect(client.writes).toBe(8);
  });

  it("fails closed on live resources, immutable drift, or identity metadata drift", async () => {
    const liveClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(liveClient, { apply: true });
    liveClient.meters[0].livemode = true;
    await expect(reconcileStripeCatalog(liveClient, { apply: false })).rejects.toThrow(/live-mode/);

    const amountClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(amountClient, { apply: true });
    amountClient.prices[0].unitAmountDecimalCents = "2";
    await expect(reconcileStripeCatalog(amountClient, { apply: false })).rejects.toBeInstanceOf(
      StripeCatalogDriftError,
    );

    const metadataClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(metadataClient, { apply: true });
    metadataClient.prices[0].metadata.price_book_id = "different-book";
    await expect(reconcileStripeCatalog(metadataClient, { apply: false })).rejects.toThrow(
      /metadata/,
    );
  });
});

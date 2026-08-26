import { describe, expect, it, vi } from "vitest";
import {
  StripeCatalogDriftError,
  assertStripeCatalogAccountId,
  assertTestStripeKey,
  createStripeCatalogManifest,
  reconcileStripeCatalog,
  type CatalogPriceRecord,
  type CatalogProductRecord,
  type StripeCatalogClient,
  type StripeCatalogDimension,
} from "@/scripts/stripe-setup";

class FakeStripeCatalogClient implements StripeCatalogClient {
  accountId = "acct_habla_test";
  readonly products = new Map<string, CatalogProductRecord>();
  readonly prices: CatalogPriceRecord[] = [];
  readonly idempotencyKeys: string[] = [];
  writes = 0;

  constructor(private readonly resourceLivemode = false) {}

  async retrieveAccountId() {
    return this.accountId;
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

  async createPrice(dimension: StripeCatalogDimension, idempotencyKey: string) {
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
      unitAmountCents: dimension.unitAmountCents,
      unitAmountDecimalCents: String(dimension.unitAmountCents),
      currencyOptions: {},
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
    };
    this.prices.push(price);
    return price;
  }
}

describe("Stripe Teacher catalog", () => {
  it("pins one $20 licensed Teacher Price under customer-facing Product TryHabla", () => {
    const manifest = createStripeCatalogManifest();

    expect(manifest).toMatchObject({
      schemaVersion: 2,
      apiVersion: "2026-07-29.dahlia",
      priceBookId: "tryhabla-teacher-usd-v3",
      priceBookStatus: "active",
      currency: "usd",
      publishedAt: "2026-08-26",
      effectiveAt: "2026-08-26",
    });
    expect(manifest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.dimensions).toHaveLength(1);
    expect(manifest.dimensions[0]).toMatchObject({
      key: "teacher",
      productId: "tryhabla_teacher_usd_v3",
      productName: "TryHabla",
      productUnitLabel: "subscription",
      priceLookupKey: "tryhabla_teacher_usd_v3_monthly",
      priceEnvironmentVariable: "STRIPE_TRYHABLA_TEACHER_PRICE_ID",
      unitAmountCents: 2_000,
      metadata: {
        price_book_id: "tryhabla-teacher-usd-v3",
        plan: "teacher",
        billing_model: "licensed",
        billing_interval: "month",
        checkout_quantity: "1",
        included_ai_reviews: "300",
        overage_policy: "pause_ai",
      },
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.dimensions)).toBe(true);
    expect(Object.isFrozen(manifest.dimensions[0].metadata)).toBe(true);
  });

  it("accepts only Stripe test or sandbox secret keys and exact account IDs", () => {
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

  it("verifies the exact Stripe account before any catalog read or write", async () => {
    const client = new FakeStripeCatalogClient();
    client.accountId = "acct_wrong_sandbox";
    const getProduct = vi.spyOn(client, "getProduct");

    await expect(
      reconcileStripeCatalog(client, {
        apply: true,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toThrow(/account mismatch/);
    expect(getProduct).not.toHaveBeenCalled();
    expect(client.writes).toBe(0);

    const liveClient = new FakeStripeCatalogClient(true);
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

  it("allows live resources only through the explicitly authorized path", async () => {
    const client = new FakeStripeCatalogClient(true);
    const result = await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "live",
      allowLiveProvisioning: true,
    });

    expect(result.applied).toBe(true);
    expect(client.writes).toBe(2);
    expect([...client.products.values()].every((resource) => resource.livemode)).toBe(true);
    expect(client.prices.every((resource) => resource.livemode)).toBe(true);
    expect(client.idempotencyKeys).toHaveLength(2);
    expect(
      client.idempotencyKeys.every((key) =>
        key.startsWith("tryhabla:live:tryhabla-teacher-usd-v3:"),
      ),
    ).toBe(true);
  });

  it("plans one Product and one Price without writing by default", async () => {
    const client = new FakeStripeCatalogClient();
    const result = await reconcileStripeCatalog(client, {
      apply: false,
      accountId: "acct_habla_test",
      keyMode: "test",
    });

    expect(client.writes).toBe(0);
    expect(result.applied).toBe(false);
    expect(result.actions).toEqual([
      expect.objectContaining({ dimension: "teacher", resource: "product", action: "create" }),
      expect.objectContaining({ dimension: "teacher", resource: "price", action: "create" }),
    ]);
    expect(result.priceEnvironment).toEqual({
      STRIPE_TRYHABLA_TEACHER_PRICE_ID:
        "<created by --apply for tryhabla_teacher_usd_v3_monthly>",
    });
  });

  it("creates the catalog once and makes later applies no-ops", async () => {
    const client = new FakeStripeCatalogClient();
    const created = await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });

    expect(created.actions.every((action) => action.action === "create")).toBe(true);
    expect(client.writes).toBe(2);
    expect(client.idempotencyKeys).toHaveLength(2);
    expect(
      client.idempotencyKeys.every((key) =>
        key.startsWith("tryhabla:tryhabla-teacher-usd-v3:"),
      ),
    ).toBe(true);
    expect(created.priceEnvironment).toEqual({
      STRIPE_TRYHABLA_TEACHER_PRICE_ID: "price_test_teacher",
    });

    const rerun = await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    expect(rerun.actions.every((action) => action.action === "unchanged")).toBe(true);
    expect(client.writes).toBe(2);
  });

  it("repairs mutable Product presentation but rejects identity drift", async () => {
    const client = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    const product = client.products.values().next().value as CatalogProductRecord;
    product.name = "Old product name";
    delete product.metadata.catalog_fingerprint;
    product.metadata.unexpected = "remove-me";

    const repaired = await reconcileStripeCatalog(client, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    expect(repaired.actions).toContainEqual(
      expect.objectContaining({ resource: "product", action: "update" }),
    );
    expect(product.name).toBe("TryHabla");
    expect(product.metadata).toEqual(createStripeCatalogManifest().dimensions[0].metadata);
    expect(client.writes).toBe(3);

    product.metadata.price_book_id = "different-book";
    await expect(
      reconcileStripeCatalog(client, {
        apply: false,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toBeInstanceOf(StripeCatalogDriftError);
  });

  it("rejects immutable fixed-Price drift", async () => {
    const mutations: Array<(price: CatalogPriceRecord) => void> = [
      (price) => {
        price.unitAmountCents = 4_900;
      },
      (price) => {
        price.unitAmountDecimalCents = "4900";
      },
      (price) => {
        if (!price.recurring) throw new Error("missing fake recurring data");
        price.recurring.usageType = "metered";
        price.recurring.meterId = "mtr_obsolete";
      },
      (price) => {
        price.nickname = "wrong";
      },
      (price) => {
        price.currencyOptions = {
          eur: { unitAmountCents: 2_000, unitAmountDecimalCents: "2000" },
        };
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

  it("rejects wrong-mode resources and duplicate lookup-key Prices", async () => {
    const modeClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(modeClient, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    modeClient.prices[0].livemode = true;
    await expect(
      reconcileStripeCatalog(modeClient, {
        apply: false,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toThrow(/live-mode/);

    const duplicateClient = new FakeStripeCatalogClient();
    await reconcileStripeCatalog(duplicateClient, {
      apply: true,
      accountId: "acct_habla_test",
      keyMode: "test",
    });
    duplicateClient.prices.push({ ...duplicateClient.prices[0], id: "price_duplicate" });
    await expect(
      reconcileStripeCatalog(duplicateClient, {
        apply: false,
        accountId: "acct_habla_test",
        keyMode: "test",
      }),
    ).rejects.toThrow(/Multiple Stripe prices/);
  });
});

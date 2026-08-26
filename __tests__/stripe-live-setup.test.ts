import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcileMocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  paymentMethods: vi.fn(),
  portal: vi.fn(),
}));

vi.mock("@/scripts/stripe-setup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/scripts/stripe-setup")>();
  return {
    ...actual,
    StripeSdkCatalogClient: class {},
    reconcileStripeCatalog: reconcileMocks.catalog,
  };
});

vi.mock("@/scripts/stripe-payment-methods-setup", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/scripts/stripe-payment-methods-setup")
  >();
  return {
    ...actual,
    StripeSdkPaymentMethodConfigurationSetupClient: class {},
    reconcileStripePaymentMethodConfiguration: reconcileMocks.paymentMethods,
  };
});

vi.mock("@/scripts/stripe-portal-setup", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/scripts/stripe-portal-setup")
  >();
  return {
    ...actual,
    StripeSdkPortalSetupClient: class {},
    reconcileStripePortalConfiguration: reconcileMocks.portal,
  };
});

import {
  assertStripeLiveSetupKey,
  authorizeStripeLiveSetup,
  runStripeLiveSetup,
  type StripeLiveSetupAuthorization,
  type StripeLiveSetupFlags,
} from "@/scripts/stripe-live-setup";

const ENV = Object.freeze({
  NODE_ENV: "production",
  STRIPE_ALLOW_LIVE: "true",
  STRIPE_LIVE_SETUP_APPROVED: "true",
  STRIPE_LIVE_SETUP_SECRET_KEY: "sk_live_habla",
  STRIPE_ACCOUNT_ID: "acct_habla_live",
  STRIPE_SUBSCRIPTION_BILLING_ENABLED: "false",
  STRIPE_CHECKOUT_ENABLED: "false",
  STRIPE_AUTOMATIC_TAX_ENABLED: "false",
});

const PLAN_FLAGS: StripeLiveSetupFlags = Object.freeze({
  apply: false,
  allowLiveReadOnly: true,
  allowLiveApply: false,
  confirmAccount: "acct_habla_live",
  confirmPriceBook: "tryhabla-teacher-usd-v3",
});

const AUTHORIZATION: StripeLiveSetupAuthorization = Object.freeze({
  accountId: "acct_habla_live",
  priceBookId: "tryhabla-teacher-usd-v3",
  secretKey: "sk_live_habla",
  apply: true,
});

const CATALOG_PLAN = Object.freeze({
  applied: false,
  priceBookId: "tryhabla-teacher-usd-v3",
  fingerprint: "f".repeat(64),
  actions: Object.freeze([]),
  priceEnvironment: Object.freeze({}),
});

beforeEach(() => {
  reconcileMocks.catalog.mockReset();
  reconcileMocks.paymentMethods.mockReset();
  reconcileMocks.portal.mockReset();
});

describe("explicit live Stripe setup authorization", () => {
  it("authorizes only the exact read-only plan contract by default", () => {
    expect(authorizeStripeLiveSetup({ env: ENV, flags: PLAN_FLAGS })).toEqual({
      accountId: "acct_habla_live",
      priceBookId: "tryhabla-teacher-usd-v3",
      secretKey: "sk_live_habla",
      apply: false,
    });
  });

  it("requires both mutation flags in addition to every environment gate", () => {
    expect(
      authorizeStripeLiveSetup({
        env: ENV,
        flags: { ...PLAN_FLAGS, apply: true, allowLiveApply: true },
      }),
    ).toMatchObject({ apply: true });

    expect(() =>
      authorizeStripeLiveSetup({
        env: ENV,
        flags: { ...PLAN_FLAGS, apply: true },
      }),
    ).toThrow(/--allow-live-apply/);
    expect(() =>
      authorizeStripeLiveSetup({
        env: ENV,
        flags: { ...PLAN_FLAGS, allowLiveReadOnly: false },
      }),
    ).toThrow(/--allow-live-read-only/);
    expect(() =>
      authorizeStripeLiveSetup({
        env: ENV,
        flags: { ...PLAN_FLAGS, allowLiveApply: true },
      }),
    ).toThrow(/only valid together with --apply/);
  });

  it.each([
    ["NODE_ENV", "test"],
    ["STRIPE_ALLOW_LIVE", "false"],
    ["STRIPE_LIVE_SETUP_APPROVED", "false"],
    ["STRIPE_SUBSCRIPTION_BILLING_ENABLED", "true"],
    ["STRIPE_USAGE_BILLING_ENABLED", "true"],
    ["STRIPE_USAGE_BILLING_ENABLED", "false"],
    ["STRIPE_AI_GRADE_PRICE_ID", "price_retired_grade"],
    ["STRIPE_AI_AUDIO_SECONDS_PRICE_ID", "price_retired_audio"],
    ["STRIPE_CHECKOUT_ENABLED", "true"],
    ["STRIPE_AUTOMATIC_TAX_ENABLED", "true"],
  ])("rejects an unsafe %s setting", (key, value) => {
    expect(() =>
      authorizeStripeLiveSetup({
        env: { ...ENV, [key]: value },
        flags: PLAN_FLAGS,
      }),
    ).toThrow(key);
  });

  it("requires exact account and price-book confirmations", () => {
    expect(() =>
      authorizeStripeLiveSetup({
        env: ENV,
        flags: { ...PLAN_FLAGS, confirmAccount: "acct_other" },
      }),
    ).toThrow(/--confirm-account/);
    expect(() =>
      authorizeStripeLiveSetup({
        env: ENV,
        flags: { ...PLAN_FLAGS, confirmPriceBook: "other-book" },
      }),
    ).toThrow(/--confirm-price-book/);
  });

  it("accepts live secret and restricted keys but rejects every non-live form", () => {
    expect(assertStripeLiveSetupKey(" sk_live_habla ")).toBe("sk_live_habla");
    expect(assertStripeLiveSetupKey("rk_live_habla")).toBe("rk_live_habla");
    expect(() => assertStripeLiveSetupKey("sk_test_habla")).toThrow(/test or sandbox/);
    expect(() => assertStripeLiveSetupKey("rkcs_test_habla")).toThrow(/test or sandbox/);
    expect(() => assertStripeLiveSetupKey("not-a-key")).toThrow(/live secret/);
  });

  it("does not mutate a Portal whose payment-method dependency was absent from plan", async () => {
    reconcileMocks.catalog
      .mockResolvedValueOnce(CATALOG_PLAN)
      .mockResolvedValueOnce({ ...CATALOG_PLAN, applied: true });
    reconcileMocks.paymentMethods
      .mockResolvedValueOnce({
        action: "create",
        applied: false,
        configurationId: null,
      })
      .mockResolvedValueOnce({
        action: "create",
        applied: true,
        configurationId: "pmc_live",
      });
    reconcileMocks.portal.mockResolvedValueOnce({
      action: "create",
      applied: false,
      configurationId: null,
    });

    await expect(
      runStripeLiveSetup({
        stripe: {} as Stripe,
        authorization: AUTHORIZATION,
      }),
    ).resolves.toMatchObject({
      applied: true,
      portalDeferred: true,
      portal: { action: "create", applied: false, configurationId: null },
    });
    expect(reconcileMocks.portal).toHaveBeenCalledTimes(1);
    expect(reconcileMocks.portal).toHaveBeenCalledWith(
      expect.objectContaining({
        keyMode: "live",
        allowLiveProvisioning: true,
        paymentMethodConfigurationId: "pmc_live",
        apply: false,
      }),
    );
  });

  it("keeps every reconciler read-only for the default live plan", async () => {
    reconcileMocks.catalog.mockResolvedValueOnce(CATALOG_PLAN);
    reconcileMocks.paymentMethods.mockResolvedValueOnce({
      action: "unchanged",
      applied: false,
      configurationId: "pmc_live",
    });
    reconcileMocks.portal.mockResolvedValueOnce({
      action: "unchanged",
      applied: false,
      configurationId: "bpc_live",
    });

    await expect(
      runStripeLiveSetup({
        stripe: {} as Stripe,
        authorization: { ...AUTHORIZATION, apply: false },
      }),
    ).resolves.toMatchObject({ applied: false, portalDeferred: false });
    expect(reconcileMocks.catalog).toHaveBeenCalledTimes(1);
    expect(reconcileMocks.paymentMethods).toHaveBeenCalledTimes(1);
    expect(reconcileMocks.portal).toHaveBeenCalledTimes(1);
    expect(reconcileMocks.catalog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ apply: false }),
    );
    expect(reconcileMocks.paymentMethods).toHaveBeenCalledWith(
      expect.objectContaining({ apply: false }),
    );
    expect(reconcileMocks.portal).toHaveBeenCalledWith(
      expect.objectContaining({ apply: false }),
    );
  });

  it("applies only a Portal action that was present in the pre-mutation plan", async () => {
    reconcileMocks.catalog
      .mockResolvedValueOnce(CATALOG_PLAN)
      .mockResolvedValueOnce({ ...CATALOG_PLAN, applied: false });
    reconcileMocks.paymentMethods
      .mockResolvedValueOnce({
        action: "unchanged",
        applied: false,
        configurationId: "pmc_live",
      })
      .mockResolvedValueOnce({
        action: "unchanged",
        applied: false,
        configurationId: "pmc_live",
      });
    reconcileMocks.portal
      .mockResolvedValueOnce({
        action: "create",
        applied: false,
        configurationId: null,
      })
      .mockResolvedValueOnce({
        action: "create",
        applied: true,
        configurationId: "bpc_live",
      });

    await expect(
      runStripeLiveSetup({
        stripe: {} as Stripe,
        authorization: AUTHORIZATION,
      }),
    ).resolves.toMatchObject({
      applied: true,
      portalDeferred: false,
      portal: { action: "create", applied: true, configurationId: "bpc_live" },
    });
    expect(reconcileMocks.portal).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ apply: false }),
    );
    expect(reconcileMocks.portal).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ apply: true }),
    );
  });
});

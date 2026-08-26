import { createHash } from "node:crypto";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import type { StripeCatalogConfig } from "@/lib/billing/config";
import { STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY } from "@/lib/billing/policy";

export const STRIPE_BILLING_CONTRACT_SCHEMA = "tryhabla_billing_contract_v2" as const;

/**
 * Immutable scope for subscription entitlement. Any account, catalog, tax,
 * or payment-policy change produces a different contract and fails closed.
 */
export function getStripeBillingContractId(
  config: Pick<
    StripeCatalogConfig,
    | "accountId"
    | "apiVersion"
    | "keyMode"
    | "priceIds"
    | "automaticTaxEnabled"
  >,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema: STRIPE_BILLING_CONTRACT_SCHEMA,
        accountId: config.accountId,
        apiVersion: config.apiVersion,
        keyMode: config.keyMode,
        priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
        catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        priceIds: {
          teacher: config.priceIds.teacher,
        },
        automaticTaxEnabled: config.automaticTaxEnabled,
        paymentMethodPolicy: STRIPE_CHECKOUT_PAYMENT_METHOD_POLICY,
      }),
    )
    .digest("hex");
}

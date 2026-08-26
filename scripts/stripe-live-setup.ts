import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import { STRIPE_API_VERSION } from "@/lib/billing/config";
import {
  StripeSdkPaymentMethodConfigurationSetupClient,
  reconcileStripePaymentMethodConfiguration,
  type StripePaymentMethodConfigurationSetupResult,
} from "@/scripts/stripe-payment-methods-setup";
import {
  StripeSdkPortalSetupClient,
  reconcileStripePortalConfiguration,
  type StripePortalSetupResult,
} from "@/scripts/stripe-portal-setup";
import {
  StripeSdkCatalogClient,
  reconcileStripeCatalog,
  type StripeCatalogResult,
} from "@/scripts/stripe-setup";

type StripeLiveSetupEnv = Readonly<Record<string, string | undefined>>;

export type StripeLiveSetupFlags = Readonly<{
  apply: boolean;
  allowLiveReadOnly: boolean;
  allowLiveApply: boolean;
  confirmAccount?: string;
  confirmPriceBook?: string;
}>;

export type StripeLiveSetupAuthorization = Readonly<{
  accountId: string;
  priceBookId: string;
  secretKey: string;
  apply: boolean;
}>;

export type StripeLiveSetupResult = Readonly<{
  applied: boolean;
  catalog: StripeCatalogResult;
  paymentMethods: StripePaymentMethodConfigurationSetupResult;
  portal: StripePortalSetupResult | null;
  portalDeferred: boolean;
}>;

function configuredValue(env: StripeLiveSetupEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function requireExactBoolean(
  env: StripeLiveSetupEnv,
  key: string,
  expected: boolean,
) {
  const value = configuredValue(env, key).toLowerCase();
  if (value !== String(expected)) {
    throw new Error(`${key}=${expected} is required for live Stripe setup.`);
  }
}

export function assertStripeLiveSetupKey(value: string | undefined) {
  const key = value?.trim();
  if (!key) {
    throw new Error(
      "STRIPE_LIVE_SETUP_SECRET_KEY is required for the live Stripe setup tool.",
    );
  }
  if (
    key.startsWith("sk_test_") ||
    key.startsWith("rk_test_") ||
    key.startsWith("rkcs_test_")
  ) {
    throw new Error("Refusing to use a test or sandbox key for live Stripe setup.");
  }
  if (!key.startsWith("sk_live_") && !key.startsWith("rk_live_")) {
    throw new Error(
      "STRIPE_LIVE_SETUP_SECRET_KEY must be a Stripe live secret or restricted key.",
    );
  }
  return key;
}

export function authorizeStripeLiveSetup(input: Readonly<{
  env: StripeLiveSetupEnv;
  flags: StripeLiveSetupFlags;
}>): StripeLiveSetupAuthorization {
  if (configuredValue(input.env, "NODE_ENV") !== "production") {
    throw new Error("NODE_ENV=production is required for live Stripe setup.");
  }
  requireExactBoolean(input.env, "STRIPE_ALLOW_LIVE", true);
  requireExactBoolean(input.env, "STRIPE_LIVE_SETUP_APPROVED", true);
  requireExactBoolean(input.env, "STRIPE_SUBSCRIPTION_BILLING_ENABLED", false);
  requireExactBoolean(input.env, "STRIPE_CHECKOUT_ENABLED", false);
  requireExactBoolean(input.env, "STRIPE_AUTOMATIC_TAX_ENABLED", false);
  if (configuredValue(input.env, "STRIPE_USAGE_BILLING_ENABLED")) {
    throw new Error("STRIPE_USAGE_BILLING_ENABLED is obsolete and must be removed.");
  }
  for (const key of [
    "STRIPE_AI_GRADE_PRICE_ID",
    "STRIPE_AI_AUDIO_SECONDS_PRICE_ID",
  ] as const) {
    if (configuredValue(input.env, key)) {
      throw new Error(`${key} is obsolete and must be removed before v3 setup.`);
    }
  }

  if (!input.flags.allowLiveReadOnly) {
    throw new Error(
      "Live Stripe setup requires the explicit --allow-live-read-only flag before any remote read.",
    );
  }
  if (input.flags.apply && !input.flags.allowLiveApply) {
    throw new Error(
      "Live Stripe mutation requires both --apply and --allow-live-apply.",
    );
  }
  if (!input.flags.apply && input.flags.allowLiveApply) {
    throw new Error("--allow-live-apply is only valid together with --apply.");
  }

  const accountId = configuredValue(input.env, "STRIPE_ACCOUNT_ID");
  if (!accountId.startsWith("acct_")) {
    throw new Error("STRIPE_ACCOUNT_ID must be the exact live acct_ ID.");
  }
  if (input.flags.confirmAccount?.trim() !== accountId) {
    throw new Error(
      "--confirm-account must exactly match the configured live STRIPE_ACCOUNT_ID.",
    );
  }
  if (
    input.flags.confirmPriceBook?.trim() !==
    STRIPE_CATALOG_MANIFEST.priceBookId
  ) {
    throw new Error(
      `--confirm-price-book must exactly equal ${STRIPE_CATALOG_MANIFEST.priceBookId}.`,
    );
  }

  return Object.freeze({
    accountId,
    priceBookId: STRIPE_CATALOG_MANIFEST.priceBookId,
    secretKey: assertStripeLiveSetupKey(
      configuredValue(input.env, "STRIPE_LIVE_SETUP_SECRET_KEY"),
    ),
    apply: input.flags.apply,
  });
}

export async function runStripeLiveSetup(input: Readonly<{
  stripe: Stripe;
  authorization: StripeLiveSetupAuthorization;
}>): Promise<StripeLiveSetupResult> {
  const catalogClient = new StripeSdkCatalogClient(input.stripe);
  const paymentMethodClient =
    new StripeSdkPaymentMethodConfigurationSetupClient(input.stripe);
  const portalClient = new StripeSdkPortalSetupClient(input.stripe);
  const common = {
    accountId: input.authorization.accountId,
    keyMode: "live" as const,
    allowLiveProvisioning: true,
  };

  // Complete every possible read-only preflight before the first mutation.
  const catalogPlan = await reconcileStripeCatalog(catalogClient, {
    ...common,
    apply: false,
  });
  const paymentMethodPlan = await reconcileStripePaymentMethodConfiguration({
    ...common,
    client: paymentMethodClient,
    apply: false,
  });
  let portalPlan: StripePortalSetupResult | null = null;
  if (
    paymentMethodPlan.action === "unchanged" &&
    paymentMethodPlan.configurationId
  ) {
    portalPlan = await reconcileStripePortalConfiguration({
      ...common,
      client: portalClient,
      paymentMethodConfigurationId: paymentMethodPlan.configurationId,
      apply: false,
    });
  }

  if (!input.authorization.apply) {
    return Object.freeze({
      applied: false,
      catalog: catalogPlan,
      paymentMethods: paymentMethodPlan,
      portal: portalPlan,
      portalDeferred: paymentMethodPlan.action !== "unchanged",
    });
  }

  const catalog = await reconcileStripeCatalog(catalogClient, {
    ...common,
    apply: true,
  });
  const paymentMethods = await reconcileStripePaymentMethodConfiguration({
    ...common,
    client: paymentMethodClient,
    apply: true,
  });
  if (!paymentMethods.configurationId) {
    throw new Error(
      "Live Payment Method Configuration apply completed without a pmc_ ID.",
    );
  }
  // Never mutate a Portal configuration that could not be included in the
  // pre-mutation plan. When the pmc_ dependency was just created or repaired,
  // expose the now-actionable Portal plan and require a separate rerun/apply.
  const portal = await reconcileStripePortalConfiguration({
    ...common,
    client: portalClient,
    paymentMethodConfigurationId: paymentMethods.configurationId,
    apply: portalPlan !== null,
  });
  const portalDeferred = portalPlan === null;
  if (!portalDeferred && !portal.configurationId) {
    throw new Error("Live Portal apply completed without a bpc_ ID.");
  }
  return Object.freeze({
    applied: true,
    catalog,
    paymentMethods,
    portal,
    portalDeferred,
  });
}

function printCatalog(result: StripeCatalogResult) {
  for (const action of result.actions) {
    const verb =
      action.action === "unchanged"
        ? "unchanged"
        : result.applied
          ? action.action
          : `would ${action.action}`;
    console.log(`- ${action.dimension} ${action.resource}: ${verb} (${action.id})`);
  }
}

function printResult(
  authorization: StripeLiveSetupAuthorization,
  result: StripeLiveSetupResult,
) {
  console.log(`LIVE Stripe setup ${result.applied ? "apply" : "read-only plan"}`);
  console.log(`Account: ${authorization.accountId}`);
  console.log(`Price book: ${result.catalog.priceBookId}`);
  console.log(`Fingerprint: ${result.catalog.fingerprint}`);
  printCatalog(result.catalog);
  const paymentMethodVerb =
    result.paymentMethods.action === "unchanged"
      ? "unchanged"
      : result.paymentMethods.applied
        ? result.paymentMethods.action
        : `would ${result.paymentMethods.action}`;
  console.log(
    `- payment methods: ${paymentMethodVerb}${result.paymentMethods.configurationId ? ` (${result.paymentMethods.configurationId})` : ""}`,
  );
  if (result.portal) {
    const portalVerb =
      result.portal.action === "unchanged"
        ? "unchanged"
        : result.portal.applied
          ? result.portal.action
          : `would ${result.portal.action}`;
    console.log(
      `- Customer Portal: ${portalVerb}${result.portal.configurationId ? ` (${result.portal.configurationId})` : ""}`,
    );
  } else {
    console.log(
      "- Customer Portal: deferred until the exact card-only Payment Method Configuration exists",
    );
  }

  if (!result.applied) {
    console.log("No Stripe resources were changed.");
    return;
  }
  if (result.portalDeferred) {
    console.log(
      "\nThe exact card-only payment configuration was created or repaired. The Customer Portal was not mutated because it was not actionable in the pre-mutation plan.",
    );
    console.log(
      "Run the read-only live plan again, review its Portal action, then run a separately approved apply.",
    );
    return;
  }
  console.log("\nPin these exact live runtime IDs:");
  for (const [name, value] of Object.entries(result.catalog.priceEnvironment)) {
    console.log(`${name}=${value}`);
  }
  console.log(
    `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID=${result.paymentMethods.configurationId}`,
  );
  console.log(`STRIPE_PORTAL_CONFIGURATION_ID=${result.portal?.configurationId}`);
  console.log(
    "Keep both billing flags disabled and run the read-only live plan again before runtime verification.",
  );
}

function printHelp() {
  console.log(`Usage: npx tsx scripts/stripe-live-setup.ts \\
  --allow-live-read-only \\
  --confirm-account acct_... \\
  --confirm-price-book ${STRIPE_CATALOG_MANIFEST.priceBookId} \\
  [--apply --allow-live-apply]

Plans or provisions TryHabla's exact live Stripe catalog, card-only Payment Method
Configuration, and Customer Portal. The command is read-only unless both --apply
and --allow-live-apply are present. It never creates Customers or subscriptions.
If the card-only configuration must first be created or repaired, Portal mutation
is deferred until a second reviewed plan/apply cycle.

Required environment:
  NODE_ENV=production
  STRIPE_ALLOW_LIVE=true
  STRIPE_LIVE_SETUP_APPROVED=true
  STRIPE_LIVE_SETUP_SECRET_KEY=sk_live_... or rk_live_...
  STRIPE_ACCOUNT_ID=acct_...
  STRIPE_SUBSCRIPTION_BILLING_ENABLED=false
  STRIPE_CHECKOUT_ENABLED=false
  STRIPE_AUTOMATIC_TAX_ENABLED=false
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      "allow-live-read-only": { type: "boolean", default: false },
      "allow-live-apply": { type: "boolean", default: false },
      "confirm-account": { type: "string" },
      "confirm-price-book": { type: "string" },
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
  const authorization = authorizeStripeLiveSetup({
    env: process.env,
    flags: {
      apply: values.apply,
      allowLiveReadOnly: values["allow-live-read-only"],
      allowLiveApply: values["allow-live-apply"],
      confirmAccount: values["confirm-account"],
      confirmPriceBook: values["confirm-price-book"],
    },
  });
  const stripe = new Stripe(authorization.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    appInfo: { name: "TryHabla Explicit Live Setup", version: "1" },
    maxNetworkRetries: 2,
    telemetry: false,
    timeout: 30_000,
  });
  const result = await runStripeLiveSetup({ stripe, authorization });
  printResult(authorization, result);
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    const message =
      error instanceof Error ? error.message : "Unknown live Stripe setup failure.";
    console.error(`ERROR: ${message}`);
    process.exitCode = 1;
  });
}

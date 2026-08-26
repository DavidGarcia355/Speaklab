import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";
import {
  STRIPE_PORTAL_CONFIGURATION_MANIFEST,
  StripePortalValidationError,
  assertStripePortalConfigurationContract,
  normalizeStripePortalConfiguration,
  type StripePortalReadConfiguration,
} from "@/lib/billing/portal-validation";
import { STRIPE_API_VERSION, type StripeKeyMode } from "@/lib/billing/config";
import {
  assertExactCardOnlyPaymentMethodConfiguration,
  assertStripeSetupAccount,
  assertStripeSetupAccountId,
  normalizeStripePaymentMethodConfiguration,
  type StripePaymentMethodConfigurationRecord,
} from "@/scripts/stripe-payment-methods-setup";

export type StripePortalSetupClient = Readonly<{
  retrieveAccountId(): Promise<string>;
  retrievePaymentMethodConfiguration(
    configurationId: string,
  ): Promise<StripePaymentMethodConfigurationRecord>;
  retrieveConfiguration(configurationId: string): Promise<StripePortalReadConfiguration>;
  listActiveConfigurations(): Promise<readonly StripePortalReadConfiguration[]>;
  createConfiguration(
    params: Stripe.BillingPortal.ConfigurationCreateParams,
    idempotencyKey: string,
  ): Promise<StripePortalReadConfiguration>;
}>;

export type StripePortalSetupResult = Readonly<{
  action: "create" | "unchanged";
  applied: boolean;
  configurationId: string | null;
}>;

export function assertStripePortalTestKey(value: string | undefined) {
  const key = value?.trim();
  if (!key) {
    throw new Error("STRIPE_TEST_SECRET_KEY is required for Portal setup.");
  }
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    throw new Error("Refusing to use a live Stripe key. Portal setup is test-mode only.");
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

export function buildStripePortalConfigurationCreateParams(
  paymentMethodConfigurationId: string,
): Stripe.BillingPortal.ConfigurationCreateParams {
  const manifest = STRIPE_PORTAL_CONFIGURATION_MANIFEST;
  const normalizedPaymentMethodConfigurationId = paymentMethodConfigurationId.trim();
  if (!normalizedPaymentMethodConfigurationId.startsWith("pmc_")) {
    throw new Error("A Stripe pmc_ Payment Method Configuration ID is required.");
  }
  return {
    name: manifest.name,
    default_return_url: manifest.defaultReturnUrl,
    business_profile: {
      headline: manifest.businessProfile.headline,
      privacy_policy_url: manifest.businessProfile.privacyPolicyUrl,
      terms_of_service_url: manifest.businessProfile.termsOfServiceUrl,
    },
    login_page: { enabled: manifest.loginPageEnabled },
    metadata: { ...manifest.metadata },
    features: {
      customer_update: {
        enabled: manifest.customerUpdateEnabled,
        allowed_updates: [...manifest.customerUpdateAllowedUpdates],
      },
      invoice_history: { enabled: manifest.invoiceHistoryEnabled },
      payment_method_update: {
        enabled: manifest.paymentMethodUpdateEnabled,
        payment_method_configuration: normalizedPaymentMethodConfigurationId,
      },
      subscription_cancel: {
        enabled: manifest.subscriptionCancel.enabled,
        mode: manifest.subscriptionCancel.mode,
        proration_behavior: manifest.subscriptionCancel.prorationBehavior,
      },
      subscription_update: { enabled: manifest.subscriptionUpdateEnabled },
    },
  };
}

export function buildStripePortalConfigurationIdempotencyKey(
  keyMode: StripeKeyMode,
  paymentMethodConfigurationId: string,
) {
  const params = buildStripePortalConfigurationCreateParams(
    paymentMethodConfigurationId,
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        keyMode,
        schemaVersion: STRIPE_PORTAL_CONFIGURATION_MANIFEST.schemaVersion,
        params,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `habla:${keyMode}:portal-configuration:v${STRIPE_PORTAL_CONFIGURATION_MANIFEST.schemaVersion}:${fingerprint}`;
}

function configurationIsExact(
  configuration: StripePortalReadConfiguration,
  keyMode: StripeKeyMode,
  paymentMethodConfigurationId: string,
) {
  try {
    assertStripePortalConfigurationContract(configuration, {
      configurationId: configuration.id,
      keyMode,
      paymentMethodConfigurationId,
    });
    return true;
  } catch (error) {
    if (error instanceof StripePortalValidationError) return false;
    throw error;
  }
}

export async function reconcileStripePortalConfiguration(input: Readonly<{
  client: StripePortalSetupClient;
  keyMode: StripeKeyMode;
  accountId: string;
  paymentMethodConfigurationId: string;
  apply: boolean;
  allowLiveProvisioning?: boolean;
}>): Promise<StripePortalSetupResult> {
  if (input.keyMode === "live" && input.allowLiveProvisioning !== true) {
    throw new Error(
      "Refusing to provision a live Stripe Portal configuration without explicit authorization.",
    );
  }
  await assertStripeSetupAccount(input.client, input.accountId);
  const paymentMethodConfiguration =
    await input.client.retrievePaymentMethodConfiguration(
      input.paymentMethodConfigurationId,
    );
  assertExactCardOnlyPaymentMethodConfiguration(
    paymentMethodConfiguration,
    input.keyMode,
  );
  const configurations = await input.client.listActiveConfigurations();
  for (const configuration of configurations) {
    if (configuration.livemode !== (input.keyMode === "live")) {
      throw new Error(
        `Refusing Portal configuration ${configuration.id}: Stripe returned a ${configuration.livemode ? "live" : "test"}-mode resource during ${input.keyMode}-mode provisioning.`,
      );
    }
  }
  const existing = configurations
    .filter((configuration) =>
      configurationIsExact(
        configuration,
        input.keyMode,
        input.paymentMethodConfigurationId,
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (existing) {
    return Object.freeze({
      action: "unchanged",
      applied: false,
      configurationId: existing.id,
    });
  }
  if (!input.apply) {
    return Object.freeze({ action: "create", applied: false, configurationId: null });
  }

  const created = await input.client.createConfiguration(
    buildStripePortalConfigurationCreateParams(input.paymentMethodConfigurationId),
    buildStripePortalConfigurationIdempotencyKey(
      input.keyMode,
      input.paymentMethodConfigurationId,
    ),
  );
  const verified = await input.client.retrieveConfiguration(created.id);
  assertStripePortalConfigurationContract(verified, {
    configurationId: created.id,
    keyMode: input.keyMode,
    paymentMethodConfigurationId: input.paymentMethodConfigurationId,
  });
  return Object.freeze({
    action: "create",
    applied: true,
    configurationId: verified.id,
  });
}

export class StripeSdkPortalSetupClient implements StripePortalSetupClient {
  constructor(private readonly stripe: Stripe) {}

  async retrieveAccountId() {
    return (await this.stripe.accounts.retrieve(null)).id;
  }

  async retrievePaymentMethodConfiguration(configurationId: string) {
    return normalizeStripePaymentMethodConfiguration(
      await this.stripe.paymentMethodConfigurations.retrieve(configurationId),
    );
  }

  async retrieveConfiguration(configurationId: string) {
    return normalizeStripePortalConfiguration(
      await this.stripe.billingPortal.configurations.retrieve(configurationId),
    );
  }

  async listActiveConfigurations() {
    const configurations: StripePortalReadConfiguration[] = [];
    for await (const configuration of this.stripe.billingPortal.configurations.list({
      active: true,
      limit: 100,
    })) {
      configurations.push(normalizeStripePortalConfiguration(configuration));
    }
    return configurations;
  }

  async createConfiguration(
    params: Stripe.BillingPortal.ConfigurationCreateParams,
    idempotencyKey: string,
  ) {
    return normalizeStripePortalConfiguration(
      await this.stripe.billingPortal.configurations.create(params, { idempotencyKey }),
    );
  }
}

function printHelp() {
  console.log(`Usage: npx tsx scripts/stripe-portal-setup.ts [--apply]

Finds or provisions Habla's exact Customer Portal configuration in Stripe test/sandbox mode.
The command is a read-only plan unless --apply is present. Live keys are always rejected.

Environment:
  STRIPE_TEST_SECRET_KEY   Required sk_test_, rk_test_, or rkcs_test_ key.
  STRIPE_ACCOUNT_ID        Required exact acct_ ID for the same sandbox.
  STRIPE_TEST_PAYMENT_METHOD_CONFIGURATION_ID
                           Required exact card-only pmc_ configuration created
                           by stripe:payment-methods:test:apply.
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
  const secretKey = assertStripePortalTestKey(process.env.STRIPE_TEST_SECRET_KEY);
  const accountId = assertStripeSetupAccountId(process.env.STRIPE_ACCOUNT_ID);
  const paymentMethodConfigurationId =
    process.env.STRIPE_TEST_PAYMENT_METHOD_CONFIGURATION_ID?.trim() ?? "";
  if (!paymentMethodConfigurationId.startsWith("pmc_")) {
    throw new Error(
      "STRIPE_TEST_PAYMENT_METHOD_CONFIGURATION_ID must be the exact card-only pmc_ configuration.",
    );
  }
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    appInfo: { name: "Habla Portal Setup", version: "1" },
    maxNetworkRetries: 2,
    telemetry: false,
    timeout: 30_000,
  });
  const result = await reconcileStripePortalConfiguration({
    client: new StripeSdkPortalSetupClient(stripe),
    keyMode: "test",
    accountId,
    paymentMethodConfigurationId,
    apply: values.apply,
  });
  console.log(`Stripe Portal configuration: ${result.action}`);
  console.log(`Applied: ${result.applied ? "yes" : "no"}`);
  if (result.configurationId) {
    console.log(`STRIPE_PORTAL_CONFIGURATION_ID=${result.configurationId}`);
  } else {
    console.log("Run again with --apply to create the test configuration and print its bpc_ ID.");
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown Stripe Portal setup failure.";
    console.error(`ERROR: ${message}`);
    process.exitCode = 1;
  });
}

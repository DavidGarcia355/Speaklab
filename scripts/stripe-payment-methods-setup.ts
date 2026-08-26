import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";
import { STRIPE_API_VERSION, type StripeKeyMode } from "@/lib/billing/config";

export const STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME =
  "Habla card-only teacher billing v1";

export type StripePaymentMethodConfigurationRecord = Readonly<{
  id: string;
  name: string;
  active: boolean;
  livemode: boolean;
  cardAvailable: boolean;
  methodPreferences: Readonly<Record<string, string>>;
}>;

export type StripePaymentMethodConfigurationSetupClient = Readonly<{
  retrieveAccountId(): Promise<string>;
  listConfigurations(): Promise<readonly StripePaymentMethodConfigurationRecord[]>;
  createConfiguration(
    params: Stripe.PaymentMethodConfigurationCreateParams,
    idempotencyKey: string,
  ): Promise<StripePaymentMethodConfigurationRecord>;
  updateConfiguration(
    configurationId: string,
    params: Stripe.PaymentMethodConfigurationUpdateParams,
  ): Promise<StripePaymentMethodConfigurationRecord>;
}>;

export type StripePaymentMethodConfigurationSetupResult = Readonly<{
  action: "create" | "update" | "unchanged";
  applied: boolean;
  configurationId: string | null;
}>;

export function assertStripePaymentMethodsTestKey(value: string | undefined) {
  const key = value?.trim();
  if (!key) {
    throw new Error(
      "STRIPE_TEST_SECRET_KEY is required for Payment Method Configuration setup.",
    );
  }
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    throw new Error(
      "Refusing to use a live Stripe key. Payment Method Configuration setup is test-mode only.",
    );
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

export function assertStripeSetupAccountId(value: string | undefined) {
  const accountId = value?.trim();
  if (!accountId?.startsWith("acct_")) {
    throw new Error("STRIPE_ACCOUNT_ID must be the exact Stripe acct_ ID.");
  }
  return accountId;
}

export async function assertStripeSetupAccount(
  client: Pick<StripePaymentMethodConfigurationSetupClient, "retrieveAccountId">,
  expectedAccountId: string,
) {
  const normalizedExpectedAccountId = assertStripeSetupAccountId(expectedAccountId);
  let actualAccountId: string;
  try {
    actualAccountId = (await client.retrieveAccountId()).trim();
  } catch {
    throw new Error("Could not verify the Stripe account identity.");
  }
  if (actualAccountId !== normalizedExpectedAccountId) {
    throw new Error(
      "Stripe account mismatch. Refusing to inspect or mutate Stripe setup resources.",
    );
  }
  return actualAccountId;
}

export function normalizeStripePaymentMethodConfiguration(
  configuration: Stripe.PaymentMethodConfiguration,
): StripePaymentMethodConfigurationRecord {
  const methodPreferences = Object.fromEntries(
    Object.entries(configuration)
      .flatMap(([name, value]) => {
        if (!value || typeof value !== "object") return [];
        if (!("available" in value) && !("display_preference" in value)) return [];
        if (!("display_preference" in value)) return [[name, "<missing>"]];
        const displayPreference = value.display_preference;
        if (!displayPreference || typeof displayPreference !== "object") {
          return [[name, "<missing>"]];
        }
        if (!("value" in displayPreference)) return [[name, "<missing>"]];
        return [[name, String(displayPreference.value)]];
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return Object.freeze({
    id: configuration.id,
    name: configuration.name,
    active: configuration.active,
    livemode: configuration.livemode,
    cardAvailable: configuration.card?.available === true,
    methodPreferences: Object.freeze(methodPreferences),
  });
}

export function assertExactCardOnlyPaymentMethodConfiguration(
  configuration: StripePaymentMethodConfigurationRecord,
  keyMode: StripeKeyMode,
) {
  if (configuration.livemode !== (keyMode === "live")) {
    throw new Error(
      `Stripe returned a ${configuration.livemode ? "live" : "test"}-mode Payment Method Configuration during ${keyMode}-mode setup.`,
    );
  }
  if (
    configuration.name !== STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME ||
    configuration.active !== true ||
    configuration.cardAvailable !== true ||
    configuration.methodPreferences.card !== "on" ||
    Object.entries(configuration.methodPreferences).some(
      ([method, preference]) => method !== "card" && preference !== "off",
    )
  ) {
    throw new Error("Stripe Payment Method Configuration is not the exact card-only contract.");
  }
  return configuration;
}

export function buildStripeCardOnlyConfigurationCreateParams(): Stripe.PaymentMethodConfigurationCreateParams {
  return {
    name: STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME,
    card: { display_preference: { preference: "on" } },
  };
}

export function buildStripeCardOnlyConfigurationUpdateParams(
  configuration: StripePaymentMethodConfigurationRecord,
): Stripe.PaymentMethodConfigurationUpdateParams {
  const params: Record<string, unknown> = {
    active: true,
    name: STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME,
  };
  const methodNames = new Set([
    "card",
    ...Object.keys(configuration.methodPreferences),
  ]);
  for (const method of [...methodNames].sort()) {
    params[method] = {
      display_preference: { preference: method === "card" ? "on" : "off" },
    };
  }
  return params as Stripe.PaymentMethodConfigurationUpdateParams;
}

function configurationIsExact(
  configuration: StripePaymentMethodConfigurationRecord,
  keyMode: StripeKeyMode,
) {
  try {
    assertExactCardOnlyPaymentMethodConfiguration(configuration, keyMode);
    return true;
  } catch {
    return false;
  }
}

function assertConfigurationMode(
  configuration: StripePaymentMethodConfigurationRecord,
  keyMode: StripeKeyMode,
) {
  if (configuration.livemode !== (keyMode === "live")) {
    throw new Error(
      `Refusing Payment Method Configuration ${configuration.id}: Stripe returned a ${configuration.livemode ? "live" : "test"}-mode resource during ${keyMode}-mode provisioning.`,
    );
  }
}

function paymentMethodConfigurationIdempotencyKey(keyMode: StripeKeyMode) {
  return keyMode === "live"
    ? "habla:live:payment-method-configuration:card-only:v1"
    : "habla:payment-method-configuration:card-only:v1";
}

export async function reconcileStripePaymentMethodConfiguration(input: Readonly<{
  client: StripePaymentMethodConfigurationSetupClient;
  keyMode: StripeKeyMode;
  accountId: string;
  apply: boolean;
  allowLiveProvisioning?: boolean;
}>): Promise<StripePaymentMethodConfigurationSetupResult> {
  if (input.keyMode === "live" && input.allowLiveProvisioning !== true) {
    throw new Error(
      "Refusing to provision a live Stripe Payment Method Configuration without explicit authorization.",
    );
  }
  await assertStripeSetupAccount(input.client, input.accountId);

  const configurations = await input.client.listConfigurations();
  configurations.forEach((configuration) =>
    assertConfigurationMode(configuration, input.keyMode),
  );
  const namedConfigurations = configurations
    .filter(
      (configuration) =>
        configuration.name === STRIPE_CARD_ONLY_PAYMENT_METHOD_CONFIGURATION_NAME,
    )
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
  const exact = namedConfigurations.filter((configuration) =>
    configurationIsExact(configuration, input.keyMode),
  )[0];
  if (exact) {
    return Object.freeze({
      action: "unchanged",
      applied: false,
      configurationId: exact.id,
    });
  }

  const candidate = namedConfigurations[0];
  const action = candidate ? "update" : "create";
  if (!input.apply) {
    return Object.freeze({
      action,
      applied: false,
      configurationId: candidate?.id ?? null,
    });
  }

  const initial = candidate
    ? candidate
    : await input.client.createConfiguration(
        buildStripeCardOnlyConfigurationCreateParams(),
        paymentMethodConfigurationIdempotencyKey(input.keyMode),
      );
  assertConfigurationMode(initial, input.keyMode);
  const reconciled = configurationIsExact(initial, input.keyMode)
    ? initial
    : await input.client.updateConfiguration(
        initial.id,
        buildStripeCardOnlyConfigurationUpdateParams(initial),
      );
  assertConfigurationMode(reconciled, input.keyMode);
  assertExactCardOnlyPaymentMethodConfiguration(reconciled, input.keyMode);
  return Object.freeze({
    action,
    applied: true,
    configurationId: reconciled.id,
  });
}

export class StripeSdkPaymentMethodConfigurationSetupClient
  implements StripePaymentMethodConfigurationSetupClient
{
  constructor(private readonly stripe: Stripe) {}

  async retrieveAccountId() {
    return (await this.stripe.accounts.retrieve(null)).id;
  }

  async listConfigurations() {
    const configurations: StripePaymentMethodConfigurationRecord[] = [];
    for await (const configuration of this.stripe.paymentMethodConfigurations.list({
      limit: 100,
    })) {
      configurations.push(normalizeStripePaymentMethodConfiguration(configuration));
    }
    return configurations;
  }

  async createConfiguration(
    params: Stripe.PaymentMethodConfigurationCreateParams,
    idempotencyKey: string,
  ) {
    return normalizeStripePaymentMethodConfiguration(
      await this.stripe.paymentMethodConfigurations.create(params, { idempotencyKey }),
    );
  }

  async updateConfiguration(
    configurationId: string,
    params: Stripe.PaymentMethodConfigurationUpdateParams,
  ) {
    return normalizeStripePaymentMethodConfiguration(
      await this.stripe.paymentMethodConfigurations.update(configurationId, params),
    );
  }
}

function printHelp() {
  console.log(`Usage: npx tsx scripts/stripe-payment-methods-setup.ts [--apply]

Finds or provisions Habla's exact active card-only Payment Method Configuration in
Stripe test/sandbox mode. The command is a read-only plan unless --apply is present.
Live keys and live resources are always rejected.

Environment:
  STRIPE_TEST_SECRET_KEY   Required sk_test_, rk_test_, or rkcs_test_ key.
  STRIPE_ACCOUNT_ID        Required exact acct_ ID for the same sandbox.
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
  const secretKey = assertStripePaymentMethodsTestKey(
    process.env.STRIPE_TEST_SECRET_KEY,
  );
  const accountId = assertStripeSetupAccountId(process.env.STRIPE_ACCOUNT_ID);
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    appInfo: { name: "Habla Payment Method Setup", version: "1" },
    maxNetworkRetries: 2,
    telemetry: false,
    timeout: 30_000,
  });
  const result = await reconcileStripePaymentMethodConfiguration({
    client: new StripeSdkPaymentMethodConfigurationSetupClient(stripe),
    keyMode: "test",
    accountId,
    apply: values.apply,
  });
  console.log(`Stripe Payment Method Configuration: ${result.action}`);
  console.log(`Applied: ${result.applied ? "yes" : "no"}`);
  if (result.configurationId) {
    console.log(
      `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID=${result.configurationId}`,
    );
    console.log(
      `STRIPE_TEST_PAYMENT_METHOD_CONFIGURATION_ID=${result.configurationId}`,
    );
  } else {
    console.log(
      "Run again with --apply to create the sandbox configuration and print its pmc_ ID.",
    );
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown Stripe Payment Method Configuration setup failure.";
    console.error(`ERROR: ${message}`);
    process.exitCode = 1;
  });
}

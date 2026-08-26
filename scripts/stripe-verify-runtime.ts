import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import {
  StripeCatalogValidationError,
  assertConfiguredStripeCatalog,
} from "@/lib/billing/catalog-validation";
import { requireStripeCatalogConfig } from "@/lib/billing/config";

export function assertLiveReadOnlyPermission(
  keyMode: "test" | "live",
  allowLiveReadOnly: boolean,
) {
  if (keyMode === "live" && !allowLiveReadOnly) {
    throw new Error(
      "Refusing to read the live Stripe catalog without --allow-live-read-only.",
    );
  }
}

function printHelp() {
  console.log(`Usage: npx tsx scripts/stripe-verify-runtime.ts [--allow-live-read-only]

Verifies Habla's configured Stripe account and exact catalog before usage billing is enabled.
This command is read-only and never creates, changes, or deletes Stripe resources.

Live mode also requires the application's NODE_ENV=production and
STRIPE_ALLOW_LIVE=true guards plus the explicit --allow-live-read-only option.
`);
}

export async function verifyStripeRuntime(input: {
  env?: Readonly<Record<string, string | undefined>>;
  allowLiveReadOnly: boolean;
}) {
  const config = requireStripeCatalogConfig(input.env ?? process.env);
  assertLiveReadOnlyPermission(config.keyMode, input.allowLiveReadOnly);
  return assertConfiguredStripeCatalog(config, { cache: false });
}

async function main() {
  const { values } = parseArgs({
    options: {
      "allow-live-read-only": { type: "boolean", default: false },
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
  const result = await verifyStripeRuntime({
    allowLiveReadOnly: values["allow-live-read-only"],
  });
  console.log("Stripe catalog preflight: ready");
  console.log(`Mode: ${result.keyMode}`);
  console.log(`Price book: ${result.priceBookId}`);
  console.log(`Fingerprint: ${result.fingerprint}`);
  console.log(`Checked at: ${result.checkedAt}`);
  console.log("No Stripe resources were changed.");
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    const message =
      error instanceof StripeCatalogValidationError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Unknown Stripe verification failure.";
    console.error(`ERROR: ${message}`);
    process.exitCode = 1;
  });
}

import Stripe from "stripe";
import {
  requireStripeClientConfig,
  type StripeClientConfig,
} from "@/lib/billing/config";

let cachedClient: { secretKey: string; apiVersion: string; client: Stripe } | null = null;

/** Constructs the SDK client from the narrow credential config only when Stripe is needed. */
export function getStripeClient(config: StripeClientConfig = requireStripeClientConfig()) {
  if (
    cachedClient?.secretKey === config.secretKey &&
    cachedClient.apiVersion === config.apiVersion
  ) {
    return cachedClient.client;
  }

  const client = new Stripe(config.secretKey, {
    apiVersion: config.apiVersion,
    typescript: true,
    appInfo: {
      name: "Habla",
      version: "1",
    },
    maxNetworkRetries: 2,
    telemetry: false,
    timeout: 10_000,
  });
  cachedClient = { secretKey: config.secretKey, apiVersion: config.apiVersion, client };
  return client;
}

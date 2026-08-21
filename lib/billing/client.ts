import Stripe from "stripe";
import {
  STRIPE_API_VERSION,
  requireStripeBillingConfig,
  type StripeBillingConfig,
} from "@/lib/billing/config";

let cachedClient: { secretKey: string; client: Stripe } | null = null;

/** Constructs the SDK client only when a server billing operation actually needs it. */
export function getStripeClient(config: StripeBillingConfig = requireStripeBillingConfig()) {
  if (cachedClient?.secretKey === config.secretKey) return cachedClient.client;

  const client = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    appInfo: {
      name: "Habla",
      version: "1",
    },
  });
  cachedClient = { secretKey: config.secretKey, client };
  return client;
}

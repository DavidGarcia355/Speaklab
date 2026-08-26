import { createHash } from "node:crypto";
import { getStripeClient } from "@/lib/billing/client";
import type { StripeClientConfig } from "@/lib/billing/config";

export interface StripeAccountReadClient {
  retrieveAccountId(): Promise<string>;
}

export type StripeAccountValidationErrorCode =
  | "stripe_account_read_failed"
  | "stripe_account_mismatch";

export class StripeAccountValidationError extends Error {
  readonly code: StripeAccountValidationErrorCode;

  constructor(code: StripeAccountValidationErrorCode) {
    super(
      code === "stripe_account_read_failed"
        ? "Stripe account identity could not be verified."
        : "Stripe credential account does not match STRIPE_ACCOUNT_ID.",
    );
    this.name = "StripeAccountValidationError";
    this.code = code;
  }
}

export type StripeAccountValidationResult = Readonly<{
  valid: true;
  cached: boolean;
  checkedAt: string;
  accountId: string;
}>;

export type AssertConfiguredStripeAccountOptions = Readonly<{
  client?: StripeAccountReadClient;
  cache?: boolean;
  cacheTtlMs?: number;
  now?: () => number;
}>;

const DEFAULT_SUCCESS_CACHE_TTL_MS = 60_000;
const MAX_SUCCESS_CACHE_TTL_MS = 300_000;
const MAX_CACHE_ENTRIES = 32;

const successfulValidations = new Map<
  string,
  { expiresAt: number; result: StripeAccountValidationResult }
>();

function createReadClient(config: StripeClientConfig): StripeAccountReadClient {
  const stripe = getStripeClient(config);
  return {
    async retrieveAccountId() {
      const account = await stripe.accounts.retrieve(null);
      return account.id;
    },
  };
}

function cacheKey(config: StripeClientConfig) {
  return createHash("sha256")
    .update(
      [config.secretKey, config.apiVersion, config.keyMode, config.accountId].join("\0"),
    )
    .digest("hex");
}

function pruneCache(now: number) {
  for (const [key, entry] of successfulValidations) {
    if (entry.expiresAt <= now) successfulValidations.delete(key);
  }
  while (successfulValidations.size >= MAX_CACHE_ENTRIES) {
    const oldest = successfulValidations.keys().next().value as string | undefined;
    if (!oldest) break;
    successfulValidations.delete(oldest);
  }
}

/** Verifies that the configured credential belongs to the explicitly pinned Stripe account. */
export async function assertConfiguredStripeAccount(
  config: StripeClientConfig,
  options: AssertConfiguredStripeAccountOptions = {},
): Promise<StripeAccountValidationResult> {
  const now = options.now?.() ?? Date.now();
  const useCache = options.cache !== false;
  const key = cacheKey(config);
  if (useCache) {
    const cached = successfulValidations.get(key);
    if (cached && cached.expiresAt > now) {
      return Object.freeze({ ...cached.result, cached: true });
    }
  }

  let remoteAccountId: string;
  try {
    remoteAccountId = (await (options.client ?? createReadClient(config)).retrieveAccountId()).trim();
  } catch {
    throw new StripeAccountValidationError("stripe_account_read_failed");
  }
  if (remoteAccountId !== config.accountId) {
    throw new StripeAccountValidationError("stripe_account_mismatch");
  }

  const result: StripeAccountValidationResult = Object.freeze({
    valid: true,
    cached: false,
    checkedAt: new Date(now).toISOString(),
    accountId: config.accountId,
  });
  if (useCache) {
    pruneCache(now);
    const requestedTtl = options.cacheTtlMs ?? DEFAULT_SUCCESS_CACHE_TTL_MS;
    const cacheTtlMs = Math.max(1, Math.min(requestedTtl, MAX_SUCCESS_CACHE_TTL_MS));
    successfulValidations.set(key, { expiresAt: now + cacheTtlMs, result });
  }
  return result;
}

export function clearStripeAccountValidationCacheForTests() {
  successfulValidations.clear();
}

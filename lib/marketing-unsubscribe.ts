import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@libsql/client";

function createDbClient() {
  const url = process.env.TURSO_DATABASE_URL?.trim() || "";
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || "";

  if (!url || !authToken) {
    throw new Error("Marketing unsubscribe storage requires Turso configuration.");
  }

  return createClient({ url, authToken });
}

function getSigningSecret() {
  const secret =
    process.env.MARKETING_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "";
  if (!secret) throw new Error("Marketing unsubscribe signing secret is not configured.");
  return secret;
}

const db = createDbClient();
let initPromise: Promise<void> | null = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = db
      .execute(`CREATE TABLE IF NOT EXISTS marketing_email_unsubscribes (
        email TEXT PRIMARY KEY COLLATE NOCASE,
        unsubscribed_at INTEGER NOT NULL
      )`)
      .then(() => undefined)
      .catch((error) => {
        initPromise = null;
        throw error;
      });
  }
  await initPromise;
}

export function normalizeMarketingEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isReasonableEmail(value: string) {
  const email = normalizeMarketingEmail(value);
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function createMarketingUnsubscribeToken(emailInput: string) {
  const email = normalizeMarketingEmail(emailInput);
  if (!isReasonableEmail(email)) throw new Error("invalid_email");
  return createHmac("sha256", getSigningSecret())
    .update(`tryhabla-marketing-unsubscribe-v1:${email}`)
    .digest("base64url");
}

export function verifyMarketingUnsubscribeToken(emailInput: string, tokenInput: string) {
  const email = normalizeMarketingEmail(emailInput);
  const token = tokenInput.trim();
  if (!isReasonableEmail(email) || !token) return false;

  const expected = createMarketingUnsubscribeToken(email);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(token);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function createMarketingUnsubscribeUrl(emailInput: string) {
  const email = normalizeMarketingEmail(emailInput);
  const token = createMarketingUnsubscribeToken(email);
  const params = new URLSearchParams({ email, token });
  return `https://tryhabla.com/unsubscribe?${params.toString()}`;
}

export function createMarketingOneClickUnsubscribeUrl(emailInput: string) {
  const email = normalizeMarketingEmail(emailInput);
  const token = createMarketingUnsubscribeToken(email);
  const params = new URLSearchParams({ email, token });
  return `https://tryhabla.com/api/email/unsubscribe?${params.toString()}`;
}

export async function unsubscribeMarketingEmail(emailInput: string) {
  const email = normalizeMarketingEmail(emailInput);
  if (!isReasonableEmail(email)) throw new Error("invalid_email");

  await ensureInitialized();
  await db.execute({
    sql: `INSERT INTO marketing_email_unsubscribes (email, unsubscribed_at)
      VALUES (?, ?)
      ON CONFLICT(email) DO UPDATE SET unsubscribed_at = excluded.unsubscribed_at`,
    args: [email, Date.now()],
  });

  return { email };
}

export async function isMarketingEmailUnsubscribed(emailInput: string) {
  const email = normalizeMarketingEmail(emailInput);
  if (!isReasonableEmail(email)) return false;

  await ensureInitialized();
  const result = await db.execute({
    sql: "SELECT 1 FROM marketing_email_unsubscribes WHERE email = ? LIMIT 1",
    args: [email],
  });
  return result.rows.length > 0;
}

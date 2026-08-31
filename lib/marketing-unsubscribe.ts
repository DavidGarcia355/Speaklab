import "server-only";

import { createClient } from "@libsql/client";

function createDbClient() {
  const url = process.env.TURSO_DATABASE_URL?.trim() || "";
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || "";

  if (!url || !authToken) {
    throw new Error("Marketing unsubscribe storage requires Turso configuration.");
  }

  return createClient({ url, authToken });
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

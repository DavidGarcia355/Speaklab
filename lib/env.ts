import "server-only";

type EnvConfig = {
  authGoogleId: string;
  authGoogleSecret: string;
  authSecret: string;
  teacherEmails: Set<string>;
  tursoDatabaseUrl: string;
  tursoAuthToken: string;
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
  cronSecret: string;
  productionOrigin: string;
  isDev: boolean;
};

let cachedEnv: EnvConfig | null = null;

function normalizeOrigin(input: string) {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

export function getEnv() {
  if (cachedEnv) return cachedEnv;
  const isDev = process.env.NODE_ENV !== "production";

  const required = [
    "AUTH_GOOGLE_ID",
    "AUTH_GOOGLE_SECRET",
    "AUTH_SECRET",
    "TEACHER_EMAILS",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "BLOB_READ_WRITE_TOKEN",
    "CRON_SECRET",
  ] as const;

  const missing = required.filter((key) => !process.env[key] || !process.env[key]?.trim());
  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(", ")}`;
    console.error(message);
    throw new Error(message);
  }

  const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL?.trim() ?? "";
  const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim() ?? "";
  if (tursoDatabaseUrl || tursoAuthToken) {
    if (!tursoDatabaseUrl || !tursoAuthToken) {
      throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must both be set together.");
    }
  } else if (!isDev) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required in production.");
  }

  const teacherEmails = new Set(
    process.env.TEACHER_EMAILS!.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  if (teacherEmails.size === 0) {
    throw new Error("TEACHER_EMAILS must include at least one email.");
  }

  const productionOriginRaw =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
  if (!productionOriginRaw && !isDev) {
    throw new Error(
      "NEXTAUTH_URL or VERCEL_PROJECT_PRODUCTION_URL must be set for production CORS validation."
    );
  }

  cachedEnv = {
    authGoogleId: process.env.AUTH_GOOGLE_ID!.trim(),
    authGoogleSecret: process.env.AUTH_GOOGLE_SECRET!.trim(),
    authSecret: process.env.AUTH_SECRET!.trim(),
    teacherEmails,
    tursoDatabaseUrl,
    tursoAuthToken,
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL!.trim(),
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN!.trim(),
    cronSecret: process.env.CRON_SECRET!.trim(),
    productionOrigin: normalizeOrigin((productionOriginRaw || "http://127.0.0.1:3000").trim()),
    isDev,
  };

  return cachedEnv;
}

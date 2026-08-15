import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

export const DEFAULT_SUBMISSION_LIMIT_PER_HOUR = 120;
export const DEFAULT_AUTH_LIMIT_PER_HOUR = 250;
export const DEFAULT_GRADEBOOK_LIMIT_PER_HOUR = 30;

function limiter(prefix: string, limit: number) {
  const redis = Redis.fromEnv();
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, "1 h"),
    prefix,
  });
}

let submissionLimiter: Ratelimit | null = null;
let authLimiter: Ratelimit | null = null;
let gradebookLimiter: Ratelimit | null = null;

function parseLimit(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSubmissionLimitPerHour() {
  return parseLimit(process.env.SUBMISSION_RATE_LIMIT_PER_HOUR, DEFAULT_SUBMISSION_LIMIT_PER_HOUR);
}

export function getAuthLimitPerHour() {
  return parseLimit(process.env.AUTH_RATE_LIMIT_PER_HOUR, DEFAULT_AUTH_LIMIT_PER_HOUR);
}

export function getGradebookLimitPerHour() {
  return parseLimit(process.env.GRADEBOOK_RATE_LIMIT_PER_HOUR, DEFAULT_GRADEBOOK_LIMIT_PER_HOUR);
}

async function enforce(
  bucket: "submission" | "auth" | "gradebook",
  key: string,
  message: string
) {
  const env = getEnv();
  if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) {
    if (env.isDev) {
      console.warn("Rate limit backend unavailable in development; skipping limiter.");
      return;
    }
    throw new HttpError(503, "Rate limiting is not configured.");
  }
  const map = {
    submission: (submissionLimiter ??= limiter("rl:submission", getSubmissionLimitPerHour())),
    auth: (authLimiter ??= limiter("rl:auth", getAuthLimitPerHour())),
    gradebook: (gradebookLimiter ??= limiter("rl:gradebook", getGradebookLimitPerHour())),
  } as const;
  try {
    const result = await map[bucket].limit(key);
    if (!result.success) {
      throw new HttpError(429, message);
    }
  } catch (error) {
    // Local development can run without reachable Upstash.
    if (env.isDev) {
      console.warn("Rate limit backend unavailable in development; skipping limiter.", error);
      return;
    }
    throw error;
  }
}

export async function enforceSubmissionRateLimit(studentEmail: string) {
  const limit = getSubmissionLimitPerHour();
  await enforce(
    "submission",
    studentEmail.toLowerCase(),
    `Rate limit exceeded. Maximum ${limit} submissions per hour.`
  );
}

export async function enforceAuthRateLimit(ipAddress: string) {
  const limit = getAuthLimitPerHour();
  await enforce(
    "auth",
    ipAddress,
    `Rate limit exceeded. Maximum ${limit} sign-in attempts per hour.`
  );
}

export async function enforceGradebookRateLimit(teacherEmail: string) {
  const limit = getGradebookLimitPerHour();
  await enforce(
    "gradebook",
    teacherEmail.toLowerCase(),
    `Rate limit exceeded. Maximum ${limit} gradebook exports per hour.`
  );
}

import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

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

async function enforce(
  bucket: "submission" | "auth" | "gradebook",
  key: string,
  message: string
) {
  getEnv();
  const map = {
    submission: (submissionLimiter ??= limiter("rl:submission", 5)),
    auth: (authLimiter ??= limiter("rl:auth", 10)),
    gradebook: (gradebookLimiter ??= limiter("rl:gradebook", 10)),
  } as const;
  const result = await map[bucket].limit(key);
  if (!result.success) {
    throw new HttpError(429, message);
  }
}

export async function enforceSubmissionRateLimit(studentEmail: string) {
  await enforce(
    "submission",
    studentEmail.toLowerCase(),
    "Rate limit exceeded. Maximum 5 submissions per hour."
  );
}

export async function enforceAuthRateLimit(ipAddress: string) {
  await enforce(
    "auth",
    ipAddress,
    "Rate limit exceeded. Maximum 10 sign-in attempts per hour."
  );
}

export async function enforceGradebookRateLimit(teacherEmail: string) {
  await enforce(
    "gradebook",
    teacherEmail.toLowerCase(),
    "Rate limit exceeded. Maximum 10 gradebook exports per hour."
  );
}

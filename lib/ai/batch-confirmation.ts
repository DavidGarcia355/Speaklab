import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 10 * 60 * 1_000;

export type AiBatchConfirmationScope = {
  assignmentId: string;
  assignmentFingerprint: string;
  submissionIds: string[];
  eligibleCount: number;
  newUnitsRequired: number;
  transcriptsRequired: number;
};

type SignedScope = AiBatchConfirmationScope & {
  version: typeof TOKEN_VERSION;
  teacherEmail: string;
  expiresAt: number;
};

function signingSecret() {
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  if (secret.length < 16) {
    throw new Error("AI batch confirmation signing is not configured.");
  }
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function validScope(value: unknown): value is SignedScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<SignedScope>;
  return (
    scope.version === TOKEN_VERSION &&
    typeof scope.teacherEmail === "string" &&
    typeof scope.assignmentId === "string" &&
    typeof scope.assignmentFingerprint === "string" &&
    Array.isArray(scope.submissionIds) &&
    scope.submissionIds.every((id) => typeof id === "string" && Boolean(id.trim())) &&
    Number.isSafeInteger(scope.eligibleCount) &&
    Number(scope.eligibleCount) >= 0 &&
    scope.eligibleCount === scope.submissionIds.length &&
    Number.isSafeInteger(scope.newUnitsRequired) &&
    Number(scope.newUnitsRequired) >= 0 &&
    Number(scope.newUnitsRequired) <= Number(scope.eligibleCount) &&
    Number.isSafeInteger(scope.transcriptsRequired) &&
    Number(scope.transcriptsRequired) >= 0 &&
    Number(scope.transcriptsRequired) <= Number(scope.eligibleCount) &&
    typeof scope.expiresAt === "number"
  );
}

export function createAiBatchConfirmationToken(input: {
  teacherEmail: string;
  scope: AiBatchConfirmationScope;
  now?: number;
}) {
  const payload = Buffer.from(
    JSON.stringify({
      version: TOKEN_VERSION,
      teacherEmail: input.teacherEmail.trim().toLowerCase(),
      ...input.scope,
      expiresAt: (input.now ?? Date.now()) + TOKEN_TTL_MS,
    } satisfies SignedScope),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyAiBatchConfirmationToken(input: {
  token: string;
  teacherEmail: string;
  assignmentId: string;
  now?: number;
}): AiBatchConfirmationScope | null {
  const [payload, suppliedSignature, extra] = input.token.trim().split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expectedSignature = signature(payload);
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!validScope(decoded)) return null;
  if (
    decoded.teacherEmail !== input.teacherEmail.trim().toLowerCase() ||
    decoded.assignmentId !== input.assignmentId ||
    decoded.expiresAt < (input.now ?? Date.now())
  ) {
    return null;
  }
  return {
    assignmentId: decoded.assignmentId,
    assignmentFingerprint: decoded.assignmentFingerprint,
    submissionIds: decoded.submissionIds,
    eligibleCount: decoded.eligibleCount,
    newUnitsRequired: decoded.newUnitsRequired,
    transcriptsRequired: decoded.transcriptsRequired,
  };
}

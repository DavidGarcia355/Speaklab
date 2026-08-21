import { createHash } from "node:crypto";
import type { ProviderModelConfig } from "@/lib/grading/contracts";
import { normalizeText } from "@/lib/grading/normalize";

export type GradingCacheHashInput = {
  studentAnswer: string;
  assignmentVersion: string;
  rubricVersion: string;
  promptVersion: string;
  modelConfig: {
    default: ProviderModelConfig;
    escalation?: ProviderModelConfig | null;
    verification?: ProviderModelConfig | null;
  };
  schemaVersion?: string;
};

/**
 * Creates the idempotency/cache identity for a grading decision. Object keys
 * are canonicalized so configuration insertion order cannot cause cache misses.
 */
export function createGradingCacheHash(input: GradingCacheHashInput) {
  const identity = {
    assignmentVersion: input.assignmentVersion,
    modelConfig: input.modelConfig,
    normalizedAnswer: normalizeText(input.studentAnswer),
    promptVersion: input.promptVersion,
    rubricVersion: input.rubricVersion,
    schemaVersion: input.schemaVersion ?? "grading-result-v1",
  };
  return createHash("sha256").update(canonicalStringify(identity), "utf8").digest("hex");
}

export const hashGradingInput = createGradingCacheHash;

export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cache identity cannot contain non-finite numbers.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => typeof record[key] !== "undefined")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Cache identity cannot contain ${typeof value} values.`);
}

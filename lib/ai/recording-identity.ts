import "server-only";

import { createHash } from "node:crypto";
import type { GradingAssignment } from "@/lib/grading/contracts";
import { canonicalStringify } from "@/lib/grading/hash";

function assignmentIdentity(assignment: GradingAssignment) {
  const assignmentId = assignment.id?.trim() ?? "";
  const assignmentVersion = assignment.version.trim();
  if (!assignmentId || !assignmentVersion) return "";
  return canonicalStringify({
    assignmentId,
    assignmentVersion,
    rubricVersion: assignment.rubric?.version.trim() || null,
  });
}

/** Assignment-only identity used for read-only bulk allowance preflight. */
export function processedAssignmentFingerprint(assignment: GradingAssignment) {
  const identity = assignmentIdentity(assignment);
  if (!identity) return "";
  return createHash("sha256")
    .update("ai-assignment-fingerprint-v1\0", "utf8")
    .update(identity, "utf8")
    .digest("hex");
}

/**
 * Stable identity for one teacher-visible processing unit. Keep the v2 prefix
 * and assignment-version inputs unchanged so existing 30/300 allowance rows
 * remain reusable after standalone transcription is introduced.
 */
export function processedRecordingKey(
  buffer: Buffer,
  contentType: string,
  assignment: GradingAssignment,
) {
  const identity = assignmentIdentity(assignment);
  if (!identity) return "";
  return createHash("sha256")
    .update("ai-billing-result-v2\0", "utf8")
    .update(contentType.trim().toLowerCase(), "utf8")
    .update("\0", "utf8")
    .update(identity, "utf8")
    .update("\0", "utf8")
    .update(buffer)
    .digest("hex");
}

export function transcriptCacheKey(
  buffer: Buffer,
  contentType: string,
  provider: string,
  model: string,
) {
  return createHash("sha256")
    .update("transcript-v1\0", "utf8")
    .update(contentType.toLowerCase(), "utf8")
    .update("\0", "utf8")
    .update(provider, "utf8")
    .update("\0", "utf8")
    .update(model, "utf8")
    .update("\0", "utf8")
    .update(buffer)
    .digest("hex");
}

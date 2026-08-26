import "server-only";

import { createHmac } from "node:crypto";

export type AdminAlertIdentityKind = "teacher" | "lead" | "payment";

const REFERENCE_PREFIX: Record<AdminAlertIdentityKind, string> = {
  teacher: "T",
  lead: "L",
  payment: "P",
};

function getReferenceSecret() {
  const secret = process.env.DISCORD_ALERTS_REFERENCE_SECRET?.trim()
    || process.env.AUTH_SECRET?.trim()
    || "";
  if (secret.length < 32) {
    throw new Error("admin_alert_reference_secret_missing");
  }
  return secret;
}

export function deriveAdminAlertIdentity(
  kind: AdminAlertIdentityKind,
  stableValue: string,
): { ref: string; dedupeSubject: string } {
  const normalized = stableValue.trim().toLowerCase();
  if (!normalized || normalized.length > 1_024) {
    throw new Error("admin_alert_identity_source_invalid");
  }
  const digest = createHmac("sha256", getReferenceSecret())
    .update(`tryhabla-admin-alert:${kind}:${normalized}`, "utf8")
    .digest("hex");
  return {
    ref: `${REFERENCE_PREFIX[kind]}-${digest.slice(0, 12).toUpperCase()}`,
    dedupeSubject: `${kind}:${digest}`,
  };
}

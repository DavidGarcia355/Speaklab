import { afterEach, describe, expect, it } from "vitest";
import {
  AdminAlertConfigurationError,
  isAdminAlertDeliveryEnabled,
  resolveAdminAlertsEnvironment,
  validateDiscordWebhookUrl,
} from "@/lib/admin-alerts/config";
import { calculateAdminAlertBackoffMs } from "@/lib/admin-alerts/delivery";
import { parseAdminAlertEvent } from "@/lib/admin-alerts/events";
import { escapeDiscordText, formatAdminAlertForDiscord } from "@/lib/admin-alerts/format";
import { deriveAdminAlertIdentity } from "@/lib/admin-alerts/identity";

const originalReferenceSecret = process.env.DISCORD_ALERTS_REFERENCE_SECRET;
const originalAuthSecret = process.env.AUTH_SECRET;

afterEach(() => {
  if (originalReferenceSecret === undefined) delete process.env.DISCORD_ALERTS_REFERENCE_SECRET;
  else process.env.DISCORD_ALERTS_REFERENCE_SECRET = originalReferenceSecret;
  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalAuthSecret;
});

describe("admin alert configuration", () => {
  it("keeps external delivery disabled unless the kill switch is exactly true", () => {
    expect(isAdminAlertDeliveryEnabled({})).toBe(false);
    expect(isAdminAlertDeliveryEnabled({ DISCORD_ADMIN_ALERTS_ENABLED: "TRUE" })).toBe(false);
    expect(isAdminAlertDeliveryEnabled({ DISCORD_ADMIN_ALERTS_ENABLED: "true" })).toBe(true);
  });

  it("fails closed on a deployment/environment mismatch", () => {
    expect(() => resolveAdminAlertsEnvironment({
      VERCEL_ENV: "preview",
      DISCORD_ALERTS_ENV: "production",
    })).toThrowError(AdminAlertConfigurationError);
    expect(resolveAdminAlertsEnvironment({
      VERCEL_ENV: "preview",
      DISCORD_ALERTS_ENV: "preview",
    })).toBe("preview");
  });

  it("accepts only exact Discord HTTPS webhook origins and paths", () => {
    const valid = "https://discord.com/api/webhooks/12345678901234567/abcdefghijklmnopqrstuvwxyz_ABCD-123456";
    expect(validateDiscordWebhookUrl(valid)).toBe(valid);
    for (const invalid of [
      "http://discord.com/api/webhooks/12345678901234567/abcdefghijklmnopqrstuvwxyz_ABCD-123456",
      "https://discord.com.evil.example/api/webhooks/12345678901234567/abcdefghijklmnopqrstuvwxyz_ABCD-123456",
      "https://discord.com/api/webhooks/12345678901234567/abcdefghijklmnopqrstuvwxyz_ABCD-123456?wait=true",
      "https://discord.com/channels/123/456",
    ]) {
      expect(() => validateDiscordWebhookUrl(invalid)).toThrowError(
        new AdminAlertConfigurationError("webhook_invalid"),
      );
    }
  });
});

describe("admin alert safe contracts", () => {
  it("derives stable opaque references without retaining the source identity", () => {
    process.env.DISCORD_ALERTS_REFERENCE_SECRET = "x".repeat(32);
    const first = deriveAdminAlertIdentity("teacher", "Private.Teacher@example.com");
    const second = deriveAdminAlertIdentity("teacher", "private.teacher@example.com");

    expect(first).toEqual(second);
    expect(first.ref).toMatch(/^T-[A-F0-9]{12}$/);
    expect(first.dedupeSubject).toMatch(/^teacher:[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("private.teacher@example.com");
  });

  it("rejects unknown PII-shaped fields and secret-like incident summaries", () => {
    expect(() => parseAdminAlertEvent({
      type: "teacher.signed_up",
      teacherRef: "T-ABCDEF123456",
      email: "private@example.com",
    })).toThrow();
    expect(() => parseAdminAlertEvent({
      type: "incident",
      code: "provider.failure",
      summary: "Webhook whsec_do-not-send-this failed",
    })).toThrow();
    expect(() => parseAdminAlertEvent({
      type: "school.lead",
      leadRef: "L-ABCDEF123456",
      organizationName: "Example Unified School District",
    })).toThrow();
  });

  it("neutralizes Discord text and configures payloads to reject mentions", () => {
    const escaped = escapeDiscordText("@everyone **North [Star]**");
    expect(escaped).not.toContain("@everyone");
    expect(escaped).toContain("@\u200Beveryone");

    const payload = formatAdminAlertForDiscord({
      event: parseAdminAlertEvent({
        type: "school.lead",
        leadRef: "L-ABCDEF123456",
        requestedCapacity: 400,
        adminPath: "/admin",
      }),
      environment: "preview",
      occurredAt: Date.UTC(2026, 7, 26, 20, 0),
    });
    const serialized = JSON.stringify(payload);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0]?.description).toContain("PREVIEW");
    expect(serialized).not.toContain("@everyone");
    expect(serialized).not.toContain("private@example.com");
  });

  it("formats MRR milestones as dollars and labels time saved as an estimate", () => {
    const mrr = formatAdminAlertForDiscord({
      event: parseAdminAlertEvent({
        type: "milestone.reached",
        metric: "mrr_cents",
        threshold: 100_000,
        currentTotal: 120_000,
      }),
      environment: "production",
      occurredAt: Date.UTC(2026, 7, 26, 20, 0),
    });
    const reviews = formatAdminAlertForDiscord({
      event: parseAdminAlertEvent({
        type: "milestone.reached",
        metric: "successful_ai_reviews",
        threshold: 1_000,
        currentTotal: 1_000,
        estimatedTeacherMinutesSaved: 2_500,
      }),
      environment: "production",
      occurredAt: Date.UTC(2026, 7, 26, 20, 0),
    });

    expect(mrr.embeds[0]?.title).toBe("🏆 $1,000.00 MRR");
    expect(mrr.embeds[0]?.fields[0]?.value.replaceAll("\\", "")).toBe("$1,200.00");
    expect(JSON.stringify(reviews)).toContain("42 estimated hours");
  });

  it("uses bounded exponential backoff with deterministic jitter", () => {
    expect(calculateAdminAlertBackoffMs(1, 0.5)).toBe(5_000);
    expect(calculateAdminAlertBackoffMs(2, 0.5)).toBe(10_000);
    expect(calculateAdminAlertBackoffMs(6, 0)).toBe(80_000);
    expect(calculateAdminAlertBackoffMs(99, 1)).toBe(240_000);
  });
});

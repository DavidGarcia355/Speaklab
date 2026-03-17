import "server-only";
import {
  getTrackingSummary,
  listTeacherFunnelRows,
  logActivityEvent,
  type ActivityEventType,
} from "@/lib/db";

function getDiscordWebhookUrl() {
  return process.env.DISCORD_WEBHOOK_URL?.trim() || "";
}

export function formatDiscordActivityMessage(
  eventType: ActivityEventType,
  email: string,
  metadata?: Record<string, unknown> | null
) {
  switch (eventType) {
    case "user_signed_in":
      return `New sign-in: ${email}`;
    case "teacher_upgraded":
      return `Teacher upgraded: ${email}`;
    case "class_created":
      return metadata?.isFirstClass ? `First class created: ${email}` : `Class created: ${email}`;
    case "assignment_created":
      return metadata?.isFirstAssignment ? `First assignment created: ${email}` : `Assignment created: ${email}`;
    default:
      return `Activity: ${email}`;
  }
}

export async function notifyDiscordActivity(
  eventType: ActivityEventType,
  email: string,
  metadata?: Record<string, unknown> | null
) {
  if (eventType !== "teacher_upgraded") return;
  const webhookUrl = getDiscordWebhookUrl();
  if (!webhookUrl) return;
  const message = formatDiscordActivityMessage(eventType, email, metadata);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook failed with status ${response.status}.`);
  }
}

export async function trackActivity(
  eventType: ActivityEventType,
  email: string,
  metadata?: Record<string, unknown> | null
) {
  const normalizedEmail = email.trim().toLowerCase();
  try {
    await logActivityEvent({
      email: normalizedEmail,
      eventType,
      metadata,
    });
  } catch (error) {
    console.warn("Failed to log activity event", error);
  }

  try {
    await notifyDiscordActivity(eventType, normalizedEmail, metadata);
  } catch (error) {
    console.warn("Failed to notify Discord webhook", error);
  }
}

export async function buildTeacherEventMetadata(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const [summary, funnelRows] = await Promise.all([getTrackingSummary(), listTeacherFunnelRows()]);
  const teacher = funnelRows.find((row) => row.email === normalizedEmail);
  return {
    summary,
    teacher,
    isFirstClass: (teacher?.classCount ?? 0) === 1,
    isFirstAssignment: (teacher?.assignmentCount ?? 0) === 1,
  };
}

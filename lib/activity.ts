import "server-only";
import {
  findTeacherFunnelRowByEmail,
  logActivityEvent,
  type ActivityEventType,
} from "@/lib/db";

const INTERNAL_TEST_EMAILS = new Set([
  "eddiegarcia814@gmail.com",
  "kyrie2celtics@gmail.com",
  "davidsgarcia325@gmail.com",
]);

export function isInternalTestEmail(email: string) {
  return INTERNAL_TEST_EMAILS.has(email.trim().toLowerCase());
}

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
      return `🟢 New sign-in: ${email}`;
    case "teacher_upgraded":
      return `⬆️ Teacher upgraded: ${email}`;
    case "class_created":
      return metadata?.isFirstClass
        ? `🏫 First class created: ${email}`
        : `🏫 Class created: ${email}`;
    case "assignment_created":
      return metadata?.isFirstAssignment
        ? `📝 First assignment created: ${email}`
        : `📝 Assignment created: ${email}`;
    default:
      return `Activity: ${email}`;
  }
}

export function notifyDiscordActivity(
  eventType: ActivityEventType,
  email: string,
  metadata?: Record<string, unknown> | null
) {
  const webhookUrl = getDiscordWebhookUrl();
  if (!webhookUrl) return;
  const message = formatDiscordActivityMessage(eventType, email, metadata);
  void fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  })
    .then((response) => {
      if (!response.ok) {
        console.warn(`Discord webhook failed with status ${response.status}.`);
      }
    })
    .catch((error) => {
      console.warn("Failed to notify Discord webhook", error);
    });
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

  if (!isInternalTestEmail(normalizedEmail)) {
    notifyDiscordActivity(eventType, normalizedEmail, metadata);
  }
}

export async function buildTeacherEventMetadata(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const teacher = await findTeacherFunnelRowByEmail(normalizedEmail);
  return {
    teacher,
    isFirstClass: (teacher?.classCount ?? 0) === 1,
    isFirstAssignment: (teacher?.assignmentCount ?? 0) === 1,
  };
}

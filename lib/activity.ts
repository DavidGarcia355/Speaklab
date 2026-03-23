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

const DISCORD_NOTIFIED_EVENTS = new Set<ActivityEventType>(["teacher_upgraded"]);

function sendDiscordMessage(message: string) {
  const webhookUrl = getDiscordWebhookUrl();
  if (!webhookUrl) return;
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

export function notifyDiscordActivity(
  eventType: ActivityEventType,
  email: string,
) {
  if (!DISCORD_NOTIFIED_EVENTS.has(eventType)) return;
  sendDiscordMessage(`⬆️ Teacher upgraded: ${email}`);
}

export function notifyDiscordFeedback(input: {
  name: string;
  email: string;
  school: string;
  role: string;
}) {
  const who = input.name ? `${input.name} <${input.email}>` : input.email;
  const detail = [input.school, input.role].filter(Boolean).join(", ");
  sendDiscordMessage(`📬 New contact message from ${who}${detail ? ` · ${detail}` : ""}`);
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
    notifyDiscordActivity(eventType, normalizedEmail);
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

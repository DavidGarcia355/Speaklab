import "server-only";
import { Resend } from "resend";

const TEACHER_UPGRADE_SUBJECT = "You're all set on TryHabla";
const TEACHER_UPGRADE_TEXT = `Hi,

You're set up as a teacher on TryHabla. Here's how to get started:

1. Create your first class at tryhabla.com/teacher
2. Create a speaking assignment
3. Share the student link with your class
4. Students record in their browser - no downloads needed
5. You grade, add feedback, and export to CSV

Questions? Reply to this email or visit tryhabla.com/faq

- The TryHabla team`;

function getResendApiKey() {
  return process.env.RESEND_API_KEY?.trim() || "";
}

async function sendTeacherUpgradeConfirmationEmailNow(email: string) {
  const apiKey = getResendApiKey();
  if (!apiKey) return;

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: "TryHabla <onboarding@resend.dev>",
    to: email,
    subject: TEACHER_UPGRADE_SUBJECT,
    text: TEACHER_UPGRADE_TEXT,
  });
}

export function sendTeacherUpgradeConfirmationEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;

  void sendTeacherUpgradeConfirmationEmailNow(normalizedEmail).catch((error) => {
    console.warn("Failed to send teacher upgrade email", error);
  });
}

export async function sendFeedbackNotification(input: {
  name: string;
  email: string;
  school: string;
  role: string;
  message: string;
}) {
  const apiKey = getResendApiKey();
  if (!apiKey) return;

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: "TryHabla <onboarding@resend.dev>",
    to: "davidsgarcia325@gmail.com",
    subject: `New contact message from ${input.name || input.email}`,
    text: [
      `From: ${input.name} <${input.email}>`,
      `School: ${input.school}`,
      `Role: ${input.role}`,
      ``,
      input.message,
    ].join("\n"),
  }).catch((error) => {
    console.warn("Failed to send feedback notification", error);
  });
}

export const teacherUpgradeEmailCopy = {
  subject: TEACHER_UPGRADE_SUBJECT,
  text: TEACHER_UPGRADE_TEXT,
};

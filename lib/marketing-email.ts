import "server-only";

import { Resend } from "resend";
import {
  createMarketingOneClickUnsubscribeUrl,
  createMarketingUnsubscribeUrl,
  listMarketingRecipientsBefore,
} from "@/lib/marketing-unsubscribe";

export const WELCOME_BACK_CAMPAIGN_ID = "welcome-back-2026-v1";
export const WELCOME_BACK_CUTOFF_MS = Date.parse("2026-08-21T00:00:00-05:00");
export const WELCOME_BACK_SUBJECT = "Welcome back! A lot is new at TryHabla";

const DEFAULT_FROM = "TryHabla <updates@tryhabla.com>";
const REPLY_TO = "davidsgarcia325@gmail.com";

function getResendApiKey() {
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  return apiKey;
}

export function getMarketingFromAddress() {
  return process.env.TRYHABLA_MARKETING_FROM?.trim() || DEFAULT_FROM;
}

export function welcomeBackText(unsubscribeUrl: string) {
  return `Hey!

Welcome back to the school year! I hope your year is off to a great start.

We saw that you have a TryHabla account, and we'd love for you to try out some of the new features we've been working on. TryHabla now has AI-powered transcription, feedback, and grading to make reviewing student speaking assignments a whole lot easier.

We're also excited to share that we're keeping the core TryHabla classroom experience free.

We're working on new updates every day, and teacher feedback has been a huge part of what we build. Give it a try and let me know what you think!

Try the new TryHabla: https://tryhabla.com

Have a great school year!

David Garcia
Founder, TryHabla

Unsubscribe from TryHabla updates: ${unsubscribeUrl}`;
}

export function welcomeBackHtml(unsubscribeUrl: string) {
  return `<div style="margin:0;padding:0;background:#ffffff;color:#202124;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6">
  <div style="max-width:620px;margin:0 auto;padding:28px 20px">
    <p style="margin:0 0 18px">Hey!</p>
    <p style="margin:0 0 18px">Welcome back to the school year! I hope your year is off to a great start.</p>
    <p style="margin:0 0 18px">We saw that you have a TryHabla account, and we'd love for you to try out some of the new features we've been working on. TryHabla now has AI-powered transcription, feedback, and grading to make reviewing student speaking assignments a whole lot easier.</p>
    <p style="margin:0 0 18px">We're also excited to share that we're keeping the core TryHabla classroom experience <strong>free</strong>.</p>
    <p style="margin:0 0 24px">We're working on new updates every day, and teacher feedback has been a huge part of what we build. Give it a try and let me know what you think!</p>
    <p style="margin:28px 0"><a href="https://tryhabla.com" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Try the new TryHabla</a></p>
    <p style="margin:0 0 18px">Have a great school year!</p>
    <p style="margin:0">David Garcia<br>Founder, TryHabla</p>
    <div style="margin-top:34px;padding-top:18px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">
      <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline">Unsubscribe from TryHabla updates</a>
    </div>
  </div>
</div>`;
}

function buildWelcomeBackMessage(email: string) {
  const unsubscribeUrl = createMarketingUnsubscribeUrl(email);
  const oneClickUrl = createMarketingOneClickUnsubscribeUrl(email);

  return {
    from: getMarketingFromAddress(),
    to: [email],
    replyTo: REPLY_TO,
    subject: WELCOME_BACK_SUBJECT,
    text: welcomeBackText(unsubscribeUrl),
    html: welcomeBackHtml(unsubscribeUrl),
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [
      { name: "campaign", value: WELCOME_BACK_CAMPAIGN_ID },
      { name: "audience", value: "legacy_teachers" },
    ],
  };
}

export async function getWelcomeBackCampaignPreview() {
  const recipients = await listMarketingRecipientsBefore(WELCOME_BACK_CUTOFF_MS);
  return {
    campaignId: WELCOME_BACK_CAMPAIGN_ID,
    subject: WELCOME_BACK_SUBJECT,
    from: getMarketingFromAddress(),
    recipientCount: recipients.length,
    cutoff: new Date(WELCOME_BACK_CUTOFF_MS).toISOString(),
  };
}

export async function sendWelcomeBackCampaign() {
  const recipients = await listMarketingRecipientsBefore(WELCOME_BACK_CUTOFF_MS);
  if (recipients.length === 0) {
    return { recipientCount: 0, batchCount: 0 };
  }

  const resend = new Resend(getResendApiKey());
  let batchCount = 0;

  for (let start = 0; start < recipients.length; start += 100) {
    const chunk = recipients.slice(start, start + 100);
    const { error } = await resend.batch.send(
      chunk.map(buildWelcomeBackMessage),
      { idempotencyKey: `${WELCOME_BACK_CAMPAIGN_ID}/batch-${Math.floor(start / 100) + 1}` },
    );
    if (error) {
      throw new Error(`Resend campaign batch failed: ${error.message}`);
    }
    batchCount += 1;
  }

  return { recipientCount: recipients.length, batchCount };
}

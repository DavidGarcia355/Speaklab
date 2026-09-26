export const VIDEO_MONTHLY_LIMIT = 200;
export const VIDEO_UPLOAD_ATTEMPT_LIMIT = 400;
export const VIDEO_TRANSFER_BYTES_PER_MONTH = 10 * 1024 * 1024 * 1024;
export const VIDEO_REQUESTS_PER_MONTH = 5000;
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_APPROVAL_VALUE = "school-and-provider-reviewed-v1";

export function videoRetentionDays() {
  const days = Number(process.env.VIDEO_RETENTION_DAYS ?? "90");
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("VIDEO_RETENTION_DAYS must be an integer from 1 to 90.");
  }
  return days;
}

export function videoFeatureEnabled() {
  return process.env.VIDEO_FEATURE_ENABLED === "true" &&
    process.env.VIDEO_STUDENT_DATA_APPROVED === VIDEO_APPROVAL_VALUE &&
    Boolean(process.env.CRON_SECRET?.trim()) &&
    Boolean(process.env.AUDIO_BLOB_STORE_ID?.trim());
}

export function isVideoTeacherApproved(email: string) {
  const normalized = email.trim().toLowerCase();
  return Boolean(normalized) && (process.env.VIDEO_APPROVED_TEACHER_EMAILS ?? "")
    .split(",").some((entry) => entry.trim().toLowerCase() === normalized);
}

export function videoAiEnabled() {
  return videoFeatureEnabled() && process.env.AI_GRADING_ENABLED === "true" &&
    process.env.AI_STUDENT_DATA_APPROVED === "reviewed-2026-08-25" &&
    process.env.VIDEO_AI_ENABLED === "true" &&
    process.env.VIDEO_AI_STUDENT_DATA_APPROVED === VIDEO_APPROVAL_VALUE;
}

export function isVideoContentType(value: string) {
  return value === "video/webm" || value === "video/mp4";
}

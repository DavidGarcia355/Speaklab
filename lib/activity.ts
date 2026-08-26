import "server-only";
import {
  findTeacherFunnelRowByEmail,
  logActivityEvent,
  type ActivityEventType,
} from "@/lib/db";
export { isInternalTestEmail } from "@/lib/internal-accounts";

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

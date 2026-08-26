import "server-only";
import {
  deriveAdminAlertIdentity,
  enqueueAdminAlert,
} from "@/lib/admin-alerts";
import { isInternalTestEmail } from "@/lib/internal-accounts";

type AlertEvent = Parameters<typeof enqueueAdminAlert>[0];
type TeacherSignupSource = Extract<
  AlertEvent,
  { type: "teacher.signed_up" }
>["source"];

type FreeAllowanceSnapshot = {
  status: string;
  used: number;
  consumed?: number;
  limit: number;
};

function nonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function elapsedMinutes(startedAt: number, completedAt: number) {
  return nonNegativeInteger((completedAt - startedAt) / 60_000);
}

function elapsedDays(startedAt: number, completedAt: number) {
  return nonNegativeInteger((completedAt - startedAt) / 86_400_000);
}

function durationBucket(
  durationSeconds: number,
): Extract<AlertEvent, { type: "ai.first_review" }>["durationBucket"] {
  const seconds = nonNegativeInteger(durationSeconds);
  if (seconds < 60) return "under_1_minute";
  if (seconds <= 120) return "1_to_2_minutes";
  return "2_to_5_minutes";
}

function estimatedCostCents(estimatedCostMicrousd: number) {
  return nonNegativeInteger(Math.round(estimatedCostMicrousd / 10_000));
}

async function enqueueSafely(event: AlertEvent, dedupeKey: string) {
  try {
    await enqueueAdminAlert(event, { dedupeKey });
  } catch {
    console.warn("Admin alert enqueue failed", {
      code: "admin_alert_enqueue_failed",
      eventType: event.type,
    });
  }
}

async function teacherIdentity(teacherEmail: string) {
  const normalized = teacherEmail.trim().toLowerCase();
  if (!normalized || isInternalTestEmail(normalized)) return null;
  try {
    return deriveAdminAlertIdentity("teacher", normalized);
  } catch {
    console.warn("Admin alert identity derivation failed", {
      code: "admin_alert_identity_failed",
      subjectKind: "teacher",
    });
    return null;
  }
}

export async function enqueueTeacherSignedUpAlert(input: {
  teacherEmail: string;
  source?: TeacherSignupSource;
}) {
  const identity = await teacherIdentity(input.teacherEmail);
  if (!identity) return;
  await enqueueSafely(
    {
      type: "teacher.signed_up",
      teacherRef: identity.ref,
      ...(input.source ? { source: input.source } : {}),
    },
    `${identity.dedupeSubject}:teacher-signed-up`,
  );
}

export async function enqueueFirstClassCreatedAlert(input: {
  teacherEmail: string;
  teacherJoinedAt: number;
  classCreatedAt: number;
}) {
  const identity = await teacherIdentity(input.teacherEmail);
  if (!identity) return;
  await enqueueSafely(
    {
      type: "class.first_created",
      teacherRef: identity.ref,
      minutesFromSignup: elapsedMinutes(input.teacherJoinedAt, input.classCreatedAt),
    },
    `${identity.dedupeSubject}:first-class`,
  );
}

export async function enqueueFirstAssignmentPublishedAlert(input: {
  teacherEmail: string;
  teacherJoinedAt: number;
  assignmentCreatedAt: number;
}) {
  const identity = await teacherIdentity(input.teacherEmail);
  if (!identity) return;
  await enqueueSafely(
    {
      type: "assignment.first_published",
      teacherRef: identity.ref,
      minutesFromSignup: elapsedMinutes(input.teacherJoinedAt, input.assignmentCreatedAt),
    },
    `${identity.dedupeSubject}:first-assignment`,
  );
}

export async function enqueueFirstRecordingReceivedAlert(input: {
  teacherEmail: string;
  teacherJoinedAt?: number;
  assignmentCreatedAt: number;
  recordingCreatedAt: number;
}) {
  const identity = await teacherIdentity(input.teacherEmail);
  if (!identity) return;
  const alerts: Array<Promise<void>> = [
    enqueueSafely(
      {
        type: "recording.first_received",
        teacherRef: identity.ref,
        minutesFromAssignment: elapsedMinutes(
          input.assignmentCreatedAt,
          input.recordingCreatedAt,
        ),
      },
      `${identity.dedupeSubject}:first-recording`,
    ),
  ];
  if (typeof input.teacherJoinedAt === "number" && Number.isFinite(input.teacherJoinedAt)) {
    alerts.push(
      enqueueSafely(
        {
          type: "teacher.activated",
          teacherRef: identity.ref,
          minutesToActivation: elapsedMinutes(
            input.teacherJoinedAt,
            input.recordingCreatedAt,
          ),
        },
        `${identity.dedupeSubject}:teacher-activated`,
      ),
    );
  }
  await Promise.all(alerts);
}

export async function enqueueSuccessfulAiReviewAlerts(input: {
  teacherEmail: string;
  teacherJoinedAt: number;
  durationSeconds: number;
  estimatedCostMicrousd: number;
  allowance: FreeAllowanceSnapshot | null;
  completedAt?: number;
}) {
  const identity = await teacherIdentity(input.teacherEmail);
  if (!identity) return;
  const deliveredReviews = input.allowance
    ? nonNegativeInteger(input.allowance.consumed ?? input.allowance.used)
    : 0;

  const alerts: Array<Promise<void>> = [
    enqueueSafely(
      {
        type: "ai.first_review",
        teacherRef: identity.ref,
        durationBucket: durationBucket(input.durationSeconds),
        estimatedCostCents: estimatedCostCents(input.estimatedCostMicrousd),
      },
      `${identity.dedupeSubject}:first-ai-review`,
    ),
  ];

  if (
    input.allowance?.status === "free_lifetime" &&
    input.allowance.limit === 30 &&
    deliveredReviews >= 15
  ) {
    alerts.push(
      enqueueSafely(
        {
          type: "trial.half_used",
          teacherRef: identity.ref,
          used: 15,
          limit: 30,
        },
        `${identity.dedupeSubject}:trial-half-used`,
      ),
    );
  }

  if (
    input.allowance?.status === "free_lifetime" &&
    input.allowance.limit === 30 &&
    deliveredReviews >= 30
  ) {
    alerts.push(
      enqueueSafely(
        {
          type: "trial.exhausted",
          teacherRef: identity.ref,
          daysSinceSignup: elapsedDays(
            input.teacherJoinedAt,
            input.completedAt ?? Date.now(),
          ),
          upgradeStatus: "free",
        },
        `${identity.dedupeSubject}:trial-exhausted`,
      ),
    );
  }

  if (
    input.allowance?.status === "teacher_period" &&
    input.allowance.limit === 300 &&
    deliveredReviews >= 250
  ) {
    alerts.push(
      enqueueSafely(
        {
          type: "allowance.near_limit",
          teacherRef: identity.ref,
          used: 250,
          limit: 300,
        },
        `${identity.dedupeSubject}:allowance-near-limit`,
      ),
    );
  }

  if (
    input.allowance?.status === "teacher_period" &&
    input.allowance.limit === 300 &&
    deliveredReviews >= 300
  ) {
    alerts.push(
      enqueueSafely(
        {
          type: "allowance.exhausted",
          teacherRef: identity.ref,
          used: 300,
          limit: 300,
          outreachState: "not_started",
          adminPath: "/admin",
        },
        `${identity.dedupeSubject}:allowance-exhausted`,
      ),
    );
  }

  await Promise.all(alerts);
}

export async function enqueueSchoolLeadAlert(input: {
  feedbackId: string;
  requestedCapacity?: number;
}) {
  const feedbackId = input.feedbackId.trim();
  if (!feedbackId) return;
  let identity: ReturnType<typeof deriveAdminAlertIdentity>;
  try {
    identity = deriveAdminAlertIdentity("lead", feedbackId);
  } catch {
    console.warn("Admin alert identity derivation failed", {
      code: "admin_alert_identity_failed",
      subjectKind: "lead",
    });
    return;
  }
  await enqueueSafely(
    {
      type: "school.lead",
      leadRef: identity.ref,
      adminPath: "/admin",
      ...(typeof input.requestedCapacity === "number"
        ? { requestedCapacity: nonNegativeInteger(input.requestedCapacity) }
        : {}),
    },
    `${identity.dedupeSubject}:school-lead`,
  );
}

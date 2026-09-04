import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  createClient,
  type Client,
  type InStatement,
  type InValue,
  type Row,
  type Transaction,
} from "@libsql/client";
import { STRIPE_CATALOG_MANIFEST } from "@/lib/billing/catalog-manifest";
import {
  isStripeSubscriptionRuntimeReady,
  isStripeUsageRuntimeReady,
} from "@/lib/billing/catalog-validation";
import { getStripeBillingContractId } from "@/lib/billing/contract";
import {
  getStripeUsageBillingAvailability,
  getStripeSubscriptionBillingAvailability,
  requireStripeSubscriptionBillingConfig,
  requireStripeUsageBillingConfig,
  type StripeKeyMode,
} from "@/lib/billing/config";
import { getStripeAutomaticUsageRecoverySupportedSince } from "@/lib/billing/recovery-policy";
import { INTERNAL_TEST_EMAILS } from "@/lib/internal-accounts";
import { createSilentWavFixtureDataUrl } from "@/lib/local-ai-fixture-audio";
import { TEACHER_AI_PRICE_BOOK } from "@/lib/teacher-ai-pricing";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";
import type { FeedbackDiagnosticContext } from "@/lib/feedback-context";
import { LIMITS, type Rubric, type RubricScore } from "@/lib/validation";
import { AssignmentPointsBelowSavedGradeError } from "@/lib/assignment-errors";
import { DuplicateSubmissionError, SubmissionLimitReachedError } from "@/lib/submission-errors";

const QUERY_TIMEOUT_MS = 5000;

// Historical metered-ledger reconciliation only. The licensed Teacher plan
// does not earn class-based credits; keep this frozen so legacy audit reads do
// not redefine or leak into the v3 allowance contract.
const LEGACY_METERED_MAX_QUALIFYING_CLASSES = 30;

export type ClassRow = {
  id: string;
  name: string;
  ownerEmail: string;
  createdAt: number;
};

export type ClassSummaryRow = ClassRow & {
  assignmentCount: number;
  submissionCount: number;
};

export type AssignmentRow = {
  id: string;
  classId: string;
  title: string;
  description: string;
  instructions: string;
  targetLanguage: string;
  maxPoints: number;
  maxSubmissions: number;
  maxRecordingSeconds: number;
  rubric: Rubric | null;
  attachmentName: string;
  attachmentUrl: string;
  attachmentContentType: string;
  autoTranscribe: boolean;
  createdAt: number;
};

export type AutomaticTranscriptionJobRow = {
  id: string;
  submissionId: string;
  assignmentId: string;
  teacherEmail: string;
  status: "processing";
  attemptCount: number;
  leaseToken: string;
};

export type AssignmentSummaryRow = AssignmentRow & {
  submissionCount: number;
};

export type AssignmentDetailRow = AssignmentRow & {
  className: string;
  ownerEmail: string;
};

export type SubmissionRow = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  studentName: string;
  studentEmail: string;
  audioData: string;
  submittedAt: number;
  feedback: string;
  grade: number | null;
  gradeSource: "teacher" | "ai";
  rubricScores: RubricScore[] | null;
};

export type GradebookRow = {
  studentName: string;
  studentEmail: string;
  assignmentTitle: string;
  grade: number | null;
  feedback: string;
  submittedAt: number;
};

export type StudentSubmissionRow = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  classId: string;
  className: string;
  maxPoints: number;
  studentName: string;
  audioData: string;
  submittedAt: number;
  feedback: string;
  grade: number | null;
  gradeSource: "teacher" | "ai";
};

export type StudentAssignmentHistoryRow = {
  assignmentId: string;
  assignmentTitle: string;
  classId: string;
  className: string;
  maxPoints: number;
};

export type FeedbackRow = {
  id: string;
  name: string;
  email: string;
  school: string;
  role: string;
  message: string;
  context: FeedbackDiagnosticContext | null;
  createdAt: number;
};

export type UserRole = "teacher" | "student";
export type ActivityEventType =
  | "user_signed_in"
  | "teacher_upgraded"
  | "class_created"
  | "assignment_created";

export type ActivityEventRow = {
  id: string;
  email: string;
  eventType: ActivityEventType;
  occurredAt: number;
  metadata: Record<string, unknown> | null;
};

export type AdminAlertDestination =
  | "traction"
  | "revenue"
  | "milestones"
  | "pulse"
  | "incidents";

export type AdminAlertEnvironment =
  | "production"
  | "preview"
  | "development"
  | "test";

export type AdminAlertOutboxStatus = "pending" | "delivered" | "dead";

export type AdminAlertOutboxInsert = {
  id: string;
  dedupeKey: string;
  eventType: string;
  destination: AdminAlertDestination;
  safePayloadJson: string;
  environment: AdminAlertEnvironment;
  nextAttemptAt: number;
  createdAt: number;
};

export type AdminAlertOutboxRow = AdminAlertOutboxInsert & {
  status: AdminAlertOutboxStatus;
  attemptCount: number;
  deliveredAt: number | null;
  lastErrorCode: string;
  leaseToken: string;
  leaseExpiresAt: number;
};

export type AdminAlertOutboxHealth = {
  pending: number;
  due: number;
  stale: number;
  delivered: number;
  dead: number;
  oldestPendingAt: number | null;
};

// Delivery is intentionally sequential. Keeping the database claim bounded
// prevents a caller from leasing more rows than one worker can safely finish.
export const ADMIN_ALERT_OUTBOX_MAX_CLAIM = 8;

export type AdminAlertPeriodAggregate = {
  newTeachers: number;
  activatedTeachers: number;
  newPaidTeachers: number;
  eligibleFreeTeachers: number;
  convertedEligibleFreeTeachers: number;
  assignmentsPublished: number;
  recordingsReceived: number;
  successfulAiReviews: number;
  aiAttempts: number;
  aiFailures: number;
  retryCount: number;
  durationSampleCount: number;
  medianDurationSeconds: number;
  p90DurationSeconds: number;
  activePaidTeachers: number;
  mrrCents: number;
  newMrrCents: number;
  recognizedRevenueCents: number;
  cancellations: number;
  refundsCents: number;
  failedPayments: number;
  estimatedProviderSpendCents: number;
  estimatedStripeFeesCents: number;
  estimatedContributionCents: number;
  freeTrialsExhausted: number;
  nearPaidLimitTeachers: number;
  paidLimitExhaustedTeachers: number;
  schoolLeads: number;
};

export type AdminAlertMilestoneAggregate = {
  totalTeachers: number;
  activatedTeachers: number;
  paidTeachers: number;
  successfulAiReviews: number;
  studentRecordings: number;
  mrrCents: number;
  schoolLeads: number;
  estimatedProviderCostCents: number;
};

export type AdminAlertOperationalAggregate = {
  budgetPeriod: string;
  providerSpendMicrousd: number;
  rollingWindowStartAt: number;
  rollingWindowEndAt: number;
  completedAttempts: number;
  usableAttempts: number;
  latencySampleCount: number;
  p95LatencyMs: number;
};

export type TeacherFunnelRow = {
  email: string;
  role: UserRole;
  joinedAt: number;
  classCount: number;
  assignmentCount: number;
  submissionCount: number;
  latestActivityAt: number | null;
  isPaid: boolean;
};

export type TrackingSummaryRow = {
  totalUsers: number;
  teacherAccounts: number;
  activatedTeachers: number;
  teachingReadyTeachers: number;
};

export type RosterRow = {
  id: string;
  classId: string;
  studentEmail: string;
  studentName: string;
  addedAt: number;
  addedBy: "submission" | "teacher";
};

export type StudentEnrolledRow = {
  classId: string;
  className: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  maxPoints: number;
  submissionCount: number;
};

export type StudentAssignmentRow = {
  assignmentId: string;
  assignmentTitle: string;
  maxPoints: number;
  createdAt: number;
  submissionId: string | null;
  audioData: string | null;
  submittedAt: number | null;
  grade: number | null;
  feedback: string;
};

export type AiGradingAttemptStatus = "completed" | "failed";
export type AiGradingAttemptDeliveryStatus =
  | "pending"
  | "delivered"
  | "withheld"
  | "not_applicable";

export type AiGradingAttemptRow = {
  id: string;
  submissionId: string;
  teacherEmail: string;
  status: AiGradingAttemptStatus;
  deliveryStatus: AiGradingAttemptDeliveryStatus;
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: string;
  durationSeconds: number;
  suggestedScore: number | null;
  rubricScores: RubricScore[];
  feedback: string;
  strengths: string[];
  improvements: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
  teacherAttention: string;
  transcriptionProvider: string;
  gradingProvider: string;
  transcriptionModel: string;
  gradingModel: string;
  errorCode: string;
  errorMessage: string;
  cacheKey: string;
  assignmentFingerprint: string;
  cacheHit: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retries: number;
  escalated: boolean;
  escalationReason: string;
  estimatedCostMicrousd: number;
  promptVersion: string;
  resultSource: string;
  billingRequired: boolean;
  billingPriceBookId: string;
  billingStripeCustomerId: string;
  billingStripeSubscriptionId: string;
  billingCatalogFingerprint: string;
  billingContractId: string;
  billingLivemode: boolean;
  billingQualifyingClassHighWater: number;
  billingFreeCreditApplied: boolean;
  billableOutputTokens: number;
  createdAt: number;
  completedAt: number | null;
};

export type SubmissionTranscriptRow = {
  id: string;
  submissionId: string;
  teacherEmail: string;
  semanticKey: string;
  assignmentFingerprint: string;
  transcriptCacheKey: string;
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: string;
  durationSeconds: number;
  transcriptionProvider: string;
  transcriptionModel: string;
  estimatedCostMicrousd: number;
  latencyMs: number;
  createdAt: number;
  updatedAt: number;
};

export type GradingResultCacheRow = {
  cacheKey: string;
  submissionId: string;
  teacherEmail: string;
  resultJson: string;
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type GradingProviderRequestStatus = "pending" | "completed" | "failed";

export type GradingProviderRequestRow = {
  id: string;
  attemptId: string | null;
  submissionId: string;
  teacherEmail: string;
  requestStage: string;
  provider: string;
  model: string;
  providerRequestId: string;
  status: GradingProviderRequestStatus;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retries: number;
  escalated: boolean;
  escalationReason: string;
  estimatedCostMicrousd: number;
  promptVersion: string;
  errorCode: string;
  createdAt: number;
  completedAt: number | null;
};

export type GradingUsageAggregate = {
  requestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retries: number;
  escalations: number;
  estimatedCostMicrousd: number;
};

export type StripeBillingAccountRow = {
  teacherEmail: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
  subscriptionPeriodStart: number;
  subscriptionPeriodEnd: number;
  priceBookId: string;
  catalogFingerprint: string;
  stripeAccountId: string;
  billingContractId: string;
  livemode: boolean;
  stripeEventCreated: number;
  projectionRevision: number;
  createdAt: number;
  updatedAt: number;
};

export const AI_REVIEW_FREE_LIFETIME_LIMIT = 30;
export const AI_REVIEW_MANUAL_LIFETIME_LIMIT = 300;
export const AI_REVIEW_TEACHER_PERIOD_LIMIT = 300;

export type AiReviewLifetimeBonusGrant = {
  teacherEmail: string;
  grantKey: string;
  units: number;
  reason: string;
  grantedBy: string;
  createdAt: number;
};

export type AiReviewLifetimeBonusGrantResult = AiReviewLifetimeBonusGrant & {
  created: boolean;
  totalBonusUnits: number;
};

export type AiReviewAllowanceKind =
  | "free_lifetime"
  | "manual_lifetime"
  | "teacher_period";

export type AiReviewAllowanceStatus =
  | AiReviewAllowanceKind
  | "subscription_unavailable";

export type AiReviewAllowanceSummary = {
  teacherEmail: string;
  status: AiReviewAllowanceStatus;
  limit: number;
  reserved: number;
  consumed: number;
  used: number;
  remaining: number;
  stripeSubscriptionId: string | null;
  periodStart: number | null;
  periodEnd: number | null;
};

export type AiReviewSourceKind = "grading" | "transcript";

export type AiReviewReservationResult =
  | ({ reservationStatus: "reserved"; reservationId: string } & AiReviewAllowanceSummary)
  | ({
      reservationStatus: "duplicate";
      reservationId: string;
      sourceAttemptId: string;
      sourceResultId: string;
      sourceKind: AiReviewSourceKind;
    } & AiReviewAllowanceSummary)
  | ({ reservationStatus: "in_flight" } & AiReviewAllowanceSummary)
  | ({ reservationStatus: "exhausted" } & AiReviewAllowanceSummary)
  | ({ reservationStatus: "subscription_unavailable" } & AiReviewAllowanceSummary);

export type AiGradingBatchStatus =
  | "queued"
  | "processing"
  | "review_ready"
  | "partial_failure"
  | "saved"
  | "cancelled";

export type AiGradingBatchItemStatus =
  | "queued"
  | "processing"
  | "review_ready"
  | "failed"
  | "skipped"
  | "saved"
  | "conflict";

export type AiGradingBatchDraft = {
  grade: number | null;
  rubricScores: RubricScore[] | null;
  feedback: string;
};

export type AiGradingBatchItemRow = {
  id: string;
  batchId: string;
  submissionId: string;
  studentName: string;
  studentEmail: string;
  submittedAt: number;
  ordinal: number;
  status: AiGradingBatchItemStatus;
  attemptId: string | null;
  attempt: AiGradingAttemptRow | null;
  errorCode: string;
  errorMessage: string;
  retryCount: number;
  teacherEdited: boolean;
  draft: AiGradingBatchDraft;
  updatedAt: number;
};

export type AiGradingBatchCounts = {
  total: number;
  queued: number;
  processing: number;
  reviewReady: number;
  failed: number;
  skipped: number;
  saved: number;
  conflict: number;
};

export type AiGradingBatchRow = {
  id: string;
  teacherEmail: string;
  assignmentId: string;
  assignmentTitle: string;
  assignmentFingerprint: string;
  status: AiGradingBatchStatus;
  eligibleCount: number;
  newUnitsRequired: number;
  transcriptsRequired: number;
  savedTranscripts: number;
  enhanced: boolean;
  counts: AiGradingBatchCounts;
  items: AiGradingBatchItemRow[];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  savedAt: number | null;
};

export type ClaimedAiGradingBatchItem = {
  batchId: string;
  itemId: string;
  submissionId: string;
  leaseToken: string;
  enhanced: boolean;
};

export type StripeWebhookEventRow = {
  eventId: string;
  eventType: string;
  stripeEventCreated: number;
  processedAt: number;
};

export type AiBillingCreditPeriodRow = {
  teacherEmail: string;
  billingMonth: string;
  priceBookId: string;
  catalogFingerprint: string;
  livemode: boolean;
  qualifyingClassHighWater: number;
  usedCredits: number;
  createdAt: number;
  updatedAt: number;
};

export type AiBillingUsageStatus = "pending" | "credited" | "reported" | "failed";
export type AiBillingUsageDimension = "base" | "audio";

export type AiBillingUsageRow = {
  id: string;
  teacherEmail: string;
  billingMonth: string;
  cacheKey: string;
  priceBookId: string;
  attemptId: string;
  submissionId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  catalogFingerprint: string;
  billingContractId: string;
  livemode: boolean;
  freeCreditApplied: boolean;
  baseUnits: number;
  durationSeconds: number;
  outputTokens: number;
  baseAttemptedAt: number | null;
  audioAttemptedAt: number | null;
  outputAttemptedAt: number | null;
  baseReportedAt: number | null;
  audioReportedAt: number | null;
  outputReportedAt: number | null;
  status: AiBillingUsageStatus;
  lastErrorDimension: AiBillingUsageDimension | null;
  lastError: string;
  lastFailedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AiBillingMonthlySummary = {
  teacherEmail: string;
  billingMonth: string;
  qualifyingClassHighWater: number;
  earnedCredits: number;
  usedCredits: number;
  remainingCredits: number;
  successfulResults: number;
  freeCreditResults: number;
  billableResults: number;
  billableBaseUnits: number;
  billableDurationSeconds: number;
  billableOutputTokens: number;
  pendingResults: number;
  reportedResults: number;
  failedResults: number;
};

export type UnqueuedAiBillingAttemptRow = {
  attemptId: string;
  teacherEmail: string;
  cacheKey: string;
  priceBookId: string;
  submissionId: string;
  durationSeconds: number;
  outputTokens: number;
  livemode: boolean;
  billingContractId: string;
  occurredAt: number;
};

export type AiBillingScope = {
  priceBookId: string;
  catalogFingerprint: string;
  billingContractId: string;
  livemode: boolean;
};

export type AiBillingReconciliationHealth = {
  pendingUnattempted: number;
  expiredPendingUnattempted: number;
  invalidPendingUnattempted: number;
  attemptedUnreported: number;
  recoverableUnqueued: number;
  invalidUnqueued: number;
  expiredUnqueued: number;
};

/**
 * Emails granted full teacher access automatically on sign-in.
 *
 * Merges TEACHER_ALLOWLIST with the admin emails (ADMIN_EMAILS / ADMIN_EMAIL) so
 * an admin never has to be listed twice to be able to use teacher features.
 * Env is read directly rather than importing lib/admin.ts, because auth.ts already
 * imports this module and that would create a circular import.
 */
function getTeacherAllowlist(): Set<string> {
  const raw = [
    process.env.TEACHER_ALLOWLIST ?? "",
    process.env.ADMIN_EMAILS ?? "",
    process.env.ADMIN_EMAIL ?? "",
  ].join(",");
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function defaultRoleForEmail(email: string): UserRole {
  return getTeacherAllowlist().has(email.trim().toLowerCase()) ? "teacher" : "student";
}

type SubmissionAccessRow = {
  id: string;
  studentEmail: string;
  audioBlobUrl: string;
};

function createDbClient(): Client {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim() || "";
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim() || "";

  if (tursoUrl && tursoToken) {
    return createClient({
      url: tursoUrl,
      authToken: tursoToken,
    });
  }
  if (tursoUrl || tursoToken) {
    throw new Error("Both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required together.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required in production; local database fallback is disabled."
    );
  }

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const localPath = process.env.HABLA_LOCAL_DB_PATH?.trim() || path.join(dataDir, "local.db");
  return createClient({ url: `file:${localPath}` });
}

let dbClient: Client | null = null;

function getDbClient(): Client {
  if (!dbClient) dbClient = createDbClient();
  return dbClient;
}

let initPromise: Promise<void> | null = null;

async function withTimeout<T>(label: string, fn: () => Promise<T>) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Database query timeout exceeded 5000ms (${label}).`));
        }, QUERY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function rawExecute(sql: string, args: InValue[] = []) {
  return getDbClient().execute({ sql, args });
}

async function ensureColumn(
  tableName:
    | "classes"
    | "assignments"
    | "submissions"
    | "submission_transcripts"
    | "feedback_messages"
    | "users"
    | "stripe_billing_accounts"
    | "ai_grading_attempts"
    | "ai_grading_batches"
    | "ai_review_allowance_reservations_v1",
  columnName: string,
  definition: string
) {
  const pragma = await rawExecute(`PRAGMA table_info(${tableName})`);
  const columns = pragma.rows.map((row) => String((row as Row).name));
  if (!columns.includes(columnName)) {
    try {
      await rawExecute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    } catch (error) {
      // Concurrent serverless cold starts can both observe a missing column.
      // Treat the losing ALTER as success only after the database confirms
      // that the column now exists; every other failure remains visible and
      // initialization is retryable.
      const afterRace = await rawExecute(`PRAGMA table_info(${tableName})`);
      const racedColumns = afterRace.rows.map((row) => String((row as Row).name));
      if (!racedColumns.includes(columnName)) throw error;
      return false;
    }
    return true;
  }
  return false;
}

const AI_ATTEMPT_DELIVERY_STATUS_MIGRATION =
  "2026-08-25-ai-attempt-delivery-status-v1";
const AI_ACCESS_GRANT_PROVENANCE_MIGRATION =
  "2026-08-26-ai-access-grant-provenance-v2";
const ADMIN_ALERT_OUTBOX_MIGRATION =
  "2026-08-26-admin-alert-outbox-v1";
const MANUAL_AI_ACCESS_GRANT_SOURCES = ["manual"] as const;
const MANUAL_AI_ACCESS_GRANT_SQL_LIST = MANUAL_AI_ACCESS_GRANT_SOURCES
  .map((source) => `'${source}'`)
  .join(", ");

async function migrateAiAttemptDeliveryStatus() {
  const transaction = await getDbClient().transaction("write");
  try {
    const claim = await transaction.execute({
      sql: `INSERT INTO schema_migrations (name, applied_at)
        VALUES (?, ?)
        ON CONFLICT(name) DO NOTHING`,
      args: [AI_ATTEMPT_DELIVERY_STATUS_MIGRATION, Date.now()],
    });
    if (toNumber(claim.rowsAffected) === 1) {
      await transaction.execute(`UPDATE ai_grading_attempts
        SET delivery_status = CASE
          WHEN status = 'failed'
            OR suggested_score IS NULL
            OR TRIM(COALESCE(error_code, '')) <> ''
            THEN 'not_applicable'
          WHEN EXISTS (
            SELECT 1
            FROM submissions s
            WHERE s.id = ai_grading_attempts.submission_id
              AND s.deleted_at IS NULL
              AND s.grade_source = 'ai'
              AND s.grade = ai_grading_attempts.suggested_score
          ) THEN 'delivered'
          ELSE 'withheld'
        END
        WHERE delivery_status = 'pending'`);
    }
    await transaction.commit();
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

/**
 * Quarantines every origin-less legacy is_paid bit for operator review. Older
 * releases wrote is_paid=1 both for explicit grants and for allowlisted sign-in,
 * so neither the current allowlist nor the bit alone can safely infer origin.
 */
async function migrateAiAccessGrantProvenance() {
  const transaction = await getDbClient().transaction("write");
  try {
    const claim = await transaction.execute({
      sql: `INSERT INTO schema_migrations (name, applied_at)
        VALUES (?, ?)
        ON CONFLICT(name) DO NOTHING`,
      args: [AI_ACCESS_GRANT_PROVENANCE_MIGRATION, Date.now()],
    });
    if (toNumber(claim.rowsAffected) === 1) {
      await transaction.execute(`UPDATE users
        SET ai_access_grant_source = 'legacy_unclassified'
        WHERE is_paid = 1
          AND (
            TRIM(ai_access_grant_source) = ''
            OR ai_access_grant_source IN ('legacy_manual', 'legacy_allowlist')
          )`);
    }
    await transaction.commit();
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

async function migrateAdminAlertOutbox() {
  const transaction = await getDbClient().transaction("write");
  try {
    await transaction.execute(`CREATE TABLE IF NOT EXISTS admin_alert_outbox (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      destination TEXT NOT NULL
        CHECK (destination IN ('traction', 'revenue', 'milestones', 'pulse', 'incidents')),
      safe_payload_json TEXT NOT NULL,
      environment TEXT NOT NULL
        CHECK (environment IN ('production', 'preview', 'development', 'test')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'delivered', 'dead')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      delivered_at INTEGER,
      last_error_code TEXT NOT NULL DEFAULT '',
      lease_token TEXT NOT NULL DEFAULT '',
      lease_expires_at INTEGER NOT NULL DEFAULT 0 CHECK (lease_expires_at >= 0),
      CHECK (status <> 'delivered' OR delivered_at IS NOT NULL)
    )`);
    await transaction.execute(
      `CREATE INDEX IF NOT EXISTS idx_admin_alert_outbox_due
        ON admin_alert_outbox(environment, status, next_attempt_at, lease_expires_at, created_at)`,
    );
    await transaction.execute(
      `CREATE INDEX IF NOT EXISTS idx_admin_alert_outbox_status_created
        ON admin_alert_outbox(status, created_at)`,
    );
    await transaction.execute({
      sql: `INSERT INTO schema_migrations (name, applied_at)
        VALUES (?, ?)
        ON CONFLICT(name) DO NOTHING`,
      args: [ADMIN_ALERT_OUTBOX_MIGRATION, Date.now()],
    });
    await transaction.commit();
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

async function ensureInitialized() {
  if (!initPromise) {
    const initialization = (async () => {
      const statements = [
        "PRAGMA foreign_keys = ON",
        `CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS classes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          owner_email TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          deleted_at INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS assignments (
          id TEXT PRIMARY KEY,
          class_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          instructions TEXT NOT NULL DEFAULT '',
          target_language TEXT NOT NULL DEFAULT 'Spanish',
          created_at INTEGER NOT NULL,
          deleted_at INTEGER,
          FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS submissions (
          id TEXT PRIMARY KEY,
          assignment_id TEXT NOT NULL,
          student_name TEXT NOT NULL,
          student_email TEXT NOT NULL DEFAULT '',
          audio_data TEXT,
          audio_blob_url TEXT,
          submitted_at INTEGER NOT NULL,
          feedback TEXT,
          grade INTEGER,
          grade_source TEXT NOT NULL DEFAULT 'teacher' CHECK (grade_source IN ('teacher', 'ai')),
          deleted_at INTEGER,
          FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS feedback_messages (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          school TEXT NOT NULL,
          role TEXT NOT NULL,
          message TEXT NOT NULL,
          context_json TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY,
          role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('teacher', 'student')),
          default_language TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS activity_events (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          event_type TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          metadata TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS roster (
          id TEXT PRIMARY KEY,
          class_id TEXT NOT NULL,
          student_email TEXT NOT NULL,
          student_name TEXT NOT NULL DEFAULT '',
          added_at INTEGER NOT NULL,
          added_by TEXT NOT NULL DEFAULT 'submission' CHECK (added_by IN ('submission', 'teacher')),
          FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS ai_grading_attempts (
          id TEXT PRIMARY KEY,
          submission_id TEXT NOT NULL,
           teacher_email TEXT NOT NULL,
           status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
           delivery_status TEXT NOT NULL DEFAULT 'pending'
             CHECK (delivery_status IN ('pending', 'delivered', 'withheld', 'not_applicable')),
          transcript TEXT NOT NULL DEFAULT '',
          detected_language TEXT NOT NULL DEFAULT '',
          transcript_quality TEXT NOT NULL DEFAULT '',
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          suggested_score INTEGER,
          rubric_scores TEXT,
          feedback TEXT NOT NULL DEFAULT '',
          strengths TEXT,
          improvements TEXT,
          evidence TEXT,
          confidence TEXT NOT NULL DEFAULT 'low',
          warnings TEXT,
          teacher_attention TEXT NOT NULL DEFAULT 'review',
          transcription_provider TEXT NOT NULL DEFAULT '',
          grading_provider TEXT NOT NULL DEFAULT '',
          transcription_model TEXT NOT NULL DEFAULT '',
          grading_model TEXT NOT NULL DEFAULT '',
          error_code TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL DEFAULT '',
          cache_key TEXT NOT NULL DEFAULT '',
          assignment_fingerprint TEXT NOT NULL DEFAULT '',
          cache_hit INTEGER NOT NULL DEFAULT 0,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          cached_input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          latency_ms INTEGER NOT NULL DEFAULT 0,
          retries INTEGER NOT NULL DEFAULT 0,
          escalated INTEGER NOT NULL DEFAULT 0,
          escalation_reason TEXT NOT NULL DEFAULT '',
          estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
          prompt_version TEXT NOT NULL DEFAULT '',
          result_source TEXT NOT NULL DEFAULT 'ai',
          billing_required INTEGER NOT NULL DEFAULT 0 CHECK (billing_required IN (0, 1)),
          billing_price_book_id TEXT NOT NULL DEFAULT '',
          billing_stripe_customer_id TEXT NOT NULL DEFAULT '',
          billing_stripe_subscription_id TEXT NOT NULL DEFAULT '',
          billing_catalog_fingerprint TEXT NOT NULL DEFAULT '',
          billing_contract_id TEXT NOT NULL DEFAULT '',
          billing_livemode INTEGER NOT NULL DEFAULT 0 CHECK (billing_livemode IN (0, 1)),
          billing_qualifying_class_high_water INTEGER NOT NULL DEFAULT 0
            CHECK (billing_qualifying_class_high_water >= 0),
          billing_free_credit_applied INTEGER NOT NULL DEFAULT 0
            CHECK (billing_free_credit_applied IN (0, 1)),
          billable_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (billable_output_tokens >= 0),
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS submission_transcripts (
          id TEXT PRIMARY KEY,
          submission_id TEXT NOT NULL,
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          semantic_key TEXT NOT NULL,
          assignment_fingerprint TEXT NOT NULL DEFAULT '',
          transcript_cache_key TEXT NOT NULL DEFAULT '',
          transcript TEXT NOT NULL,
          detected_language TEXT NOT NULL DEFAULT '',
          transcript_quality TEXT NOT NULL DEFAULT '',
          duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
          transcription_provider TEXT NOT NULL DEFAULT '',
          transcription_model TEXT NOT NULL DEFAULT '',
          estimated_cost_microusd INTEGER NOT NULL DEFAULT 0
            CHECK (estimated_cost_microusd >= 0),
          latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(submission_id, semantic_key),
          FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS automatic_transcription_jobs (
          id TEXT PRIMARY KEY,
          submission_id TEXT NOT NULL UNIQUE,
          assignment_id TEXT NOT NULL,
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          status TEXT NOT NULL DEFAULT 'queued'
            CHECK (status IN ('queued', 'processing', 'retry', 'paused', 'completed', 'failed', 'cancelled')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at >= 0),
          lease_token TEXT NOT NULL DEFAULT '',
          lease_expires_at INTEGER NOT NULL DEFAULT 0 CHECK (lease_expires_at >= 0),
          last_error_code TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
          FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS grading_result_cache (
          cache_key TEXT NOT NULL,
          submission_id TEXT NOT NULL,
          teacher_email TEXT NOT NULL,
          result_json TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          prompt_version TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY(cache_key, teacher_email),
          FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS grading_provider_requests (
          id TEXT PRIMARY KEY,
          attempt_id TEXT,
          submission_id TEXT NOT NULL,
          teacher_email TEXT NOT NULL,
          request_stage TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          provider_request_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
          input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
          cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
          output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
          latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
          retries INTEGER NOT NULL DEFAULT 0 CHECK (retries >= 0),
          escalated INTEGER NOT NULL DEFAULT 0 CHECK (escalated IN (0, 1)),
          escalation_reason TEXT NOT NULL DEFAULT '',
          estimated_cost_microusd INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_microusd >= 0),
          prompt_version TEXT NOT NULL DEFAULT '',
          error_code TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY(attempt_id) REFERENCES ai_grading_attempts(id) ON DELETE SET NULL,
          FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS ai_budget_reservations (
          id TEXT PRIMARY KEY,
          generation_count INTEGER NOT NULL CHECK (generation_count > 0),
          reserved_microusd INTEGER NOT NULL CHECK (reserved_microusd > 0),
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS stripe_billing_accounts (
          teacher_email TEXT PRIMARY KEY COLLATE NOCASE,
          stripe_customer_id TEXT NOT NULL UNIQUE,
          stripe_subscription_id TEXT UNIQUE,
          subscription_status TEXT NOT NULL DEFAULT '',
          subscription_period_start INTEGER NOT NULL DEFAULT 0
            CHECK (subscription_period_start >= 0),
          subscription_period_end INTEGER NOT NULL DEFAULT 0
            CHECK (subscription_period_end >= 0),
          price_book_id TEXT NOT NULL DEFAULT '',
          catalog_fingerprint TEXT NOT NULL DEFAULT '',
          stripe_account_id TEXT NOT NULL DEFAULT '',
          billing_contract_id TEXT NOT NULL DEFAULT '',
          livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0, 1)),
          stripe_event_created INTEGER NOT NULL DEFAULT 0 CHECK (stripe_event_created >= 0),
          projection_revision INTEGER NOT NULL DEFAULT 0 CHECK (projection_revision >= 0),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
          event_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          stripe_event_created INTEGER NOT NULL CHECK (stripe_event_created >= 0),
          processed_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ai_review_allowance_reservations_v1 (
          id TEXT PRIMARY KEY,
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          semantic_key TEXT NOT NULL,
          allowance_kind TEXT NOT NULL
            CHECK (allowance_kind IN ('free_lifetime', 'manual_lifetime', 'teacher_period')),
          scope_key TEXT NOT NULL,
          stripe_subscription_id TEXT NOT NULL DEFAULT '',
          period_start INTEGER NOT NULL DEFAULT 0 CHECK (period_start >= 0),
          period_end INTEGER NOT NULL DEFAULT 0 CHECK (period_end >= 0),
          status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed', 'released')),
          attempt_id TEXT NOT NULL DEFAULT '',
          source_kind TEXT NOT NULL DEFAULT 'grading',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          consumed_at INTEGER,
          released_at INTEGER,
          UNIQUE(teacher_email, semantic_key)
        )`,
        `CREATE TABLE IF NOT EXISTS ai_review_lifetime_bonus_grants_v1 (
          teacher_email TEXT NOT NULL COLLATE NOCASE
            CHECK (teacher_email = LOWER(TRIM(teacher_email))),
          grant_key TEXT NOT NULL,
          units INTEGER NOT NULL CHECK (units > 0),
          reason TEXT NOT NULL CHECK (TRIM(reason) <> ''),
          granted_by TEXT NOT NULL CHECK (TRIM(granted_by) <> ''),
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          PRIMARY KEY(teacher_email, grant_key)
        )`,
        `CREATE TABLE IF NOT EXISTS ai_grading_batches (
          id TEXT PRIMARY KEY,
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          assignment_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          assignment_fingerprint TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued'
            CHECK (status IN ('queued', 'processing', 'review_ready', 'partial_failure', 'saved', 'cancelled')),
          eligible_count INTEGER NOT NULL CHECK (eligible_count > 0),
          new_units_required INTEGER NOT NULL CHECK (new_units_required >= 0),
          transcripts_required INTEGER NOT NULL DEFAULT 0 CHECK (transcripts_required >= 0),
          enhanced INTEGER NOT NULL DEFAULT 0 CHECK (enhanced IN (0, 1)),
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          completed_at INTEGER,
          saved_at INTEGER,
          UNIQUE(teacher_email, assignment_id, idempotency_key),
          FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS ai_grading_batch_items (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL,
          submission_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          status TEXT NOT NULL DEFAULT 'queued'
            CHECK (status IN ('queued', 'processing', 'review_ready', 'failed', 'skipped', 'saved', 'conflict')),
          attempt_id TEXT,
          draft_grade INTEGER,
          draft_rubric_scores TEXT,
          draft_feedback TEXT NOT NULL DEFAULT '',
          teacher_edited INTEGER NOT NULL DEFAULT 0 CHECK (teacher_edited IN (0, 1)),
          error_code TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL DEFAULT '',
          retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
          lease_token TEXT NOT NULL DEFAULT '',
          lease_expires_at INTEGER NOT NULL DEFAULT 0 CHECK (lease_expires_at >= 0),
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          UNIQUE(batch_id, submission_id),
          UNIQUE(batch_id, ordinal),
          FOREIGN KEY(batch_id) REFERENCES ai_grading_batches(id) ON DELETE CASCADE,
          FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
          FOREIGN KEY(attempt_id) REFERENCES ai_grading_attempts(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ai_daily_generation_quota_reservations (
          id TEXT PRIMARY KEY,
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          expires_at INTEGER NOT NULL CHECK (expires_at >= created_at)
        )`,
        `CREATE TABLE IF NOT EXISTS ai_billing_credit_periods (
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          billing_month TEXT NOT NULL,
          qualifying_class_high_water INTEGER NOT NULL DEFAULT 0 CHECK (qualifying_class_high_water >= 0),
          used_credits INTEGER NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(teacher_email, billing_month)
        )`,
        `CREATE TABLE IF NOT EXISTS ai_billing_usage (
          id TEXT PRIMARY KEY,
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          billing_month TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          price_book_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          submission_id TEXT NOT NULL,
          stripe_customer_id TEXT NOT NULL DEFAULT '',
          stripe_subscription_id TEXT NOT NULL DEFAULT '',
          catalog_fingerprint TEXT NOT NULL DEFAULT '',
          livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0, 1)),
          free_credit_applied INTEGER NOT NULL DEFAULT 0 CHECK (free_credit_applied IN (0, 1)),
          base_units INTEGER NOT NULL DEFAULT 1 CHECK (base_units >= 0),
          duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
          output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
          base_attempted_at INTEGER,
          audio_attempted_at INTEGER,
          output_attempted_at INTEGER,
          base_reported_at INTEGER,
          audio_reported_at INTEGER,
          output_reported_at INTEGER,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'reported', 'failed')),
          last_error_dimension TEXT CHECK (last_error_dimension IS NULL OR last_error_dimension IN ('base', 'audio', 'output')),
          last_error TEXT NOT NULL DEFAULT '',
          last_failed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(teacher_email, cache_key, price_book_id)
        )`,
        `CREATE TABLE IF NOT EXISTS ai_billing_credit_periods_v2 (
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          billing_month TEXT NOT NULL,
          price_book_id TEXT NOT NULL,
          catalog_fingerprint TEXT NOT NULL,
          livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
          qualifying_class_high_water INTEGER NOT NULL DEFAULT 0 CHECK (qualifying_class_high_water >= 0),
          used_credits INTEGER NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(
            teacher_email,
            billing_month,
            price_book_id,
            catalog_fingerprint,
            livemode
          )
        )`,
        `CREATE TABLE IF NOT EXISTS ai_billing_usage_v2 (
          id TEXT PRIMARY KEY,
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          billing_month TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          price_book_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          submission_id TEXT NOT NULL,
          stripe_customer_id TEXT NOT NULL,
          stripe_subscription_id TEXT NOT NULL,
          catalog_fingerprint TEXT NOT NULL,
          livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
          free_credit_applied INTEGER NOT NULL DEFAULT 0 CHECK (free_credit_applied IN (0, 1)),
          base_units INTEGER NOT NULL DEFAULT 1 CHECK (base_units >= 0),
          duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
          output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
          base_attempted_at INTEGER,
          audio_attempted_at INTEGER,
          output_attempted_at INTEGER,
          base_reported_at INTEGER,
          audio_reported_at INTEGER,
          output_reported_at INTEGER,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'reported', 'failed')),
          last_error_dimension TEXT CHECK (last_error_dimension IS NULL OR last_error_dimension IN ('base', 'audio')),
          last_error TEXT NOT NULL DEFAULT '',
          last_failed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(
            teacher_email,
            cache_key,
            price_book_id,
            catalog_fingerprint,
            livemode
          )
        )`,
        `CREATE TABLE IF NOT EXISTS ai_billing_credit_periods_v3 (
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          billing_month TEXT NOT NULL,
          price_book_id TEXT NOT NULL,
          catalog_fingerprint TEXT NOT NULL,
          livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
          qualifying_class_high_water INTEGER NOT NULL DEFAULT 0 CHECK (qualifying_class_high_water >= 0),
          used_credits INTEGER NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(
            teacher_email,
            billing_month,
            price_book_id,
            catalog_fingerprint,
            livemode
          )
        )`,
        `CREATE TABLE IF NOT EXISTS ai_billing_usage_v3 (
          id TEXT PRIMARY KEY,
          teacher_email TEXT NOT NULL COLLATE NOCASE,
          billing_month TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          price_book_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          submission_id TEXT NOT NULL,
          stripe_customer_id TEXT NOT NULL,
          stripe_subscription_id TEXT NOT NULL,
          catalog_fingerprint TEXT NOT NULL,
          billing_contract_id TEXT NOT NULL,
          livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
          free_credit_applied INTEGER NOT NULL DEFAULT 0 CHECK (free_credit_applied IN (0, 1)),
          base_units INTEGER NOT NULL DEFAULT 1 CHECK (base_units >= 0),
          duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
          output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
          base_attempted_at INTEGER,
          audio_attempted_at INTEGER,
          output_attempted_at INTEGER,
          base_reported_at INTEGER,
          audio_reported_at INTEGER,
          output_reported_at INTEGER,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'reported', 'failed')),
          last_error_dimension TEXT CHECK (last_error_dimension IS NULL OR last_error_dimension IN ('base', 'audio')),
          last_error TEXT NOT NULL DEFAULT '',
          last_failed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(
            teacher_email,
            cache_key,
            price_book_id,
            catalog_fingerprint,
            livemode
          )
        )`,
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_class_student ON roster(class_id, LOWER(student_email))",
        "CREATE INDEX IF NOT EXISTS idx_roster_class_id ON roster(class_id)",
        "CREATE INDEX IF NOT EXISTS idx_ai_grading_attempts_submission ON ai_grading_attempts(submission_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_grading_attempts_teacher ON ai_grading_attempts(LOWER(teacher_email), created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_submission_transcripts_owner ON submission_transcripts(LOWER(teacher_email), updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_submission_transcripts_semantic ON submission_transcripts(LOWER(teacher_email), semantic_key)",
        "CREATE INDEX IF NOT EXISTS idx_grading_result_cache_expiry ON grading_result_cache(expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_grading_result_cache_submission ON grading_result_cache(submission_id)",
        "CREATE INDEX IF NOT EXISTS idx_grading_provider_requests_teacher ON grading_provider_requests(LOWER(teacher_email), created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_grading_provider_requests_attempt ON grading_provider_requests(attempt_id)",
        "CREATE INDEX IF NOT EXISTS idx_grading_provider_requests_submission ON grading_provider_requests(submission_id)",
        "CREATE INDEX IF NOT EXISTS idx_grading_provider_requests_created ON grading_provider_requests(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_created ON ai_budget_reservations(created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_stripe_billing_accounts_customer ON stripe_billing_accounts(stripe_customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_stripe_billing_accounts_subscription ON stripe_billing_accounts(stripe_subscription_id)",
        "CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed ON stripe_webhook_events(processed_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_review_allowance_scope ON ai_review_allowance_reservations_v1(teacher_email, scope_key, status)",
        "CREATE INDEX IF NOT EXISTS idx_ai_review_lifetime_bonus_teacher ON ai_review_lifetime_bonus_grants_v1(teacher_email, created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_grading_batches_active_assignment ON ai_grading_batches(teacher_email, assignment_id) WHERE status IN ('queued', 'processing', 'review_ready', 'partial_failure')",
        "CREATE INDEX IF NOT EXISTS idx_ai_grading_batches_owner_updated ON ai_grading_batches(teacher_email, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_grading_batch_items_next ON ai_grading_batch_items(batch_id, status, ordinal)",
        "CREATE INDEX IF NOT EXISTS idx_ai_daily_generation_quota_teacher ON ai_daily_generation_quota_reservations(teacher_email, expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_daily_generation_quota_expiry ON ai_daily_generation_quota_reservations(expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_period_teacher_month ON ai_billing_credit_periods(teacher_email, billing_month)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_usage_pending ON ai_billing_usage(status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_usage_teacher_month ON ai_billing_usage(teacher_email, billing_month, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_period_v2_scope ON ai_billing_credit_periods_v2(teacher_email, billing_month, price_book_id, catalog_fingerprint, livemode)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_usage_v2_pending ON ai_billing_usage_v2(status, livemode, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_usage_v2_scope ON ai_billing_usage_v2(teacher_email, billing_month, price_book_id, catalog_fingerprint, livemode, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_period_v3_scope ON ai_billing_credit_periods_v3(teacher_email, billing_month, price_book_id, catalog_fingerprint, livemode)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_usage_v3_pending ON ai_billing_usage_v3(status, livemode, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_billing_usage_v3_scope ON ai_billing_usage_v3(teacher_email, billing_month, price_book_id, catalog_fingerprint, billing_contract_id, livemode, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_assignments_class_id ON assignments(class_id)",
        "CREATE INDEX IF NOT EXISTS idx_assignments_deleted_at ON assignments(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON submissions(assignment_id)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_student_name ON submissions(student_name)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_student_email ON submissions(student_email)",
        "CREATE INDEX IF NOT EXISTS idx_submissions_deleted_at ON submissions(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_feedback_messages_created_at ON feedback_messages(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)",
        "CREATE INDEX IF NOT EXISTS idx_activity_events_email ON activity_events(email)",
        "CREATE INDEX IF NOT EXISTS idx_activity_events_occurred_at ON activity_events(occurred_at DESC)",
        `CREATE TRIGGER IF NOT EXISTS trg_classes_delete_assignments
          AFTER DELETE ON classes
          FOR EACH ROW
          BEGIN
            DELETE FROM assignments WHERE class_id = OLD.id;
          END`,
        `CREATE TRIGGER IF NOT EXISTS trg_assignments_delete_submissions
          AFTER DELETE ON assignments
          FOR EACH ROW
          BEGIN
            DELETE FROM submissions WHERE assignment_id = OLD.id;
          END`,
      ];
      for (const sql of statements) {
        await rawExecute(sql);
      }
      await migrateAdminAlertOutbox();
      await ensureColumn("classes", "deleted_at", "INTEGER");
      await ensureColumn("classes", "owner_email", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("assignments", "deleted_at", "INTEGER");
      await ensureColumn("assignments", "max_points", "INTEGER NOT NULL DEFAULT 100");
      await ensureColumn("assignments", "rubric", "TEXT");
      await ensureColumn("assignments", "attachment_name", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("assignments", "attachment_url", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("assignments", "attachment_content_type", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("assignments", "max_submissions", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("assignments", "max_recording_seconds", "INTEGER NOT NULL DEFAULT 180");
      await ensureColumn("assignments", "target_language", "TEXT NOT NULL DEFAULT 'Spanish'");
      await ensureColumn("assignments", "auto_transcribe", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("submissions", "student_email", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("submissions", "audio_blob_url", "TEXT");
      await ensureColumn("submissions", "rubric_scores", "TEXT");
      await ensureColumn("submissions", "grade_source", "TEXT NOT NULL DEFAULT 'teacher'");
      await ensureColumn("submissions", "deleted_at", "INTEGER");
      await ensureColumn("feedback_messages", "context_json", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(
        "ai_review_allowance_reservations_v1",
        "source_kind",
        "TEXT NOT NULL DEFAULT 'grading'",
      );
      await ensureColumn(
        "ai_grading_batches",
        "transcripts_required",
        "INTEGER NOT NULL DEFAULT 0",
      );
      await ensureColumn("users", "is_paid", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(
        "users",
        "ai_access_grant_source",
        "TEXT NOT NULL DEFAULT ''",
      );
      await migrateAiAccessGrantProvenance();
      await ensureColumn("users", "default_language", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(
        "stripe_billing_accounts",
        "catalog_fingerprint",
        "TEXT NOT NULL DEFAULT ''"
      );
      await ensureColumn(
        "stripe_billing_accounts",
        "livemode",
        "INTEGER NOT NULL DEFAULT 0"
      );
      await ensureColumn(
        "stripe_billing_accounts",
        "projection_revision",
        "INTEGER NOT NULL DEFAULT 0"
      );
      await ensureColumn(
        "stripe_billing_accounts",
        "stripe_account_id",
        "TEXT NOT NULL DEFAULT ''"
      );
      await ensureColumn(
        "stripe_billing_accounts",
        "billing_contract_id",
        "TEXT NOT NULL DEFAULT ''"
      );
      await ensureColumn(
        "stripe_billing_accounts",
        "subscription_period_start",
        "INTEGER NOT NULL DEFAULT 0"
      );
      await ensureColumn(
        "stripe_billing_accounts",
        "subscription_period_end",
        "INTEGER NOT NULL DEFAULT 0"
      );
      await ensureColumn("ai_grading_attempts", "cache_key", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(
        "ai_grading_attempts",
        "assignment_fingerprint",
        "TEXT NOT NULL DEFAULT ''",
      );
      await ensureColumn("ai_grading_attempts", "cache_hit", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "input_tokens", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "cached_input_tokens", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "output_tokens", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "latency_ms", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "retries", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "escalated", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "escalation_reason", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("ai_grading_attempts", "estimated_cost_microusd", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "prompt_version", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("ai_grading_attempts", "result_source", "TEXT NOT NULL DEFAULT 'ai'");
      await ensureColumn(
        "ai_grading_attempts",
        "delivery_status",
        "TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'withheld', 'not_applicable'))",
      );
      await migrateAiAttemptDeliveryStatus();
      await ensureColumn("ai_grading_attempts", "billing_required", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ai_grading_attempts", "billing_price_book_id", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(
        "ai_grading_attempts",
        "billing_stripe_customer_id",
        "TEXT NOT NULL DEFAULT ''"
      );
      await ensureColumn(
        "ai_grading_attempts",
        "billing_stripe_subscription_id",
        "TEXT NOT NULL DEFAULT ''"
      );
      await ensureColumn(
        "ai_grading_attempts",
        "billing_catalog_fingerprint",
        "TEXT NOT NULL DEFAULT ''"
      );
      await ensureColumn(
        "ai_grading_attempts",
        "billing_contract_id",
        "TEXT NOT NULL DEFAULT ''"
      );
      await ensureColumn(
        "ai_grading_attempts",
        "billing_livemode",
        "INTEGER NOT NULL DEFAULT 0"
      );
      await ensureColumn(
        "ai_grading_attempts",
        "billing_qualifying_class_high_water",
        "INTEGER NOT NULL DEFAULT 0"
      );
      await ensureColumn(
        "ai_grading_attempts",
        "billing_free_credit_applied",
        "INTEGER NOT NULL DEFAULT 0"
      );
      await ensureColumn("ai_grading_attempts", "billable_output_tokens", "INTEGER NOT NULL DEFAULT 0");
      await rawExecute(
        "CREATE INDEX IF NOT EXISTS idx_ai_grading_attempts_cache ON ai_grading_attempts(cache_key)"
      );
      await rawExecute(
        "CREATE INDEX IF NOT EXISTS idx_automatic_transcription_jobs_due ON automatic_transcription_jobs(status, next_attempt_at, lease_expires_at, created_at)"
      );
    })();
    initPromise = initialization.catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

async function query(sql: string, args: InValue[] = []) {
  await ensureInitialized();
  return withTimeout(sql, () => getDbClient().execute({ sql, args }));
}

async function writeBatch(statements: InStatement[]) {
  await ensureInitialized();
  return withTimeout("database write batch", () =>
    getDbClient().batch(statements, "write")
  );
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function toNonNegativeInteger(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function toNullableNumber(value: unknown) {
  if (value === null || typeof value === "undefined") return null;
  return Number(value);
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function requireTrimmedValue(name: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required.`);
  return trimmed;
}

function requireNonNegativeInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizeBillingTeacherEmail(value: string) {
  return requireTrimmedValue("teacherEmail", value).toLowerCase();
}

function requireNonNegativeFiniteNumber(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
  return value;
}

function normalizeSubscriptionPeriod(input: {
  subscriptionStatus: string;
  subscriptionPeriodStart?: number;
  subscriptionPeriodEnd?: number;
}) {
  const status = input.subscriptionStatus.trim().toLowerCase();
  const periodStart = requireNonNegativeInteger(
    "subscriptionPeriodStart",
    input.subscriptionPeriodStart ?? 0,
  );
  const periodEnd = requireNonNegativeInteger(
    "subscriptionPeriodEnd",
    input.subscriptionPeriodEnd ?? 0,
  );
  if (status === "active") {
    if (periodStart <= 0 || periodEnd <= periodStart) {
      throw new RangeError(
        "An active Stripe subscription requires one valid current billing period.",
      );
    }
    return { periodStart, periodEnd };
  }
  if (periodStart !== 0 || periodEnd !== 0) {
    throw new RangeError(
      "A non-entitled Stripe subscription cannot retain an active billing period.",
    );
  }
  return { periodStart: 0, periodEnd: 0 };
}

type ReadyStripeUsageScope = Readonly<{
  keyMode: StripeKeyMode;
  accountId: string;
  billingContractId: string;
}>;

type ReadyStripeSubscriptionScope = Readonly<{
  keyMode: StripeKeyMode;
  accountId: string;
  billingContractId: string;
}>;

async function getReadyStripeSubscriptionScope(): Promise<ReadyStripeSubscriptionScope | null> {
  const availability = getStripeSubscriptionBillingAvailability();
  if (!availability.available) return null;
  if (!(await isStripeSubscriptionRuntimeReady())) return null;
  if (!(await isStripeBillingStorageReady())) return null;
  const config = requireStripeSubscriptionBillingConfig();
  return Object.freeze({
    keyMode: config.keyMode,
    accountId: config.accountId,
    billingContractId: getStripeBillingContractId(config),
  });
}

async function getReadyStripeUsageScope(): Promise<ReadyStripeUsageScope | null> {
  const availability = getStripeUsageBillingAvailability();
  if (!availability.available) return null;
  if (!(await isStripeUsageRuntimeReady())) return null;
  if (!(await isStripeBillingStorageReady())) return null;
  const config = requireStripeUsageBillingConfig();
  return Object.freeze({
    keyMode: config.keyMode,
    accountId: config.accountId,
    billingContractId: getStripeBillingContractId(config),
  });
}

function normalizeBillingMonth(value: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
    throw new Error("billingMonth must use UTC YYYY-MM format.");
  }
  return trimmed;
}

export function getAiBillingUtcMonth(now = Date.now()) {
  requireNonNegativeInteger("now", now);
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toProtectedAudioPath(id: string) {
  return `/api/submissions/${id}/audio`;
}

function toStudentProtectedAudioPath(id: string) {
  return `/api/student/submissions/${id}/audio`;
}

function parseJsonValue<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function stringifyJsonValue(value: unknown) {
  return value === null ? null : JSON.stringify(value);
}

const ADMIN_ALERT_DESTINATIONS = new Set<AdminAlertDestination>([
  "traction",
  "revenue",
  "milestones",
  "pulse",
  "incidents",
]);
const ADMIN_ALERT_ENVIRONMENTS = new Set<AdminAlertEnvironment>([
  "production",
  "preview",
  "development",
  "test",
]);

function normalizeAdminAlertOutboxInsert(
  input: AdminAlertOutboxInsert,
): AdminAlertOutboxInsert {
  const id = requireTrimmedValue("admin alert id", input.id);
  const dedupeKey = requireTrimmedValue("admin alert dedupeKey", input.dedupeKey);
  const eventType = requireTrimmedValue("admin alert eventType", input.eventType);
  const safePayloadJson = requireTrimmedValue(
    "admin alert safePayloadJson",
    input.safePayloadJson,
  );
  if (!/^[A-Za-z0-9._:-]{1,255}$/.test(id)) {
    throw new Error("admin alert id contains unsupported characters.");
  }
  if (!/^[A-Za-z0-9._:-]{1,512}$/.test(dedupeKey)) {
    throw new Error("admin alert dedupeKey contains unsupported characters.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(eventType)) {
    throw new Error("admin alert eventType is invalid.");
  }
  if (!ADMIN_ALERT_DESTINATIONS.has(input.destination)) {
    throw new Error("admin alert destination is invalid.");
  }
  if (!ADMIN_ALERT_ENVIRONMENTS.has(input.environment)) {
    throw new Error("admin alert environment is invalid.");
  }
  if (safePayloadJson.length > 16_000) {
    throw new Error("admin alert safe payload is too large.");
  }
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(safePayloadJson);
  } catch {
    throw new Error("admin alert safe payload must be valid JSON.");
  }
  if (!parsedPayload || Array.isArray(parsedPayload) || typeof parsedPayload !== "object") {
    throw new Error("admin alert safe payload must be a JSON object.");
  }
  return {
    id,
    dedupeKey,
    eventType,
    destination: input.destination,
    safePayloadJson,
    environment: input.environment,
    nextAttemptAt: requireNonNegativeInteger(
      "admin alert nextAttemptAt",
      input.nextAttemptAt,
    ),
    createdAt: requireNonNegativeInteger("admin alert createdAt", input.createdAt),
  };
}

function rowToAdminAlertOutbox(row: Row): AdminAlertOutboxRow {
  return {
    id: toStringValue(row.id),
    dedupeKey: toStringValue(row.dedupeKey),
    eventType: toStringValue(row.eventType),
    destination: toStringValue(row.destination) as AdminAlertDestination,
    safePayloadJson: toStringValue(row.safePayloadJson),
    environment: toStringValue(row.environment) as AdminAlertEnvironment,
    status: toStringValue(row.status) as AdminAlertOutboxStatus,
    attemptCount: toNumber(row.attemptCount),
    nextAttemptAt: toNumber(row.nextAttemptAt),
    createdAt: toNumber(row.createdAt),
    deliveredAt: toNullableNumber(row.deliveredAt),
    lastErrorCode: toStringValue(row.lastErrorCode),
    leaseToken: toStringValue(row.leaseToken),
    leaseExpiresAt: toNumber(row.leaseExpiresAt),
  };
}

const ADMIN_ALERT_OUTBOX_SELECT = `SELECT
  id,
  dedupe_key as dedupeKey,
  event_type as eventType,
  destination,
  safe_payload_json as safePayloadJson,
  environment,
  status,
  attempt_count as attemptCount,
  next_attempt_at as nextAttemptAt,
  created_at as createdAt,
  delivered_at as deliveredAt,
  last_error_code as lastErrorCode,
  lease_token as leaseToken,
  lease_expires_at as leaseExpiresAt
FROM admin_alert_outbox`;

export async function enqueueAdminAlertOutbox(
  inputs: readonly AdminAlertOutboxInsert[],
): Promise<Array<{ inserted: boolean; row: AdminAlertOutboxRow }>> {
  if (inputs.length === 0) return [];
  if (inputs.length > 20) {
    throw new RangeError("At most 20 admin alerts can be enqueued atomically.");
  }
  const normalized = inputs.map(normalizeAdminAlertOutboxInsert);
  const statements: InStatement[] = [];
  for (const input of normalized) {
    statements.push(
      {
        sql: `INSERT INTO admin_alert_outbox (
          id,
          dedupe_key,
          event_type,
          destination,
          safe_payload_json,
          environment,
          status,
          attempt_count,
          next_attempt_at,
          created_at,
          delivered_at,
          last_error_code,
          lease_token,
          lease_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, '', '', 0)
        ON CONFLICT(dedupe_key) DO NOTHING`,
        args: [
          input.id,
          input.dedupeKey,
          input.eventType,
          input.destination,
          input.safePayloadJson,
          input.environment,
          input.nextAttemptAt,
          input.createdAt,
        ],
      },
      {
        sql: `${ADMIN_ALERT_OUTBOX_SELECT} WHERE dedupe_key = ? LIMIT 1`,
        args: [input.dedupeKey],
      },
    );
  }
  const results = await writeBatch(statements);
  return normalized.map((_, index) => {
    const insertResult = results[index * 2];
    const row = results[index * 2 + 1]?.rows[0];
    if (!row) throw new Error("Admin alert outbox insert could not be verified.");
    return {
      inserted: toNumber(insertResult?.rowsAffected) === 1,
      row: rowToAdminAlertOutbox(row),
    };
  });
}

export async function getAdminAlertOutboxByDedupeKey(
  dedupeKey: string,
): Promise<AdminAlertOutboxRow | null> {
  const normalized = requireTrimmedValue("admin alert dedupeKey", dedupeKey);
  const result = await query(
    `${ADMIN_ALERT_OUTBOX_SELECT} WHERE dedupe_key = ? LIMIT 1`,
    [normalized],
  );
  return result.rows[0] ? rowToAdminAlertOutbox(result.rows[0]) : null;
}

export async function claimPendingAdminAlertOutbox(input: {
  environment: AdminAlertEnvironment;
  limit?: number;
  now?: number;
  leaseMs?: number;
  maxAttempts?: number;
}): Promise<AdminAlertOutboxRow[]> {
  if (!ADMIN_ALERT_ENVIRONMENTS.has(input.environment)) {
    throw new Error("admin alert environment is invalid.");
  }
  const limit = Math.max(
    1,
    Math.min(
      requireNonNegativeInteger(
        "admin alert claim limit",
        input.limit ?? ADMIN_ALERT_OUTBOX_MAX_CLAIM,
      ),
      ADMIN_ALERT_OUTBOX_MAX_CLAIM,
    ),
  );
  const now = requireNonNegativeInteger("admin alert claim now", input.now ?? Date.now());
  const leaseMs = Math.max(
    1_000,
    Math.min(
      requireNonNegativeInteger("admin alert leaseMs", input.leaseMs ?? 30_000),
      300_000,
    ),
  );
  const maxAttempts = Math.max(
    1,
    Math.min(
      requireNonNegativeInteger("admin alert maxAttempts", input.maxAttempts ?? 6),
      20,
    ),
  );
  const leaseToken = makeId("alertlease");
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    await transaction.execute({
      sql: `UPDATE admin_alert_outbox
        SET status = 'dead',
            last_error_code = CASE
              WHEN last_error_code = '' THEN 'attempts_exhausted' ELSE last_error_code
            END,
            lease_token = '',
            lease_expires_at = 0
        WHERE environment = ?
          AND status = 'pending'
          AND attempt_count >= ?
          AND lease_expires_at <= ?`,
      args: [input.environment, maxAttempts, now],
    });
    const candidates = await transaction.execute({
      sql: `SELECT id
        FROM admin_alert_outbox
        WHERE environment = ?
          AND status = 'pending'
          AND attempt_count < ?
          AND next_attempt_at <= ?
          AND (lease_token = '' OR lease_expires_at <= ?)
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        LIMIT ?`,
      args: [input.environment, maxAttempts, now, now, limit],
    });
    const ids = candidates.rows.map((row) => toStringValue(row.id));
    if (ids.length === 0) {
      await transaction.commit();
      return [];
    }
    const placeholders = ids.map(() => "?").join(", ");
    await transaction.execute({
      sql: `UPDATE admin_alert_outbox
        SET lease_token = ?,
            lease_expires_at = ?,
            attempt_count = attempt_count + 1
        WHERE id IN (${placeholders})
          AND environment = ?
          AND status = 'pending'
          AND attempt_count < ?
          AND next_attempt_at <= ?
          AND (lease_token = '' OR lease_expires_at <= ?)`,
      args: [
        leaseToken,
        now + leaseMs,
        ...ids,
        input.environment,
        maxAttempts,
        now,
        now,
      ],
    });
    const claimed = await transaction.execute({
      sql: `${ADMIN_ALERT_OUTBOX_SELECT}
        WHERE lease_token = ?
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC`,
      args: [leaseToken],
    });
    await transaction.commit();
    return claimed.rows.map(rowToAdminAlertOutbox);
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function markAdminAlertOutboxDelivered(input: {
  id: string;
  leaseToken: string;
  deliveredAt?: number;
}): Promise<boolean> {
  const id = requireTrimmedValue("admin alert id", input.id);
  const leaseToken = requireTrimmedValue("admin alert leaseToken", input.leaseToken);
  const deliveredAt = requireNonNegativeInteger(
    "admin alert deliveredAt",
    input.deliveredAt ?? Date.now(),
  );
  const result = await query(
    `UPDATE admin_alert_outbox
      SET status = 'delivered',
          delivered_at = ?,
          last_error_code = '',
          lease_token = '',
          lease_expires_at = 0
      WHERE id = ?
        AND status = 'pending'
        AND lease_token = ?`,
    [deliveredAt, id, leaseToken],
  );
  return toNumber(result.rowsAffected) === 1;
}

export async function markAdminAlertOutboxFailed(input: {
  id: string;
  leaseToken: string;
  errorCode: string;
  retryable: boolean;
  nextAttemptAt: number;
  maxAttempts?: number;
}): Promise<{ updated: boolean; status: AdminAlertOutboxStatus | null }> {
  const id = requireTrimmedValue("admin alert id", input.id);
  const leaseToken = requireTrimmedValue("admin alert leaseToken", input.leaseToken);
  const errorCode = requireTrimmedValue("admin alert errorCode", input.errorCode);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(errorCode)) {
    throw new Error("admin alert errorCode is invalid.");
  }
  const nextAttemptAt = requireNonNegativeInteger(
    "admin alert nextAttemptAt",
    input.nextAttemptAt,
  );
  const maxAttempts = Math.max(
    1,
    Math.min(
      requireNonNegativeInteger("admin alert maxAttempts", input.maxAttempts ?? 6),
      20,
    ),
  );
  const results = await writeBatch([
    {
      sql: `UPDATE admin_alert_outbox
        SET status = CASE
              WHEN ? = 0 OR attempt_count >= ? THEN 'dead' ELSE 'pending'
            END,
            next_attempt_at = ?,
            delivered_at = NULL,
            last_error_code = ?,
            lease_token = '',
            lease_expires_at = 0
        WHERE id = ?
          AND status = 'pending'
          AND lease_token = ?`,
      args: [
        input.retryable ? 1 : 0,
        maxAttempts,
        nextAttemptAt,
        errorCode,
        id,
        leaseToken,
      ],
    },
    {
      sql: `${ADMIN_ALERT_OUTBOX_SELECT} WHERE id = ? LIMIT 1`,
      args: [id],
    },
  ]);
  const row = results[1]?.rows[0];
  return {
    updated: toNumber(results[0]?.rowsAffected) === 1,
    status: row ? rowToAdminAlertOutbox(row).status : null,
  };
}

async function queryAdminAlertOutboxHealth(input: {
  now: number;
  environment?: AdminAlertEnvironment;
  excludeIncidentEvents?: boolean;
}): Promise<AdminAlertOutboxHealth> {
  const safeNow = requireNonNegativeInteger("admin alert health now", input.now);
  const staleBefore = Math.max(0, safeNow - 10 * 60_000);
  const where = ["1 = 1"];
  const args: InValue[] = [safeNow, safeNow, staleBefore];
  if (input.environment) {
    if (!ADMIN_ALERT_ENVIRONMENTS.has(input.environment)) {
      throw new Error("admin alert environment is invalid.");
    }
    where.push("environment = ?");
    args.push(input.environment);
  }
  if (input.excludeIncidentEvents) where.push("event_type <> 'incident'");
  const result = await query(
    `SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE
        WHEN status = 'pending'
          AND next_attempt_at <= ?
          AND (lease_token = '' OR lease_expires_at <= ?)
        THEN 1 ELSE 0 END) as due,
      SUM(CASE
        WHEN status = 'pending' AND created_at <= ?
        THEN 1 ELSE 0 END) as stale,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) as dead,
      MIN(CASE WHEN status = 'pending' THEN created_at END) as oldestPendingAt
    FROM admin_alert_outbox
    WHERE ${where.join(" AND ")}`,
    args,
  );
  const row = result.rows[0];
  return {
    pending: toNumber(row?.pending),
    due: toNumber(row?.due),
    stale: toNumber(row?.stale),
    delivered: toNumber(row?.delivered),
    dead: toNumber(row?.dead),
    oldestPendingAt: toNullableNumber(row?.oldestPendingAt),
  };
}

export async function getAdminAlertOutboxHealth(
  now = Date.now(),
): Promise<AdminAlertOutboxHealth> {
  return queryAdminAlertOutboxHealth({ now });
}

export async function getAdminAlertOutboxHealthForEnvironment(
  environment: AdminAlertEnvironment,
  now = Date.now(),
  options: { excludeIncidentEvents?: boolean } = {},
): Promise<AdminAlertOutboxHealth> {
  return queryAdminAlertOutboxHealth({
    now,
    environment,
    excludeIncidentEvents: options.excludeIncidentEvents,
  });
}

const TEACHER_PLAN_MONTHLY_CENTS = TEACHER_AI_PRICE_BOOK.monthlyPriceUsd * 100;
// Planning estimate: 2.9% card processing + 0.7% Stripe Billing.
const ESTIMATED_STRIPE_PERCENT_FEE = 0.036;
const ESTIMATED_STRIPE_FIXED_FEE_CENTS = 30;

function estimatedStripeFeeCents(successfulCharges: number) {
  const safeCharges = Math.max(0, Math.floor(successfulCharges));
  const perCharge = Math.round(TEACHER_PLAN_MONTHLY_CENTS * ESTIMATED_STRIPE_PERCENT_FEE)
    + ESTIMATED_STRIPE_FIXED_FEE_CENTS;
  return safeCharges * perCharge;
}

function estimatedProviderCents(microusd: unknown) {
  const amount = toNumber(microusd);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount / 10_000);
}

function validateAdminAlertAggregateScope(input: {
  environment: AdminAlertEnvironment;
  livemode: boolean;
}) {
  if (!ADMIN_ALERT_ENVIRONMENTS.has(input.environment)) {
    throw new Error("admin alert environment is invalid.");
  }
  return {
    environment: input.environment,
    livemode: input.livemode ? 1 : 0,
  };
}

/**
 * Returns aggregate-only operational metrics for one half-open time window.
 * No account, student, class, submission, Stripe, or provider identifiers are
 * selected into the result.
 */
export async function getAdminAlertPeriodAggregate(input: {
  startAt: number;
  endAt: number;
  snapshotAt?: number;
  environment: AdminAlertEnvironment;
  livemode: boolean;
}): Promise<AdminAlertPeriodAggregate> {
  const startAt = requireNonNegativeInteger("admin alert aggregate startAt", input.startAt);
  const endAt = requireNonNegativeInteger("admin alert aggregate endAt", input.endAt);
  const snapshotAt = requireNonNegativeInteger(
    "admin alert aggregate snapshotAt",
    input.snapshotAt ?? endAt,
  );
  if (endAt <= startAt) {
    throw new RangeError("admin alert aggregate endAt must be after startAt.");
  }
  const scope = validateAdminAlertAggregateScope(input);
  const result = await query(
    `WITH
      params AS (
        SELECT
          ? AS startAt,
          ? AS endAt,
          ? AS snapshotAt,
          ? AS livemode,
          ? AS environment
      ),
      internal_accounts(email) AS (
        VALUES (LOWER(?)), (LOWER(?)), (LOWER(?))
      ),
      unique_successful_ai AS (
        SELECT
          LOWER(teacher_email) as teacherEmail,
          CASE WHEN TRIM(cache_key) <> '' THEN cache_key ELSE id END as semanticKey,
          MIN(COALESCE(completed_at, created_at)) as completedAt,
          MIN(duration_seconds) as durationSeconds
        FROM ai_grading_attempts
        WHERE status = 'completed'
          AND delivery_status IN ('delivered', 'not_applicable')
          AND suggested_score IS NOT NULL
          AND TRIM(error_code) = ''
          AND teacher_attention <> 'unable_to_grade'
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
        GROUP BY
          LOWER(teacher_email),
          CASE WHEN TRIM(cache_key) <> '' THEN cache_key ELSE id END
      ),
      period_successful_ai AS (
        SELECT successful.*
        FROM unique_successful_ai successful, params
        WHERE successful.completedAt >= params.startAt
          AND successful.completedAt < params.endAt
      ),
      ranked_durations AS (
        SELECT
          durationSeconds,
          ROW_NUMBER() OVER (ORDER BY durationSeconds ASC, semanticKey ASC) as rowNumber,
          COUNT(*) OVER () as sampleCount
        FROM period_successful_ai
        WHERE durationSeconds > 0
      ),
      free_lifetime_bonus_totals AS (
        SELECT LOWER(teacher_email) as teacherEmail, SUM(units) as bonusUnits
        FROM ai_review_lifetime_bonus_grants_v1
        GROUP BY LOWER(teacher_email)
      ),
      free_exhausted AS (
        SELECT
          LOWER(reservation.teacher_email) as teacherEmail,
          MAX(reservation.consumed_at) as exhaustedAt
        FROM ai_review_allowance_reservations_v1 reservation
        LEFT JOIN free_lifetime_bonus_totals bonus
          ON bonus.teacherEmail = LOWER(reservation.teacher_email)
        WHERE reservation.allowance_kind = 'free_lifetime'
          AND reservation.status = 'consumed'
          AND reservation.consumed_at IS NOT NULL
          AND LOWER(reservation.teacher_email) NOT IN (SELECT email FROM internal_accounts)
        GROUP BY LOWER(reservation.teacher_email)
        HAVING COUNT(*) >= ${AI_REVIEW_FREE_LIFETIME_LIMIT} + COALESCE(MAX(bonus.bonusUnits), 0)
      ),
      period_revenue_events AS (
        SELECT event_type as eventType, safe_payload_json as payload
        FROM admin_alert_outbox, params
        WHERE destination = 'revenue'
          AND admin_alert_outbox.environment = params.environment
          AND created_at >= params.startAt
          AND created_at < params.endAt
      ),
      period_traction_events AS (
        SELECT event_type as eventType
        FROM admin_alert_outbox, params
        WHERE destination = 'traction'
          AND admin_alert_outbox.environment = params.environment
          AND created_at >= params.startAt
          AND created_at < params.endAt
      ),
      active_paid AS (
        SELECT COUNT(*) as count
        FROM stripe_billing_accounts account, params
        WHERE account.subscription_status = 'active'
          AND TRIM(account.stripe_subscription_id) <> ''
          AND account.created_at < params.snapshotAt
          AND account.subscription_period_end > params.snapshotAt
          AND account.livemode = params.livemode
          AND account.price_book_id = ?
          AND account.catalog_fingerprint = ?
          AND LOWER(account.teacher_email) NOT IN (SELECT email FROM internal_accounts)
      )
    SELECT
      (SELECT COUNT(*) FROM period_traction_events
        WHERE eventType = 'teacher.signed_up') as newTeachers,
      (SELECT COUNT(*) FROM period_traction_events
        WHERE eventType = 'teacher.activated') as activatedTeachers,
      (SELECT COUNT(*) FROM period_revenue_events
        WHERE eventType = 'subscription.started') as newPaidTeachers,
      (SELECT COUNT(*) FROM free_exhausted, params
        WHERE exhaustedAt >= params.startAt
          AND exhaustedAt < params.endAt) as eligibleFreeTeachers,
      (SELECT COUNT(*)
        FROM free_exhausted exhausted
        JOIN stripe_billing_accounts account
          ON LOWER(account.teacher_email) = exhausted.teacherEmail
        JOIN params
        WHERE exhausted.exhaustedAt >= params.startAt
          AND exhausted.exhaustedAt < params.endAt
          AND account.created_at < params.endAt
          AND TRIM(account.stripe_subscription_id) <> ''
          AND account.livemode = params.livemode
          AND LOWER(account.teacher_email) NOT IN (SELECT email FROM internal_accounts)
      ) as convertedEligibleFreeTeachers,
      (SELECT COUNT(*)
        FROM assignments assignment
        JOIN classes class ON class.id = assignment.class_id
        JOIN params
        WHERE assignment.deleted_at IS NULL
          AND class.deleted_at IS NULL
          AND assignment.created_at >= params.startAt
          AND assignment.created_at < params.endAt
          AND LOWER(class.owner_email) NOT IN (SELECT email FROM internal_accounts)
      ) as assignmentsPublished,
      (SELECT COUNT(*)
        FROM submissions submission
        JOIN assignments assignment ON assignment.id = submission.assignment_id
        JOIN classes class ON class.id = assignment.class_id
        JOIN params
        WHERE submission.deleted_at IS NULL
          AND assignment.deleted_at IS NULL
          AND class.deleted_at IS NULL
          AND submission.submitted_at >= params.startAt
          AND submission.submitted_at < params.endAt
          AND LOWER(class.owner_email) NOT IN (SELECT email FROM internal_accounts)
      ) as recordingsReceived,
      (SELECT COUNT(*) FROM period_successful_ai) as successfulAiReviews,
      (SELECT COUNT(*) FROM ai_grading_attempts, params
        WHERE COALESCE(completed_at, created_at) >= params.startAt
          AND COALESCE(completed_at, created_at) < params.endAt
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
      ) as aiAttempts,
      (SELECT COUNT(*) FROM ai_grading_attempts, params
        WHERE (
            status <> 'completed'
            OR delivery_status NOT IN ('delivered', 'not_applicable')
            OR suggested_score IS NULL
            OR TRIM(error_code) <> ''
            OR teacher_attention = 'unable_to_grade'
          )
          AND COALESCE(completed_at, created_at) >= params.startAt
          AND COALESCE(completed_at, created_at) < params.endAt
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
      ) as aiFailures,
      (SELECT COALESCE(SUM(retries), 0) FROM ai_grading_attempts, params
        WHERE COALESCE(completed_at, created_at) >= params.startAt
          AND COALESCE(completed_at, created_at) < params.endAt
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
      ) as retryCount,
      (SELECT COUNT(*) FROM ranked_durations) as durationSampleCount,
      COALESCE((SELECT durationSeconds FROM ranked_durations
        WHERE rowNumber = CAST((sampleCount + 1) / 2 AS INTEGER)
        LIMIT 1), 0) as medianDurationSeconds,
      COALESCE((SELECT durationSeconds FROM ranked_durations
        WHERE rowNumber = CAST((sampleCount * 9 + 9) / 10 AS INTEGER)
        LIMIT 1), 0) as p90DurationSeconds,
      (SELECT count FROM active_paid) as activePaidTeachers,
      (SELECT COALESCE(SUM(
        CASE WHEN eventType = 'subscription.started'
          THEN CAST(json_extract(payload, '$.amountCents') AS INTEGER)
          ELSE 0 END
      ), 0) FROM period_revenue_events) as newMrrCents,
      (SELECT COALESCE(SUM(
        CASE WHEN eventType IN ('subscription.started', 'subscription.renewed')
          THEN CAST(json_extract(payload, '$.amountCents') AS INTEGER)
          ELSE 0 END
      ), 0) FROM period_revenue_events) as recognizedRevenueCents,
      (SELECT COUNT(*) FROM period_revenue_events
        WHERE eventType = 'subscription.cancelled') as cancellations,
      (SELECT COALESCE(SUM(
        CASE WHEN eventType = 'refund.issued'
          THEN CAST(json_extract(payload, '$.amountCents') AS INTEGER)
          ELSE 0 END
      ), 0) FROM period_revenue_events) as refundsCents,
      (SELECT COUNT(*) FROM period_revenue_events
        WHERE eventType = 'payment.failed') as failedPayments,
      (SELECT COALESCE(SUM(estimated_cost_microusd), 0)
        FROM grading_provider_requests, params
        WHERE created_at >= params.startAt
          AND created_at < params.endAt
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
      ) as estimatedProviderSpendMicrousd,
      (SELECT COUNT(*) FROM period_revenue_events
        WHERE eventType IN ('subscription.started', 'subscription.renewed')) as successfulCharges,
      (SELECT COUNT(*) FROM period_revenue_events
        WHERE eventType = 'trial.exhausted') as freeTrialsExhausted,
      (SELECT COUNT(*) FROM period_revenue_events
        WHERE eventType = 'allowance.near_limit') as nearPaidLimitTeachers,
      (SELECT COUNT(*) FROM period_revenue_events
        WHERE eventType = 'allowance.exhausted') as paidLimitExhaustedTeachers,
      (SELECT COUNT(*) FROM period_revenue_events
        WHERE eventType = 'school.lead') as schoolLeads`,
    [
      startAt,
      endAt,
      snapshotAt,
      scope.livemode,
      scope.environment,
      ...INTERNAL_TEST_EMAILS,
      STRIPE_CATALOG_MANIFEST.priceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
    ],
  );
  const row = result.rows[0];
  const activePaidTeachers = toNumber(row?.activePaidTeachers);
  const recognizedRevenueCents = toNumber(row?.recognizedRevenueCents);
  const refundsCents = toNumber(row?.refundsCents);
  const estimatedProviderSpendCents = estimatedProviderCents(
    row?.estimatedProviderSpendMicrousd,
  );
  const estimatedStripeFeesCents = estimatedStripeFeeCents(
    toNumber(row?.successfulCharges),
  );
  return {
    newTeachers: toNumber(row?.newTeachers),
    activatedTeachers: toNumber(row?.activatedTeachers),
    newPaidTeachers: toNumber(row?.newPaidTeachers),
    eligibleFreeTeachers: toNumber(row?.eligibleFreeTeachers),
    convertedEligibleFreeTeachers: toNumber(row?.convertedEligibleFreeTeachers),
    assignmentsPublished: toNumber(row?.assignmentsPublished),
    recordingsReceived: toNumber(row?.recordingsReceived),
    successfulAiReviews: toNumber(row?.successfulAiReviews),
    aiAttempts: toNumber(row?.aiAttempts),
    aiFailures: toNumber(row?.aiFailures),
    retryCount: toNumber(row?.retryCount),
    durationSampleCount: toNumber(row?.durationSampleCount),
    medianDurationSeconds: toNumber(row?.medianDurationSeconds),
    p90DurationSeconds: toNumber(row?.p90DurationSeconds),
    activePaidTeachers,
    mrrCents: activePaidTeachers * TEACHER_PLAN_MONTHLY_CENTS,
    newMrrCents: toNumber(row?.newMrrCents),
    recognizedRevenueCents,
    cancellations: toNumber(row?.cancellations),
    refundsCents,
    failedPayments: toNumber(row?.failedPayments),
    estimatedProviderSpendCents,
    estimatedStripeFeesCents,
    estimatedContributionCents:
      recognizedRevenueCents
      - refundsCents
      - estimatedProviderSpendCents
      - estimatedStripeFeesCents,
    freeTrialsExhausted: toNumber(row?.freeTrialsExhausted),
    nearPaidLimitTeachers: toNumber(row?.nearPaidLimitTeachers),
    paidLimitExhaustedTeachers: toNumber(row?.paidLimitExhaustedTeachers),
    schoolLeads: toNumber(row?.schoolLeads),
  };
}

/** Returns cumulative, aggregate-only values used to dedupe milestone alerts. */
export async function getAdminAlertMilestoneAggregate(input: {
  now?: number;
  environment: AdminAlertEnvironment;
  livemode: boolean;
}): Promise<AdminAlertMilestoneAggregate> {
  const now = requireNonNegativeInteger("admin alert milestone now", input.now ?? Date.now());
  const scope = validateAdminAlertAggregateScope(input);
  const result = await query(
    `WITH
      params AS (
        SELECT ? AS now, ? AS livemode, ? AS environment
      ),
      internal_accounts(email) AS (
        VALUES (LOWER(?)), (LOWER(?)), (LOWER(?))
      ),
      unique_successful_ai AS (
        SELECT
          LOWER(teacher_email) as teacherEmail,
          CASE WHEN TRIM(cache_key) <> '' THEN cache_key ELSE id END as semanticKey
        FROM ai_grading_attempts, params
        WHERE status = 'completed'
          AND delivery_status IN ('delivered', 'not_applicable')
          AND suggested_score IS NOT NULL
          AND TRIM(error_code) = ''
          AND teacher_attention <> 'unable_to_grade'
          AND COALESCE(completed_at, created_at) <= params.now
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
        GROUP BY
          LOWER(teacher_email),
          CASE WHEN TRIM(cache_key) <> '' THEN cache_key ELSE id END
      ),
      active_paid AS (
        SELECT COUNT(*) as count
        FROM stripe_billing_accounts account, params
        WHERE account.subscription_status = 'active'
          AND TRIM(account.stripe_subscription_id) <> ''
          AND account.created_at <= params.now
          AND account.subscription_period_end > params.now
          AND account.livemode = params.livemode
          AND account.price_book_id = ?
          AND account.catalog_fingerprint = ?
          AND LOWER(account.teacher_email) NOT IN (SELECT email FROM internal_accounts)
      )
    SELECT
      (SELECT COUNT(*) FROM users, params
        WHERE role = 'teacher'
          AND created_at <= params.now
          AND LOWER(email) NOT IN (SELECT email FROM internal_accounts)
      ) as totalTeachers,
      (SELECT COUNT(DISTINCT LOWER(c.owner_email))
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        JOIN params
        WHERE s.submitted_at <= params.now
          AND s.deleted_at IS NULL
          AND a.deleted_at IS NULL
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) NOT IN (SELECT email FROM internal_accounts)
      ) as activatedTeachers,
      (SELECT count FROM active_paid) as paidTeachers,
      (SELECT COUNT(*) FROM unique_successful_ai) as successfulAiReviews,
      (SELECT COUNT(*)
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        JOIN params
        WHERE s.submitted_at <= params.now
          AND s.deleted_at IS NULL
          AND a.deleted_at IS NULL
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) NOT IN (SELECT email FROM internal_accounts)
      ) as studentRecordings,
      (SELECT COUNT(*) FROM admin_alert_outbox, params
        WHERE admin_alert_outbox.environment = params.environment
          AND destination = 'revenue'
          AND event_type = 'school.lead'
          AND created_at <= params.now) as schoolLeads,
      (SELECT COALESCE(SUM(estimated_cost_microusd), 0)
        FROM grading_provider_requests, params
        WHERE created_at <= params.now
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
      ) as estimatedProviderCostMicrousd`,
    [
      now,
      scope.livemode,
      scope.environment,
      ...INTERNAL_TEST_EMAILS,
      STRIPE_CATALOG_MANIFEST.priceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
    ],
  );
  const row = result.rows[0];
  const paidTeachers = toNumber(row?.paidTeachers);
  return {
    totalTeachers: toNumber(row?.totalTeachers),
    activatedTeachers: toNumber(row?.activatedTeachers),
    paidTeachers,
    successfulAiReviews: toNumber(row?.successfulAiReviews),
    studentRecordings: toNumber(row?.studentRecordings),
    mrrCents: paidTeachers * TEACHER_PLAN_MONTHLY_CENTS,
    schoolLeads: toNumber(row?.schoolLeads),
    estimatedProviderCostCents: estimatedProviderCents(
      row?.estimatedProviderCostMicrousd,
    ),
  };
}

/**
 * Returns aggregate-only AI operating health for the current UTC month and a
 * rolling 24-hour delivery window.
 */
export async function getAdminAlertOperationalAggregate(
  now = Date.now(),
): Promise<AdminAlertOperationalAggregate> {
  const safeNow = requireNonNegativeInteger("admin alert operational now", now);
  const date = new Date(safeNow);
  const monthStartAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const rollingWindowStartAt = Math.max(0, safeNow - 24 * 60 * 60 * 1_000);
  const budgetPeriod = `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date
    .getUTCMonth() + 1).toString().padStart(2, "0")}`;
  const result = await query(
    `WITH
      params AS (
        SELECT ? AS monthStartAt, ? AS windowStartAt, ? AS now
      ),
      internal_accounts(email) AS (
        VALUES (LOWER(?)), (LOWER(?)), (LOWER(?))
      ),
      completed_attempts AS (
        SELECT
          latency_ms as latencyMs,
          CASE
            WHEN status = 'completed'
              AND delivery_status IN ('delivered', 'not_applicable')
              AND suggested_score IS NOT NULL
              AND TRIM(error_code) = ''
              AND teacher_attention <> 'unable_to_grade'
            THEN 1 ELSE 0
          END as usable
        FROM ai_grading_attempts, params
        WHERE status IN ('completed', 'failed')
          AND COALESCE(completed_at, created_at) >= params.windowStartAt
          AND COALESCE(completed_at, created_at) <= params.now
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
      ),
      ranked_latency AS (
        SELECT
          latencyMs,
          ROW_NUMBER() OVER (ORDER BY latencyMs ASC) as rowNumber,
          COUNT(*) OVER () as sampleCount
        FROM completed_attempts
        WHERE latencyMs > 0
      )
    SELECT
      (SELECT COALESCE(SUM(estimated_cost_microusd), 0)
        FROM grading_provider_requests, params
        WHERE created_at >= params.monthStartAt
          AND created_at <= params.now
          AND LOWER(teacher_email) NOT IN (SELECT email FROM internal_accounts)
      ) as providerSpendMicrousd,
      (SELECT COUNT(*) FROM completed_attempts) as completedAttempts,
      (SELECT COALESCE(SUM(usable), 0) FROM completed_attempts) as usableAttempts,
      (SELECT COUNT(*) FROM ranked_latency) as latencySampleCount,
      COALESCE((SELECT latencyMs FROM ranked_latency
        WHERE rowNumber = CAST((sampleCount * 95 + 99) / 100 AS INTEGER)
        LIMIT 1), 0) as p95LatencyMs`,
    [monthStartAt, rollingWindowStartAt, safeNow, ...INTERNAL_TEST_EMAILS],
  );
  const row = result.rows[0];
  return {
    budgetPeriod,
    providerSpendMicrousd: toNumber(row?.providerSpendMicrousd),
    rollingWindowStartAt,
    rollingWindowEndAt: safeNow,
    completedAttempts: toNumber(row?.completedAttempts),
    usableAttempts: toNumber(row?.usableAttempts),
    latencySampleCount: toNumber(row?.latencySampleCount),
    p95LatencyMs: toNumber(row?.p95LatencyMs),
  };
}

function normalizeUserRole(value: unknown): UserRole {
  return toStringValue(value).toLowerCase() === "teacher" ? "teacher" : "student";
}

export async function listClasses(): Promise<ClassSummaryRow[]> {
  return listClassesByTeacher("");
}

export async function listClassesByTeacher(ownerEmail: string): Promise<ClassSummaryRow[]> {
  const result = await query(
    `SELECT
      c.id as id,
      c.name as name,
      c.owner_email as ownerEmail,
      c.created_at as createdAt,
      COUNT(DISTINCT a.id) as assignmentCount,
      COUNT(s.id) as submissionCount
    FROM classes c
    LEFT JOIN assignments a ON a.class_id = c.id AND a.deleted_at IS NULL
    LEFT JOIN submissions s ON s.assignment_id = a.id AND s.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
      AND (? = '' OR LOWER(c.owner_email) = LOWER(?))
    GROUP BY c.id
    ORDER BY c.created_at DESC`,
    [ownerEmail, ownerEmail]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    name: toStringValue(row.name),
    ownerEmail: toStringValue(row.ownerEmail),
    createdAt: toNumber(row.createdAt),
    assignmentCount: toNumber(row.assignmentCount),
    submissionCount: toNumber(row.submissionCount),
  }));
}

export async function findClassById(classId: string, ownerEmail?: string): Promise<ClassRow | null> {
  const result = await query(
    `SELECT id, name, owner_email as ownerEmail, created_at as createdAt
    FROM classes
    WHERE id = ?
      AND deleted_at IS NULL
      AND (? IS NULL OR LOWER(owner_email) = LOWER(?))
    LIMIT 1`,
    [classId, ownerEmail ?? null, ownerEmail ?? null]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    name: toStringValue(row.name),
    ownerEmail: toStringValue(row.ownerEmail),
    createdAt: toNumber(row.createdAt),
  };
}

export async function createClass(name: string, ownerEmail: string): Promise<ClassRow> {
  const duplicate = await query(
    `SELECT id FROM classes
    WHERE LOWER(name) = LOWER(?)
      AND LOWER(owner_email) = LOWER(?)
      AND deleted_at IS NULL
    LIMIT 1`,
    [name, ownerEmail]
  );
  if (duplicate.rows.length > 0) {
    throw new Error("Class name already exists.");
  }

  const item: ClassRow = {
    id: makeId("class"),
    name,
    ownerEmail: ownerEmail.toLowerCase(),
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO classes (id, name, owner_email, created_at, deleted_at)
    VALUES (?, ?, ?, ?, NULL)`,
    [item.id, item.name, item.ownerEmail, item.createdAt]
  );
  return item;
}

async function assertUniqueAssignmentTitle(
  classId: string,
  ownerEmail: string,
  title: string,
  excludeAssignmentId?: string
) {
  const duplicate = await query(
    `SELECT a.id
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND LOWER(a.title) = LOWER(?)
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND LOWER(c.owner_email) = LOWER(?)
      AND (? IS NULL OR a.id <> ?)
    LIMIT 1`,
    [classId, title, ownerEmail, excludeAssignmentId ?? null, excludeAssignmentId ?? null]
  );
  if (duplicate.rows.length > 0) {
    throw new Error("Assignment title already exists in this class.");
  }
}

export async function updateClassName(
  classId: string,
  name: string,
  ownerEmail: string
): Promise<ClassRow | null> {
  const duplicate = await query(
    `SELECT id FROM classes
    WHERE LOWER(name) = LOWER(?)
      AND LOWER(owner_email) = LOWER(?)
      AND id <> ?
      AND deleted_at IS NULL
    LIMIT 1`,
    [name, ownerEmail, classId]
  );
  if (duplicate.rows.length > 0) {
    throw new Error("Class name already exists.");
  }

  const result = await query(
    `UPDATE classes
    SET name = ?
    WHERE id = ?
      AND LOWER(owner_email) = LOWER(?)
      AND deleted_at IS NULL`,
    [name, classId, ownerEmail]
  );
  if (toNumber(result.rowsAffected) === 0) return null;
  return findClassById(classId, ownerEmail);
}

export async function deleteClassCascade(classId: string, ownerEmail: string): Promise<boolean> {
  const deletedAt = Date.now();
  await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE assignment_id IN (
      SELECT a.id
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE c.id = ?
        AND LOWER(c.owner_email) = LOWER(?)
    )
      AND deleted_at IS NULL`,
    [deletedAt, classId, ownerEmail]
  );
  await query(
    `UPDATE assignments
    SET deleted_at = ?
    WHERE class_id = ?
      AND class_id IN (
        SELECT id FROM classes WHERE id = ? AND LOWER(owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [deletedAt, classId, classId, ownerEmail]
  );
  const result = await query(
    `UPDATE classes
    SET deleted_at = ?
    WHERE id = ?
      AND LOWER(owner_email) = LOWER(?)
      AND deleted_at IS NULL`,
    [deletedAt, classId, ownerEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function listAssignmentsByClassId(classId: string, ownerEmail?: string): Promise<AssignmentSummaryRow[]> {
  const result = await query(
    `SELECT
      a.id as id,
      a.class_id as classId,
      a.title as title,
      a.description as description,
      a.instructions as instructions,
      COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as targetLanguage,
      COALESCE(a.max_points, 100) as maxPoints,
      COALESCE(a.max_submissions, 0) as maxSubmissions,
      COALESCE(a.max_recording_seconds, 180) as maxRecordingSeconds,
      a.rubric as rubric,
      COALESCE(a.attachment_name, '') as attachmentName,
      COALESCE(a.attachment_url, '') as attachmentUrl,
      COALESCE(a.attachment_content_type, '') as attachmentContentType,
      COALESCE(a.auto_transcribe, 0) as autoTranscribe,
      a.created_at as createdAt,
      COUNT(s.id) as submissionCount
    FROM assignments a
    LEFT JOIN submissions s ON s.assignment_id = a.id AND s.deleted_at IS NULL
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    GROUP BY a.id
    ORDER BY a.created_at DESC`,
    [classId, ownerEmail ?? null, ownerEmail ?? null]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    classId: toStringValue(row.classId),
    title: toStringValue(row.title),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    targetLanguage: toStringValue(row.targetLanguage) || "Spanish",
    maxPoints: toNumber(row.maxPoints),
    maxSubmissions: toNumber(row.maxSubmissions),
    maxRecordingSeconds: toNumber(row.maxRecordingSeconds),
    rubric: parseJsonValue<Rubric>(row.rubric),
    attachmentName: toStringValue(row.attachmentName),
    attachmentUrl: toStringValue(row.attachmentUrl),
    attachmentContentType: toStringValue(row.attachmentContentType),
    autoTranscribe: toNumber(row.autoTranscribe) === 1,
    createdAt: toNumber(row.createdAt),
    submissionCount: toNumber(row.submissionCount),
  }));
}

export async function createAssignment(input: {
  id?: string;
  classId: string;
  ownerEmail: string;
  title: string;
  description: string;
  instructions: string;
  targetLanguage?: string;
  maxPoints: number;
  maxSubmissions: number;
  maxRecordingSeconds: number;
  rubric: Rubric | null;
  attachmentName: string;
  attachmentUrl: string;
  attachmentContentType: string;
  autoTranscribe?: boolean;
}): Promise<AssignmentRow> {
  await assertUniqueAssignmentTitle(input.classId, input.ownerEmail, input.title);

  const item: AssignmentRow = {
    id: input.id ?? makeId("asg"),
    classId: input.classId,
    title: input.title,
    description: input.description,
    instructions: input.instructions,
    targetLanguage: input.targetLanguage?.trim() || "Spanish",
    maxPoints: input.maxPoints,
    maxSubmissions: input.maxSubmissions,
    maxRecordingSeconds: input.maxRecordingSeconds,
    rubric: input.rubric,
    attachmentName: input.attachmentName,
    attachmentUrl: input.attachmentUrl,
    attachmentContentType: input.attachmentContentType,
    autoTranscribe: input.autoTranscribe === true,
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO assignments (
      id, class_id, title, description, instructions, target_language, max_points, max_submissions, max_recording_seconds, rubric, attachment_name, attachment_url, attachment_content_type, auto_transcribe, created_at, deleted_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
    WHERE EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = ?
        AND c.deleted_at IS NULL
        AND LOWER(c.owner_email) = LOWER(?)
    )`,
    [
      item.id,
      item.classId,
      item.title,
      item.description,
      item.instructions,
      item.targetLanguage,
      item.maxPoints,
      item.maxSubmissions,
      item.maxRecordingSeconds,
      stringifyJsonValue(item.rubric),
      item.attachmentName,
      item.attachmentUrl,
      item.attachmentContentType,
      item.autoTranscribe ? 1 : 0,
      item.createdAt,
      input.classId,
      input.ownerEmail,
    ]
  );
  return item;
}

export async function findAssignmentById(assignmentId: string, ownerEmail?: string): Promise<AssignmentDetailRow | null> {
  const result = await query(
    `SELECT
      a.id as id,
      a.class_id as classId,
      c.name as className,
      c.owner_email as ownerEmail,
      a.title as title,
      a.description as description,
      a.instructions as instructions,
      COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as targetLanguage,
      COALESCE(a.max_points, 100) as maxPoints,
      COALESCE(a.max_submissions, 0) as maxSubmissions,
      COALESCE(a.max_recording_seconds, 180) as maxRecordingSeconds,
      a.rubric as rubric,
      COALESCE(a.attachment_name, '') as attachmentName,
      COALESCE(a.attachment_url, '') as attachmentUrl,
      COALESCE(a.attachment_content_type, '') as attachmentContentType,
      COALESCE(a.auto_transcribe, 0) as autoTranscribe,
      a.created_at as createdAt
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ?
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    LIMIT 1`,
    [assignmentId, ownerEmail ?? null, ownerEmail ?? null]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    classId: toStringValue(row.classId),
    className: toStringValue(row.className),
    ownerEmail: toStringValue(row.ownerEmail),
    title: toStringValue(row.title),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    targetLanguage: toStringValue(row.targetLanguage) || "Spanish",
    maxPoints: toNumber(row.maxPoints),
    maxSubmissions: toNumber(row.maxSubmissions),
    maxRecordingSeconds: toNumber(row.maxRecordingSeconds),
    rubric: parseJsonValue<Rubric>(row.rubric),
    attachmentName: toStringValue(row.attachmentName),
    attachmentUrl: toStringValue(row.attachmentUrl),
    attachmentContentType: toStringValue(row.attachmentContentType),
    autoTranscribe: toNumber(row.autoTranscribe) === 1,
    createdAt: toNumber(row.createdAt),
  };
}

export async function updateAssignment(
  assignmentId: string,
  ownerEmail: string,
  input: {
    title: string;
    description: string;
    instructions: string;
    targetLanguage?: string;
    maxPoints: number;
    maxSubmissions: number;
    maxRecordingSeconds: number;
    rubric: Rubric | null;
    attachmentName: string;
    attachmentUrl: string;
    attachmentContentType: string;
    autoTranscribe?: boolean;
  }
): Promise<AssignmentDetailRow | null> {
  const current = await findAssignmentById(assignmentId, ownerEmail);
  if (!current) return null;

  await assertUniqueAssignmentTitle(current.classId, ownerEmail, input.title, assignmentId);
  const nextAutoTranscribe = input.autoTranscribe ?? current.autoTranscribe;
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const highestGradeResult = await transaction.execute({
      sql: `SELECT MAX(s.grade) as highestGrade
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE a.id = ?
          AND s.deleted_at IS NULL
          AND a.deleted_at IS NULL
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)`,
      args: [assignmentId, ownerEmail],
    });
    const highestGrade = toNullableNumber(highestGradeResult.rows[0]?.highestGrade);
    if (highestGrade !== null && input.maxPoints < highestGrade) {
      throw new AssignmentPointsBelowSavedGradeError(highestGrade);
    }

    const result = await transaction.execute({
      sql: `UPDATE assignments
        SET title = ?, description = ?, instructions = ?, target_language = ?, max_points = ?, max_submissions = ?, max_recording_seconds = ?, rubric = ?, attachment_name = ?, attachment_url = ?, attachment_content_type = ?, auto_transcribe = ?
        WHERE id = ?
          AND deleted_at IS NULL
          AND id IN (
            SELECT a.id
            FROM assignments a
            JOIN classes c ON c.id = a.class_id
            WHERE a.id = ?
              AND c.deleted_at IS NULL
              AND LOWER(c.owner_email) = LOWER(?)
          )`,
      args: [
        input.title,
        input.description,
        input.instructions,
        input.targetLanguage?.trim() || current.targetLanguage,
        input.maxPoints,
        input.maxSubmissions,
        input.maxRecordingSeconds,
        stringifyJsonValue(input.rubric),
        input.attachmentName,
        input.attachmentUrl,
        input.attachmentContentType,
        nextAutoTranscribe ? 1 : 0,
        assignmentId,
        assignmentId,
        ownerEmail,
      ],
    });
    if (toNumber(result.rowsAffected) === 0) {
      await transaction.rollback();
      return null;
    }
    if (!nextAutoTranscribe) {
      const now = Date.now();
      await transaction.execute({
        sql: `UPDATE automatic_transcription_jobs
          SET status = 'cancelled', lease_token = '', lease_expires_at = 0,
            next_attempt_at = ?, last_error_code = 'automatic_transcription_disabled',
            updated_at = ?
          WHERE assignment_id = ?
            AND status IN ('queued', 'retry', 'paused', 'processing')`,
        args: [now, now, assignmentId],
      });
    }
    await transaction.commit();
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  return findAssignmentById(assignmentId, ownerEmail);
}

export async function deleteAssignmentCascade(assignmentId: string, ownerEmail: string): Promise<boolean> {
  const deletedAt = Date.now();
  await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE assignment_id = ?
      AND assignment_id IN (
        SELECT a.id
        FROM assignments a
        JOIN classes c ON c.id = a.class_id
        WHERE a.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [deletedAt, assignmentId, assignmentId, ownerEmail]
  );
  const result = await query(
    `UPDATE assignments
    SET deleted_at = ?
    WHERE id = ?
      AND id IN (
        SELECT a.id
        FROM assignments a
        JOIN classes c ON c.id = a.class_id
        WHERE a.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [deletedAt, assignmentId, assignmentId, ownerEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function createSubmission(input: {
  id?: string;
  assignmentId: string;
  studentName: string;
  studentEmail: string;
  audioBlobUrl: string;
}): Promise<{
  id: string;
  assignmentId: string;
  studentName: string;
  studentEmail: string;
  audioBlobUrl: string;
  submittedAt: number;
}> {
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const assignmentLimit = await transaction.execute({
      sql: `SELECT COALESCE(max_submissions, 0) as maxSubmissions
        FROM assignments
        WHERE id = ? AND deleted_at IS NULL
        LIMIT 1`,
      args: [input.assignmentId],
    });
    const maxSubmissions = toNumber(assignmentLimit.rows[0]?.maxSubmissions);
    if (maxSubmissions > 0) {
      const existingCount = await transaction.execute({
        sql: `SELECT COUNT(*) as count
          FROM submissions
          WHERE assignment_id = ?
            AND LOWER(student_email) = LOWER(?)
            AND deleted_at IS NULL`,
        args: [input.assignmentId, input.studentEmail],
      });
      if (toNumber(existingCount.rows[0]?.count) >= maxSubmissions) {
        throw new SubmissionLimitReachedError(maxSubmissions);
      }
    }

    const duplicate = await transaction.execute({
      sql: `SELECT id, submitted_at as submittedAt
        FROM submissions
        WHERE assignment_id = ?
          AND LOWER(student_email) = LOWER(?)
          AND deleted_at IS NULL
        ORDER BY submitted_at DESC
        LIMIT 1`,
      args: [input.assignmentId, input.studentEmail],
    });
    const recent = duplicate.rows[0];
    if (recent && Date.now() - toNumber(recent.submittedAt) < 60_000) {
      throw new DuplicateSubmissionError();
    }

    const item = {
      id: input.id ?? makeId("sub"),
      assignmentId: input.assignmentId,
      studentName: input.studentName,
      studentEmail: input.studentEmail,
      audioBlobUrl: input.audioBlobUrl,
      submittedAt: Date.now(),
    };
    await transaction.execute({
      sql: `INSERT INTO submissions (
        id, assignment_id, student_name, student_email, audio_data, audio_blob_url, submitted_at, deleted_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)`,
      args: [
        item.id,
        item.assignmentId,
        item.studentName,
        item.studentEmail,
        item.audioBlobUrl,
        item.submittedAt,
      ],
    });
    await transaction.execute({
      sql: `INSERT INTO automatic_transcription_jobs (
        id, submission_id, assignment_id, teacher_email, status, attempt_count,
        next_attempt_at, lease_token, lease_expires_at, last_error_code,
        created_at, updated_at, completed_at
      )
      SELECT ?, ?, a.id, c.owner_email, 'queued', 0, ?, '', 0, '', ?, ?, NULL
      FROM assignments a JOIN classes c ON c.id = a.class_id
      WHERE a.id = ? AND a.deleted_at IS NULL AND c.deleted_at IS NULL
        AND COALESCE(a.auto_transcribe, 0) = 1`,
      args: [
        makeId("atj"),
        item.id,
        item.submittedAt,
        item.submittedAt,
        item.submittedAt,
        item.assignmentId,
      ],
    });
    await transaction.commit();
    return item;
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

// Keep the lease longer than the cron route's 800-second ceiling so an
// overlapping delivery cannot reclaim a job while its first provider request
// may still be finishing. Expired leases remain recoverable on the next tick.
const AUTOMATIC_TRANSCRIPTION_JOB_LEASE_MS = 15 * 60_000;

export async function claimAutomaticTranscriptionJobs(input?: {
  limit?: number;
  now?: number;
}): Promise<AutomaticTranscriptionJobRow[]> {
  await ensureInitialized();
  const now = input?.now ?? Date.now();
  const limit = Math.max(1, Math.min(5, Math.floor(input?.limit ?? 2)));
  const transaction = await getDbClient().transaction("write");
  try {
    // Expired processing leases are retryable. A transaction plus the guarded
    // update below makes overlapping cron deliveries safe.
    await transaction.execute({
      sql: `UPDATE automatic_transcription_jobs
        SET status = 'retry', lease_token = '', lease_expires_at = 0,
          next_attempt_at = ?, updated_at = ?, last_error_code = 'lease_expired'
        WHERE status = 'processing' AND lease_expires_at <= ?`,
      args: [now, now, now],
    });
    const due = await transaction.execute({
      sql: `SELECT id, submission_id as submissionId,
          assignment_id as assignmentId, teacher_email as teacherEmail,
          attempt_count as attemptCount, status as priorStatus
        FROM automatic_transcription_jobs
        WHERE status IN ('queued', 'retry', 'paused') AND next_attempt_at <= ?
        ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?`,
      args: [now, limit],
    });
    const claimed: AutomaticTranscriptionJobRow[] = [];
    for (const row of due.rows) {
      const id = toStringValue(row.id);
      const leaseToken = crypto.randomUUID();
      const updated = await transaction.execute({
        sql: `UPDATE automatic_transcription_jobs
          SET status = 'processing',
            attempt_count = attempt_count + CASE WHEN status = 'paused' THEN 0 ELSE 1 END,
            lease_token = ?, lease_expires_at = ?, updated_at = ?
          WHERE id = ? AND status IN ('queued', 'retry', 'paused') AND next_attempt_at <= ?`,
        args: [leaseToken, now + AUTOMATIC_TRANSCRIPTION_JOB_LEASE_MS, now, id, now],
      });
      if (toNumber(updated.rowsAffected) === 1) {
        claimed.push({
          id,
          submissionId: toStringValue(row.submissionId),
          assignmentId: toStringValue(row.assignmentId),
          teacherEmail: toStringValue(row.teacherEmail),
          status: "processing",
          attemptCount: toNumber(row.attemptCount)
            + (toStringValue(row.priorStatus) === "paused" ? 0 : 1),
          leaseToken,
        });
      }
    }
    await transaction.commit();
    return claimed;
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function settleAutomaticTranscriptionJob(input: {
  id: string;
  leaseToken: string;
  status: "completed" | "retry" | "paused" | "failed" | "cancelled";
  errorCode?: string;
  nextAttemptAt?: number;
  now?: number;
}): Promise<boolean> {
  const now = input.now ?? Date.now();
  const completedAt = input.status === "completed" ? now : null;
  const result = await query(
    `UPDATE automatic_transcription_jobs
      SET status = ?, next_attempt_at = ?, lease_token = '', lease_expires_at = 0,
        last_error_code = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'processing' AND lease_token = ?`,
    [
      input.status,
      input.nextAttemptAt ?? now,
      (input.errorCode ?? "").slice(0, 80),
      now,
      completedAt,
      input.id,
      input.leaseToken,
    ],
  );
  return toNumber(result.rowsAffected) === 1;
}

export async function isAutomaticTranscriptionJobActive(input: {
  id: string;
  leaseToken: string;
}): Promise<boolean> {
  const result = await query(
    `SELECT 1 as active
      FROM automatic_transcription_jobs j
      JOIN assignments a ON a.id = j.assignment_id
      JOIN classes c ON c.id = a.class_id
      JOIN submissions s ON s.id = j.submission_id
      WHERE j.id = ?
        AND j.status = 'processing'
        AND j.lease_token = ?
        AND COALESCE(a.auto_transcribe, 0) = 1
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND s.deleted_at IS NULL
      LIMIT 1`,
    [input.id, input.leaseToken],
  );
  return result.rows.length === 1;
}

export async function listSubmissionsByClassId(classId: string, ownerEmail?: string): Promise<SubmissionRow[]> {
  const result = await query(
    `SELECT
      s.id as id,
      s.assignment_id as assignmentId,
      a.title as assignmentTitle,
      s.student_name as studentName,
      s.student_email as studentEmail,
      s.submitted_at as submittedAt,
      COALESCE(s.feedback, '') as feedback,
      s.grade as grade,
      s.grade_source as gradeSource,
      s.rubric_scores as rubricScores
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    ORDER BY s.submitted_at DESC`,
    [classId, ownerEmail ?? null, ownerEmail ?? null]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    studentName: toStringValue(row.studentName),
    studentEmail: toStringValue(row.studentEmail),
    audioData: toProtectedAudioPath(toStringValue(row.id)),
    submittedAt: toNumber(row.submittedAt),
    feedback: toStringValue(row.feedback),
    grade: toNullableNumber(row.grade),
    gradeSource: toStringValue(row.gradeSource) === "ai" ? "ai" : "teacher",
    rubricScores: parseJsonValue<RubricScore[]>(row.rubricScores),
  }));
}

export async function listSubmissionsByStudentEmail(studentEmail: string): Promise<StudentSubmissionRow[]> {
  const result = await query(
    `SELECT
      s.id as id,
      s.assignment_id as assignmentId,
      a.title as assignmentTitle,
      c.id as classId,
      c.name as className,
      a.max_points as maxPoints,
      s.student_name as studentName,
      s.submitted_at as submittedAt,
      COALESCE(s.feedback, '') as feedback,
      s.grade as grade,
      s.grade_source as gradeSource
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE LOWER(s.student_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY s.submitted_at DESC`,
    [studentEmail]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    classId: toStringValue(row.classId),
    className: toStringValue(row.className),
    maxPoints: toNumber(row.maxPoints),
    studentName: toStringValue(row.studentName),
    audioData: toStudentProtectedAudioPath(toStringValue(row.id)),
    submittedAt: toNumber(row.submittedAt),
    feedback: toStringValue(row.feedback),
    grade: toNullableNumber(row.grade),
    gradeSource: toStringValue(row.gradeSource) === "ai" ? "ai" : "teacher",
  }));
}

export async function listStudentAssignmentHistoryByEmail(
  studentEmail: string
): Promise<StudentAssignmentHistoryRow[]> {
  const result = await query(
    `SELECT
      a.id as assignmentId,
      a.title as assignmentTitle,
      c.id as classId,
      c.name as className,
      a.max_points as maxPoints,
      MAX(s.submitted_at) as lastSeenAt
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE LOWER(s.student_email) = LOWER(?)
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    GROUP BY a.id, a.title, c.id, c.name, a.max_points
    ORDER BY lastSeenAt DESC, LOWER(c.name), LOWER(a.title)`,
    [studentEmail]
  );
  return result.rows.map((row) => ({
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    classId: toStringValue(row.classId),
    className: toStringValue(row.className),
    maxPoints: toNumber(row.maxPoints),
  }));
}

export async function listEnrolledClassesWithAssignmentsByEmail(
  studentEmail: string
): Promise<StudentEnrolledRow[]> {
  const result = await query(
    `SELECT
      c.id as classId,
      c.name as className,
      a.id as assignmentId,
      a.title as assignmentTitle,
      COALESCE(a.max_points, 0) as maxPoints,
      COALESCE(sub_counts.submissionCount, 0) as submissionCount
    FROM roster r
    JOIN classes c ON c.id = r.class_id
    LEFT JOIN assignments a ON a.class_id = c.id AND a.deleted_at IS NULL
    LEFT JOIN (
      SELECT assignment_id, COUNT(*) as submissionCount
      FROM submissions
      WHERE LOWER(student_email) = LOWER(?)
        AND deleted_at IS NULL
      GROUP BY assignment_id
    ) sub_counts ON sub_counts.assignment_id = a.id
    WHERE LOWER(r.student_email) = LOWER(?)
      AND c.deleted_at IS NULL
    ORDER BY c.created_at DESC, a.created_at ASC`,
    [studentEmail, studentEmail]
  );
  return result.rows.map((row) => ({
    classId: toStringValue(row.classId),
    className: toStringValue(row.className),
    assignmentId: row.assignmentId === null ? null : toStringValue(row.assignmentId),
    assignmentTitle: row.assignmentTitle === null ? null : toStringValue(row.assignmentTitle),
    maxPoints: toNumber(row.maxPoints),
    submissionCount: toNumber(row.submissionCount),
  }));
}

export async function findSubmissionById(submissionId: string, ownerEmail?: string): Promise<SubmissionRow | null> {
  const result = await query(
    `SELECT
      s.id as id,
      s.assignment_id as assignmentId,
      a.title as assignmentTitle,
      s.student_name as studentName,
      s.student_email as studentEmail,
      s.submitted_at as submittedAt,
      COALESCE(s.feedback, '') as feedback,
      s.grade as grade,
      s.grade_source as gradeSource,
      s.rubric_scores as rubricScores
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    LIMIT 1`,
    [submissionId, ownerEmail ?? null, ownerEmail ?? null]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    studentName: toStringValue(row.studentName),
    studentEmail: toStringValue(row.studentEmail),
    audioData: toProtectedAudioPath(toStringValue(row.id)),
    submittedAt: toNumber(row.submittedAt),
    feedback: toStringValue(row.feedback),
    grade: toNullableNumber(row.grade),
    gradeSource: toStringValue(row.gradeSource) === "ai" ? "ai" : "teacher",
    rubricScores: parseJsonValue<RubricScore[]>(row.rubricScores),
  };
}

export async function findSubmissionAccessById(
  submissionId: string,
  ownerEmail?: string
): Promise<SubmissionAccessRow | null> {
  const result = await query(
    `SELECT
      s.id as id,
      s.student_email as studentEmail,
      COALESCE(s.audio_blob_url, s.audio_data, '') as audioBlobUrl
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    LIMIT 1`,
    [submissionId, ownerEmail ?? null, ownerEmail ?? null]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    studentEmail: toStringValue(row.studentEmail),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
  };
}

export async function findStudentSubmissionAudioAccessById(
  submissionId: string,
  studentEmail: string
): Promise<SubmissionAccessRow | null> {
  const result = await query(
    `SELECT
      s.id as id,
      s.student_email as studentEmail,
      COALESCE(s.audio_blob_url, s.audio_data, '') as audioBlobUrl
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND LOWER(s.student_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    [submissionId, studentEmail]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toStringValue(row.id),
    studentEmail: toStringValue(row.studentEmail),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
  };
}

export async function updateSubmission(
  submissionId: string,
  ownerEmail: string,
  input: { studentName: string; grade: number | null; feedback: string; rubricScores: RubricScore[] | null }
) {
  await query(
    `UPDATE submissions
    SET student_name = ?, grade = ?, feedback = ?, rubric_scores = ?, grade_source = 'teacher'
    WHERE id = ?
      AND id IN (
        SELECT s.id
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [
      input.studentName,
      input.grade,
      input.feedback,
      stringifyJsonValue(input.rubricScores),
      submissionId,
      submissionId,
      ownerEmail,
    ]
  );
  return findSubmissionById(submissionId, ownerEmail);
}

/**
 * Applies a completed AI result only while every teacher-authored grading
 * field is still blank, without mutating student identity.
 */
export async function applyAiGradeToSubmission(
  submissionId: string,
  ownerEmail: string,
  input: { grade: number; feedback: string; rubricScores: RubricScore[] | null }
): Promise<SubmissionRow | null> {
  if (!Number.isFinite(input.grade)) throw new RangeError("grade must be a finite number.");
  const result = await query(
    `UPDATE submissions
    SET grade = ?, feedback = ?, rubric_scores = ?, grade_source = 'ai'
    WHERE id = ?
      AND deleted_at IS NULL
      AND grade IS NULL
      AND TRIM(COALESCE(feedback, '')) = ''
      AND rubric_scores IS NULL
      AND EXISTS (
        SELECT 1
        FROM assignments a
        JOIN classes c ON c.id = a.class_id
        WHERE a.id = submissions.assignment_id
          AND a.deleted_at IS NULL
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )`,
    [
      input.grade,
      input.feedback,
      stringifyJsonValue(input.rubricScores),
      submissionId,
      ownerEmail,
    ]
  );
  if (toNumber(result.rowsAffected) !== 1) return null;
  return findSubmissionById(submissionId, ownerEmail);
}

export type FinalizeAiGradeDeliveryResult =
  | { status: "applied"; billingRequired: boolean }
  | {
      status: "not_applied";
      billingRequired: false;
      reason:
        | "attempt_ineligible"
        | "submission_changed"
        | "billing_unavailable"
        | "access_revoked";
    };

async function reserveAiBillingCreditInTransaction(input: {
  transaction: Transaction;
  teacherEmail: string;
  billingMonth: string;
  priceBookId: string;
  catalogFingerprint: string;
  livemode: boolean;
  now: number;
}): Promise<{ qualifyingClassHighWater: number; freeCreditApplied: boolean }> {
  const qualifyingResult = await input.transaction.execute({
    sql: `SELECT COUNT(*) as qualifyingClassHighWater
    FROM classes c
    WHERE LOWER(c.owner_email) = LOWER(?)
      AND c.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM roster r WHERE r.class_id = c.id)
      AND EXISTS (
        SELECT 1
        FROM assignments a
        WHERE a.class_id = c.id
          AND a.deleted_at IS NULL
      )`,
    args: [input.teacherEmail],
  });
  const observedHighWater = toNumber(
    qualifyingResult.rows[0]?.qualifyingClassHighWater,
  );
  const cappedObservedHighWater = Math.min(
    observedHighWater,
    LEGACY_METERED_MAX_QUALIFYING_CLASSES,
  );
  await input.transaction.execute({
    sql: `INSERT INTO ai_billing_credit_periods_v3 (
      teacher_email, billing_month, price_book_id, catalog_fingerprint,
      livemode, qualifying_class_high_water,
      used_credits, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(
      teacher_email,
      billing_month,
      price_book_id,
      catalog_fingerprint,
      livemode
    ) DO UPDATE SET
      qualifying_class_high_water = MIN(
        ?,
        MAX(
          ai_billing_credit_periods_v3.qualifying_class_high_water,
          excluded.qualifying_class_high_water
        )
      ),
      updated_at = excluded.updated_at`,
    args: [
      input.teacherEmail,
      input.billingMonth,
      input.priceBookId,
      input.catalogFingerprint,
      input.livemode ? 1 : 0,
      cappedObservedHighWater,
      input.now,
      input.now,
      LEGACY_METERED_MAX_QUALIFYING_CLASSES,
    ],
  });
  const periodResult = await input.transaction.execute({
    sql: `SELECT
      qualifying_class_high_water as qualifyingClassHighWater,
      used_credits as usedCredits
    FROM ai_billing_credit_periods_v3
    WHERE teacher_email = ?
      AND billing_month = ?
      AND price_book_id = ?
      AND catalog_fingerprint = ?
      AND livemode = ?
    LIMIT 1`,
    args: [
      input.teacherEmail,
      input.billingMonth,
      input.priceBookId,
      input.catalogFingerprint,
      input.livemode ? 1 : 0,
    ],
  });
  const period = periodResult.rows[0];
  if (!period) throw new Error("AI billing credit period could not be reserved.");
  const qualifyingClassHighWater = toNumber(period.qualifyingClassHighWater);
  const usedCredits = toNumber(period.usedCredits);
  const freeCreditApplied =
    usedCredits < Math.max(0, qualifyingClassHighWater - 1);
  if (freeCreditApplied) {
    const reservationResult = await input.transaction.execute({
      sql: `UPDATE ai_billing_credit_periods_v3
      SET used_credits = used_credits + 1,
          updated_at = ?
      WHERE teacher_email = ?
        AND billing_month = ?
        AND price_book_id = ?
        AND catalog_fingerprint = ?
        AND livemode = ?
        AND used_credits = ?
        AND used_credits < MAX(0, qualifying_class_high_water - 1)`,
      args: [
        input.now,
        input.teacherEmail,
        input.billingMonth,
        input.priceBookId,
        input.catalogFingerprint,
        input.livemode ? 1 : 0,
        usedCredits,
      ],
    });
    if (toNumber(reservationResult.rowsAffected) !== 1) {
      throw new Error("AI billing credit reservation lost its transaction guard.");
    }
  }
  return { qualifyingClassHighWater, freeCreditApplied };
}

/**
 * Applies the exact persisted AI result and, when the teacher has a verified
 * Stripe entitlement, snapshots its billing destination in the same database
 * transaction. A marker failure rolls the grade update back, closing the
 * otherwise-unrecoverable apply-then-mark crash window.
 */
export async function finalizeAiGradeDelivery(input: {
  attemptId: string;
  ownerEmail: string;
  priceBookId: string;
  billingCandidate: boolean;
  allowUnmeteredAccess: boolean;
  reviewReservationId?: string;
}): Promise<FinalizeAiGradeDeliveryResult> {
  const attemptId = requireTrimmedValue("attemptId", input.attemptId);
  const ownerEmail = normalizeBillingTeacherEmail(input.ownerEmail);
  const priceBookId = requireTrimmedValue("priceBookId", input.priceBookId);
  const stripeUsageScope =
    priceBookId === TEACHER_AI_PRICE_BOOK.id
      ? await getReadyStripeUsageScope()
      : null;
  const reviewReservationId = input.reviewReservationId?.trim() || null;
  const readyStripeSubscriptionScope = reviewReservationId
    ? await getReadyStripeSubscriptionScope()
    : null;
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");

  async function rollbackResult(
    reason: Extract<FinalizeAiGradeDeliveryResult, { status: "not_applied" }>['reason'],
  ): Promise<FinalizeAiGradeDeliveryResult> {
    if (!transaction.closed) await transaction.rollback();
    return { status: "not_applied", billingRequired: false, reason };
  }

  try {
    const attemptResult = await transaction.execute({
      sql: `SELECT
        ag.submission_id as submissionId,
        ag.status as status,
        ag.delivery_status as deliveryStatus,
        ag.cache_key as cacheKey,
        ag.assignment_fingerprint as assignmentFingerprint,
        ag.cache_hit as cacheHit,
        ag.suggested_score as suggestedScore,
        ag.feedback as feedback,
        ag.rubric_scores as attemptRubricScores,
        ag.error_code as errorCode,
        ag.result_source as resultSource,
        ag.confidence as confidence,
        COALESCE(ag.completed_at, ag.created_at) as occurredAt,
        a.id as assignmentId,
        a.title as assignmentTitle,
        COALESCE(a.description, '') as assignmentDescription,
        a.instructions as assignmentInstructions,
        COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as assignmentTargetLanguage,
        COALESCE(a.max_points, 100) as assignmentMaxPoints,
        a.rubric as assignmentRubric,
        EXISTS(
          SELECT 1
          FROM users u
          WHERE LOWER(u.email) = LOWER(?)
            AND u.is_paid = 1
            AND u.ai_access_grant_source IN (${MANUAL_AI_ACCESS_GRANT_SQL_LIST})
        ) as manualAccess
      FROM ai_grading_attempts ag
      JOIN submissions s ON s.id = ag.submission_id
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE ag.id = ?
        AND LOWER(ag.teacher_email) = LOWER(?)
        AND LOWER(c.owner_email) = LOWER(?)
        AND s.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      LIMIT 1`,
      args: [ownerEmail, attemptId, ownerEmail, ownerEmail],
    });
    const attempt = attemptResult.rows[0];
    if (!attempt) return await rollbackResult("attempt_ineligible");

    const attemptAssignmentFingerprint = toStringValue(
      attempt.assignmentFingerprint,
    ).trim();
    if (
      !attemptAssignmentFingerprint ||
      attemptAssignmentFingerprint !== assignmentFingerprintFromAttemptDeliveryRow(attempt)
    ) {
      return await rollbackResult("submission_changed");
    }

    const suggestedScore = Number(attempt.suggestedScore);
    const baseAttemptEligible =
      toStringValue(attempt.status) === "completed" &&
      toStringValue(attempt.deliveryStatus) === "pending" &&
      Number.isFinite(suggestedScore) &&
      toStringValue(attempt.errorCode).trim() === "";
    const billableAttemptEligible =
      baseAttemptEligible &&
      toStringValue(attempt.cacheKey).trim() !== "" &&
      !["deterministic", "failed", "teacher_review", "withheld"].includes(
        toStringValue(attempt.resultSource),
      ) &&
      toStringValue(attempt.confidence) === "high";
    if (!baseAttemptEligible || (input.billingCandidate && !billableAttemptEligible)) {
      return await rollbackResult("attempt_ineligible");
    }

    let billingAccount: Row | null = null;
    if (stripeUsageScope) {
      const accountResult = await transaction.execute({
        sql: `SELECT
          stripe_customer_id as stripeCustomerId,
          stripe_subscription_id as stripeSubscriptionId
        FROM stripe_billing_accounts
        WHERE LOWER(teacher_email) = LOWER(?)
          AND subscription_status = 'active'
          AND price_book_id = ?
          AND catalog_fingerprint = ?
          AND stripe_account_id = ?
          AND billing_contract_id = ?
          AND livemode = ?
          AND stripe_customer_id <> ''
          AND stripe_subscription_id IS NOT NULL
          AND stripe_subscription_id <> ''
        LIMIT 1`,
        args: [
          ownerEmail,
          priceBookId,
          STRIPE_CATALOG_MANIFEST.fingerprint,
          stripeUsageScope.accountId,
          stripeUsageScope.billingContractId,
          stripeUsageScope.keyMode === "live" ? 1 : 0,
        ],
      });
      billingAccount = accountResult.rows[0] ?? null;
    }

    const hasManualAccess = toNumber(attempt.manualAccess) === 1;
    if (
      !billingAccount &&
      !hasManualAccess &&
      !input.allowUnmeteredAccess &&
      !reviewReservationId
    ) {
      return await rollbackResult(
        stripeUsageScope ? "access_revoked" : "billing_unavailable",
      );
    }

    const rubricScores =
      toStringValue(attempt.assignmentRubric).trim() &&
      typeof attempt.attemptRubricScores === "string"
        ? attempt.attemptRubricScores
        : null;
    const applyResult = await transaction.execute({
      sql: `UPDATE submissions
      SET grade = ?, feedback = ?, rubric_scores = ?, grade_source = 'ai'
      WHERE id = ?
        AND deleted_at IS NULL
        AND grade IS NULL
        AND TRIM(COALESCE(feedback, '')) = ''
        AND rubric_scores IS NULL
        AND EXISTS (
          SELECT 1
          FROM assignments a
          JOIN classes c ON c.id = a.class_id
          WHERE a.id = submissions.assignment_id
            AND a.deleted_at IS NULL
            AND c.deleted_at IS NULL
            AND LOWER(c.owner_email) = LOWER(?)
        )`,
      args: [
        suggestedScore,
        toStringValue(attempt.feedback),
        rubricScores,
        toStringValue(attempt.submissionId),
        ownerEmail,
      ],
    });
    if (toNumber(applyResult.rowsAffected) !== 1) {
      return await rollbackResult("submission_changed");
    }

    let billingRequired = input.billingCandidate && billingAccount !== null;
    if (billingRequired) {
      const duplicateResult = await transaction.execute({
        sql: `SELECT 1
        WHERE EXISTS (
          SELECT 1
          FROM ai_grading_attempts prior
          WHERE prior.id <> ?
            AND LOWER(prior.teacher_email) = LOWER(?)
            AND prior.cache_key = ?
            AND prior.billing_required = 1
            AND prior.billing_price_book_id = ?
            AND prior.billing_catalog_fingerprint = ?
            AND prior.billing_livemode = ?
        ) OR EXISTS (
          SELECT 1
          FROM ai_billing_usage_v3 usage
          WHERE LOWER(usage.teacher_email) = LOWER(?)
            AND usage.cache_key = ?
            AND usage.price_book_id = ?
            AND usage.catalog_fingerprint = ?
            AND usage.livemode = ?
        )
        LIMIT 1`,
        args: [
          attemptId,
          ownerEmail,
          toStringValue(attempt.cacheKey),
          priceBookId,
          STRIPE_CATALOG_MANIFEST.fingerprint,
          stripeUsageScope!.keyMode === "live" ? 1 : 0,
          ownerEmail,
          toStringValue(attempt.cacheKey),
          priceBookId,
          STRIPE_CATALOG_MANIFEST.fingerprint,
          stripeUsageScope!.keyMode === "live" ? 1 : 0,
        ],
      });
      billingRequired = duplicateResult.rows.length === 0;
    }
    if (billingRequired) {
      if (!billingAccount) {
        throw new Error("Verified Stripe billing account disappeared before finalization.");
      }
      const markerNow = Date.now();
      const creditReservation = await reserveAiBillingCreditInTransaction({
        transaction,
        teacherEmail: ownerEmail,
        billingMonth: getAiBillingUtcMonth(toNumber(attempt.occurredAt)),
        priceBookId,
        catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
        livemode: stripeUsageScope!.keyMode === "live",
        now: markerNow,
      });
      const markerResult = await transaction.execute({
        sql: `UPDATE ai_grading_attempts
        SET billing_required = 1,
            billing_price_book_id = ?,
            billing_stripe_customer_id = ?,
            billing_stripe_subscription_id = ?,
            billing_catalog_fingerprint = ?,
            billing_contract_id = ?,
            billing_livemode = ?,
            billing_qualifying_class_high_water = ?,
            billing_free_credit_applied = ?
        WHERE id = ?
          AND billing_required = 0
          AND billing_stripe_customer_id = ''
          AND billing_stripe_subscription_id = ''
          AND billing_catalog_fingerprint = ''
           AND status = 'completed'
          AND delivery_status = 'pending'
          AND TRIM(cache_key) <> ''
          AND suggested_score IS NOT NULL
          AND TRIM(error_code) = ''
          AND result_source NOT IN ('deterministic', 'failed', 'teacher_review', 'withheld')
          AND confidence = 'high'
          AND LOWER(teacher_email) = LOWER(?)
          AND EXISTS (
            SELECT 1
            FROM submissions s
            JOIN assignments a ON a.id = s.assignment_id
            JOIN classes c ON c.id = a.class_id
            WHERE s.id = ai_grading_attempts.submission_id
              AND s.deleted_at IS NULL
              AND a.deleted_at IS NULL
              AND c.deleted_at IS NULL
              AND LOWER(c.owner_email) = LOWER(?)
              AND s.grade_source = 'ai'
              AND s.grade = ai_grading_attempts.suggested_score
          )`,
        args: [
          priceBookId,
          toStringValue(billingAccount.stripeCustomerId),
          toStringValue(billingAccount.stripeSubscriptionId),
          STRIPE_CATALOG_MANIFEST.fingerprint,
          stripeUsageScope!.billingContractId,
          stripeUsageScope!.keyMode === "live" ? 1 : 0,
          creditReservation.qualifyingClassHighWater,
          creditReservation.freeCreditApplied ? 1 : 0,
          attemptId,
          ownerEmail,
          ownerEmail,
        ],
      });
      if (toNumber(markerResult.rowsAffected) !== 1) {
        throw new Error("AI grade billing marker could not be persisted atomically.");
      }
    }

    const deliveryResult = await transaction.execute({
      sql: `UPDATE ai_grading_attempts
      SET delivery_status = 'delivered'
      WHERE id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND status = 'completed'
        AND delivery_status = 'pending'`,
      args: [attemptId, ownerEmail],
    });
    if (toNumber(deliveryResult.rowsAffected) !== 1) {
      throw new Error("AI result delivery disposition could not be persisted atomically.");
    }

    if (reviewReservationId) {
      const consumed = await consumeAiReviewReservationInTransaction({
        transaction,
        reservationId: reviewReservationId,
        teacherEmail: ownerEmail,
        attemptId,
        readyStripeScope: readyStripeSubscriptionScope,
        now: Date.now(),
      });
      if (!consumed) {
        throw new Error("AI review allowance changed before result delivery.");
      }
    }

    await transaction.commit();
    return { status: "applied", billingRequired };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function deleteSubmission(submissionId: string, ownerEmail: string): Promise<boolean> {
  const result = await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE id = ?
      AND id IN (
        SELECT s.id
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.id = ?
          AND c.deleted_at IS NULL
          AND LOWER(c.owner_email) = LOWER(?)
      )
      AND deleted_at IS NULL`,
    [Date.now(), submissionId, submissionId, ownerEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function countStudentSubmissions(assignmentId: string, studentEmail: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt
    FROM submissions
    WHERE assignment_id = ?
      AND LOWER(student_email) = LOWER(?)
      AND deleted_at IS NULL`,
    [assignmentId, studentEmail]
  );
  return toNumber(result.rows[0]?.cnt);
}

export async function isStudentOnRoster(classId: string, studentEmail: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
    FROM roster
    WHERE class_id = ?
      AND LOWER(student_email) = LOWER(?)
    LIMIT 1`,
    [classId, studentEmail]
  );
  return result.rows.length > 0;
}

export async function deleteSubmissionByStudent(submissionId: string, studentEmail: string): Promise<boolean> {
  const result = await query(
    `UPDATE submissions
    SET deleted_at = ?
    WHERE id = ?
      AND LOWER(student_email) = LOWER(?)
      AND grade IS NULL
      AND deleted_at IS NULL`,
    [Date.now(), submissionId, studentEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function listGradebookRowsByClassId(classId: string, ownerEmail?: string): Promise<GradebookRow[]> {
  const result = await query(
    `SELECT
      s.student_name as studentName,
      s.student_email as studentEmail,
      a.title as assignmentTitle,
      s.grade as grade,
      COALESCE(s.feedback, '') as feedback,
      s.submitted_at as submittedAt
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE a.class_id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (? IS NULL OR LOWER(c.owner_email) = LOWER(?))
    ORDER BY LOWER(s.student_name), a.created_at DESC, s.submitted_at DESC`,
    [classId, ownerEmail ?? null, ownerEmail ?? null]
  );
  return result.rows.map((row) => ({
    studentName: toStringValue(row.studentName),
    studentEmail: toStringValue(row.studentEmail),
    assignmentTitle: toStringValue(row.assignmentTitle),
    grade: toNullableNumber(row.grade),
    feedback: toStringValue(row.feedback),
    submittedAt: toNumber(row.submittedAt),
  }));
}

export async function listStorageObjectsForHardDeleteBefore(cutoffTimestamp: number) {
  const audioResult = await query(
    `SELECT COALESCE(audio_blob_url, '') as audioBlobUrl
    FROM submissions
    WHERE deleted_at IS NOT NULL
      AND deleted_at < ?
      AND COALESCE(audio_blob_url, '') <> ''`,
    [cutoffTimestamp]
  );
  const attachmentResult = await query(
    `SELECT DISTINCT a.attachment_url as attachmentUrl
    FROM assignments a
    WHERE a.deleted_at IS NOT NULL
      AND a.deleted_at < ?
      AND COALESCE(a.attachment_url, '') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM assignments active
        WHERE active.attachment_url = a.attachment_url
          AND active.id <> a.id
          AND (active.deleted_at IS NULL OR active.deleted_at >= ?)
      )`,
    [cutoffTimestamp, cutoffTimestamp]
  );
  return {
    audioBlobUrls: audioResult.rows.map((row) => toStringValue(row.audioBlobUrl)).filter(Boolean),
    attachmentUrls: attachmentResult.rows.map((row) => toStringValue(row.attachmentUrl)).filter(Boolean),
  };
}

function normalizeAiBillingScope(scope: AiBillingScope): AiBillingScope {
  return {
    priceBookId: requireTrimmedValue("priceBookId", scope.priceBookId),
    catalogFingerprint: requireTrimmedValue(
      "catalogFingerprint",
      scope.catalogFingerprint,
    ),
    billingContractId: requireTrimmedValue(
      "billingContractId",
      scope.billingContractId,
    ),
    livemode: scope.livemode === true,
  };
}

export async function isAssignmentAttachmentReferenced(attachmentUrl: string) {
  const normalized = attachmentUrl.trim();
  if (!normalized) return false;
  const result = await query(
    `SELECT 1 as found
    FROM assignments
    WHERE attachment_url = ?
    LIMIT 1`,
    [normalized]
  );
  return Boolean(result.rows[0]);
}

export async function hardDeleteSoftDeletedBefore(cutoffTimestamp: number) {
  const submissionsDeleted = await query(
    `DELETE FROM submissions WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    [cutoffTimestamp]
  );
  const assignmentsDeleted = await query(
    `DELETE FROM assignments WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    [cutoffTimestamp]
  );
  const classesDeleted = await query(
    `DELETE FROM classes WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    [cutoffTimestamp]
  );
  return {
    submissionsDeleted: toNumber(submissionsDeleted.rowsAffected),
    assignmentsDeleted: toNumber(assignmentsDeleted.rowsAffected),
    classesDeleted: toNumber(classesDeleted.rowsAffected),
  };
}

export async function createFeedbackMessage(input: {
  name: string;
  email: string;
  school: string;
  role: string;
  message: string;
  context?: FeedbackDiagnosticContext | null;
}): Promise<FeedbackRow> {
  const item: FeedbackRow = {
    id: makeId("fb"),
    name: input.name,
    email: input.email,
    school: input.school,
    role: input.role,
    message: input.message,
    context: input.context ?? null,
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO feedback_messages (id, name, email, school, role, message, context_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.name,
      item.email,
      item.school,
      item.role,
      item.message,
      stringifyJsonValue(item.context) ?? "",
      item.createdAt,
    ]
  );
  return item;
}

export async function listFeedbackMessages(): Promise<FeedbackRow[]> {
  const result = await query(
    `SELECT id, name, email, school, role, message, context_json, created_at FROM feedback_messages ORDER BY created_at DESC`,
    []
  );
  return result.rows.map((r) => ({
    id: toStringValue(r.id),
    name: toStringValue(r.name),
    email: toStringValue(r.email),
    school: toStringValue(r.school),
    role: toStringValue(r.role),
    message: toStringValue(r.message),
    context: parseJsonValue<FeedbackDiagnosticContext>(r.context_json),
    createdAt: toNumber(r.created_at),
  }));
}

export async function deleteFeedbackMessage(id: string): Promise<boolean> {
  const result = await query(`DELETE FROM feedback_messages WHERE id = ?`, [id]);
  return result.rowsAffected > 0;
}

export async function logActivityEvent(input: {
  email: string;
  eventType: ActivityEventType;
  metadata?: Record<string, unknown> | null;
}) {
  const item: ActivityEventRow = {
    id: makeId("evt"),
    email: input.email.trim().toLowerCase(),
    eventType: input.eventType,
    occurredAt: Date.now(),
    metadata: input.metadata ?? null,
  };
  await query(
    `INSERT INTO activity_events (id, email, event_type, occurred_at, metadata)
    VALUES (?, ?, ?, ?, ?)`,
    [item.id, item.email, item.eventType, item.occurredAt, stringifyJsonValue(item.metadata)]
  );
  return item;
}

export async function listRecentActivityEvents(limit = 50): Promise<ActivityEventRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const result = await query(
    `SELECT id, email, event_type as eventType, occurred_at as occurredAt, metadata
    FROM activity_events
    ORDER BY occurred_at DESC
    LIMIT ?`,
    [safeLimit]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    email: toStringValue(row.email),
    eventType: toStringValue(row.eventType) as ActivityEventType,
    occurredAt: toNumber(row.occurredAt),
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata),
  }));
}

export async function listRecentTeacherActivityEvents(limit = 50): Promise<ActivityEventRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const result = await query(
    `SELECT e.id, e.email, e.event_type as eventType, e.occurred_at as occurredAt, e.metadata
    FROM activity_events e
    JOIN users u ON LOWER(u.email) = LOWER(e.email)
    WHERE u.role = 'teacher'
      AND e.event_type <> 'user_signed_in'
    ORDER BY e.occurred_at DESC
    LIMIT ?`,
    [safeLimit]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    email: toStringValue(row.email),
    eventType: toStringValue(row.eventType) as ActivityEventType,
    occurredAt: toNumber(row.occurredAt),
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata),
  }));
}

export async function listTeacherFunnelRows(): Promise<TeacherFunnelRow[]> {
  const result = await query(
    `SELECT
      u.email as email,
      u.role as role,
      u.created_at as joinedAt,
      COALESCE(class_counts.classCount, 0) as classCount,
      COALESCE(assignment_counts.assignmentCount, 0) as assignmentCount,
      COALESCE(submission_counts.submissionCount, 0) as submissionCount,
      activity.latestActivityAt as latestActivityAt,
      CASE
        WHEN u.is_paid = 1
          AND u.ai_access_grant_source IN (${MANUAL_AI_ACCESS_GRANT_SQL_LIST})
        THEN 1 ELSE 0
      END as isPaid
    FROM users u
    LEFT JOIN (
      SELECT LOWER(owner_email) as email, COUNT(*) as classCount
      FROM classes
      WHERE deleted_at IS NULL
      GROUP BY LOWER(owner_email)
    ) class_counts ON class_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(c.owner_email) as email, COUNT(*) as assignmentCount
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY LOWER(c.owner_email)
    ) assignment_counts ON assignment_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(c.owner_email) as email, COUNT(*) as submissionCount
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE s.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY LOWER(c.owner_email)
    ) submission_counts ON submission_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(email) as email, MAX(occurred_at) as latestActivityAt
      FROM activity_events
      GROUP BY LOWER(email)
    ) activity ON activity.email = LOWER(u.email)
    WHERE u.role = 'teacher'
    ORDER BY joinedAt DESC`
  );
  return result.rows.map((row) => ({
    email: toStringValue(row.email),
    role: normalizeUserRole(row.role),
    joinedAt: toNumber(row.joinedAt),
    classCount: toNumber(row.classCount),
    assignmentCount: toNumber(row.assignmentCount),
    submissionCount: toNumber(row.submissionCount),
    latestActivityAt: row.latestActivityAt === null ? null : toNumber(row.latestActivityAt),
    isPaid: toNumber(row.isPaid) === 1,
  }));
}

export async function findTeacherFunnelRowByEmail(
  teacherEmail: string
): Promise<TeacherFunnelRow | null> {
  const result = await query(
    `SELECT
      u.email as email,
      u.role as role,
      u.created_at as joinedAt,
      COALESCE(class_counts.classCount, 0) as classCount,
      COALESCE(assignment_counts.assignmentCount, 0) as assignmentCount,
      COALESCE(submission_counts.submissionCount, 0) as submissionCount,
      activity.latestActivityAt as latestActivityAt,
      CASE
        WHEN u.is_paid = 1
          AND u.ai_access_grant_source IN (${MANUAL_AI_ACCESS_GRANT_SQL_LIST})
        THEN 1 ELSE 0
      END as isPaid
    FROM users u
    LEFT JOIN (
      SELECT LOWER(owner_email) as email, COUNT(*) as classCount
      FROM classes
      WHERE deleted_at IS NULL
      GROUP BY LOWER(owner_email)
    ) class_counts ON class_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(c.owner_email) as email, COUNT(*) as assignmentCount
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY LOWER(c.owner_email)
    ) assignment_counts ON assignment_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(c.owner_email) as email, COUNT(*) as submissionCount
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE s.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY LOWER(c.owner_email)
    ) submission_counts ON submission_counts.email = LOWER(u.email)
    LEFT JOIN (
      SELECT LOWER(email) as email, MAX(occurred_at) as latestActivityAt
      FROM activity_events
      GROUP BY LOWER(email)
    ) activity ON activity.email = LOWER(u.email)
    WHERE u.role = 'teacher'
      AND LOWER(u.email) = LOWER(?)
    LIMIT 1`,
    [teacherEmail]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    email: toStringValue(row.email),
    role: normalizeUserRole(row.role),
    joinedAt: toNumber(row.joinedAt),
    classCount: toNumber(row.classCount),
    assignmentCount: toNumber(row.assignmentCount),
    submissionCount: toNumber(row.submissionCount),
    latestActivityAt: row.latestActivityAt === null ? null : toNumber(row.latestActivityAt),
    isPaid: toNumber(row.isPaid) === 1,
  };
}

export async function getTrackingSummary(): Promise<TrackingSummaryRow> {
  const result = await query(
    `SELECT
      COUNT(*) as totalUsers,
      SUM(CASE WHEN role = 'teacher' THEN 1 ELSE 0 END) as teacherAccounts,
      SUM(
        CASE
          WHEN role = 'teacher' AND EXISTS (
            SELECT 1 FROM classes c
            WHERE LOWER(c.owner_email) = LOWER(users.email)
              AND c.deleted_at IS NULL
          ) THEN 1
          ELSE 0
        END
      ) as activatedTeachers,
      SUM(
        CASE
          WHEN role = 'teacher' AND EXISTS (
            SELECT 1
            FROM assignments a
            JOIN classes c ON c.id = a.class_id
            WHERE LOWER(c.owner_email) = LOWER(users.email)
              AND c.deleted_at IS NULL
              AND a.deleted_at IS NULL
          ) THEN 1
          ELSE 0
        END
      ) as teachingReadyTeachers
    FROM users`
  );
  const row = result.rows[0];
  return {
    totalUsers: toNumber(row?.totalUsers),
    teacherAccounts: toNumber(row?.teacherAccounts),
    activatedTeachers: toNumber(row?.activatedTeachers),
    teachingReadyTeachers: toNumber(row?.teachingReadyTeachers),
  };
}

export async function upsertGoogleUserAndGetRole(email: string): Promise<UserRole> {
  const normalized = email.trim().toLowerCase();
  const defaultRole = defaultRoleForEmail(normalized);

  if (getTeacherAllowlist().has(normalized)) {
    // Allowlisted (teacher/admin) accounts are re-promoted on EVERY sign-in, not just
    // on first insert. Without this, an account that already signed in once as a
    // student stays a student forever and every teacher API returns 403 — a silent
    // failure that is very hard to diagnose. Authentication allowlisting grants
    // the teacher role only; AI allowance is a separate operator/billing decision.
    // This only ever grants a role; it never demotes an existing teacher.
    await query(
      `INSERT INTO users (email, role, created_at)
      VALUES (?, 'teacher', ?)
      ON CONFLICT(email) DO UPDATE SET role = 'teacher'`,
      [normalized, Date.now()]
    );
  } else {
    await query(
      `INSERT INTO users (email, role, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(email) DO NOTHING`,
      [normalized, defaultRole, Date.now()]
    );
  }
  const result = await query(
    `SELECT role
    FROM users
    WHERE LOWER(email) = LOWER(?)
    LIMIT 1`,
    [normalized]
  );
  return normalizeUserRole(result.rows[0]?.role);
}

export async function getUserRoleByEmail(email: string): Promise<UserRole> {
  const normalized = email.trim().toLowerCase();
  const result = await query(
    `SELECT role
    FROM users
    WHERE LOWER(email) = LOWER(?)
    LIMIT 1`,
    [normalized]
  );
  return normalizeUserRole(result.rows[0]?.role);
}

export async function setUserRoleTeacher(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await query(
    `INSERT INTO users (email, role, created_at)
    VALUES (?, 'teacher', ?)
    ON CONFLICT(email) DO UPDATE SET role = 'teacher'`,
    [normalized, Date.now()]
  );
}

export async function getUserDefaultLanguage(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const result = await query(
    `SELECT default_language as defaultLanguage
    FROM users
    WHERE LOWER(email) = LOWER(?)
    LIMIT 1`,
    [normalized]
  );
  const language = toStringValue(result.rows[0]?.defaultLanguage).trim();
  return language || null;
}

export async function setUserDefaultLanguage(email: string, language: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const cleanLanguage = language.trim();
  if (!cleanLanguage) return false;
  const result = await query(
    `UPDATE users SET default_language = ? WHERE LOWER(email) = LOWER(?)`,
    [cleanLanguage, normalized]
  );
  return result.rowsAffected > 0;
}

export async function getUserIsPaid(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const result = await query(
    `SELECT EXISTS(
      SELECT 1 FROM users
      WHERE LOWER(email) = LOWER(?)
        AND is_paid = 1
        AND ai_access_grant_source IN (${MANUAL_AI_ACCESS_GRANT_SQL_LIST})
    ) as isPaid`,
    [normalized]
  );
  return toNumber(result.rows[0]?.isPaid) === 1;
}

export async function setUserPaid(email: string, isPaid: boolean): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const result = await query(
    `UPDATE users
    SET is_paid = ?, ai_access_grant_source = ?
    WHERE LOWER(email) = LOWER(?)`,
    [isPaid ? 1 : 0, isPaid ? "manual" : "", normalized]
  );
  return result.rowsAffected > 0;
}

function rowToStripeBillingAccount(row: Row): StripeBillingAccountRow {
  return {
    teacherEmail: toStringValue(row.teacherEmail),
    stripeCustomerId: toStringValue(row.stripeCustomerId),
    stripeSubscriptionId:
      row.stripeSubscriptionId === null ? null : toStringValue(row.stripeSubscriptionId),
    subscriptionStatus: toStringValue(row.subscriptionStatus),
    subscriptionPeriodStart: toNumber(row.subscriptionPeriodStart),
    subscriptionPeriodEnd: toNumber(row.subscriptionPeriodEnd),
    priceBookId: toStringValue(row.priceBookId),
    catalogFingerprint: toStringValue(row.catalogFingerprint),
    stripeAccountId: toStringValue(row.stripeAccountId),
    billingContractId: toStringValue(row.billingContractId),
    livemode: toNumber(row.livemode) === 1,
    stripeEventCreated: toNumber(row.stripeEventCreated),
    projectionRevision: toNumber(row.projectionRevision),
    createdAt: toNumber(row.createdAt),
    updatedAt: toNumber(row.updatedAt),
  };
}

const STRIPE_BILLING_ACCOUNT_SELECT = `SELECT
  teacher_email as teacherEmail,
  stripe_customer_id as stripeCustomerId,
  stripe_subscription_id as stripeSubscriptionId,
  subscription_status as subscriptionStatus,
  subscription_period_start as subscriptionPeriodStart,
  subscription_period_end as subscriptionPeriodEnd,
  price_book_id as priceBookId,
  catalog_fingerprint as catalogFingerprint,
  stripe_account_id as stripeAccountId,
  billing_contract_id as billingContractId,
  livemode as livemode,
  stripe_event_created as stripeEventCreated,
  projection_revision as projectionRevision,
  created_at as createdAt,
  updated_at as updatedAt
FROM stripe_billing_accounts`;

export async function getStripeBillingAccountByTeacherEmail(
  teacherEmail: string
): Promise<StripeBillingAccountRow | null> {
  const normalized = normalizeBillingTeacherEmail(teacherEmail);
  const result = await query(
    `${STRIPE_BILLING_ACCOUNT_SELECT}
    WHERE teacher_email = ?
    LIMIT 1`,
    [normalized]
  );
  return result.rows[0] ? rowToStripeBillingAccount(result.rows[0]) : null;
}

export async function getStripeBillingAccountByCustomerId(
  stripeCustomerId: string,
  livemode?: boolean,
  stripeAccountId?: string,
  billingContractId?: string,
): Promise<StripeBillingAccountRow | null> {
  const customerId = requireTrimmedValue("stripeCustomerId", stripeCustomerId);
  const normalizedAccountId = stripeAccountId?.trim();
  const normalizedContractId = billingContractId?.trim();
  const result = await query(
    `${STRIPE_BILLING_ACCOUNT_SELECT}
    WHERE stripe_customer_id = ?
      ${livemode === undefined ? "" : "AND livemode = ?"}
      ${normalizedAccountId ? "AND stripe_account_id = ?" : ""}
      ${normalizedContractId ? "AND billing_contract_id = ?" : ""}
    LIMIT 1`,
    [
      customerId,
      ...(livemode === undefined ? [] : [livemode ? 1 : 0]),
      ...(normalizedAccountId ? [normalizedAccountId] : []),
      ...(normalizedContractId ? [normalizedContractId] : []),
    ]
  );
  return result.rows[0] ? rowToStripeBillingAccount(result.rows[0]) : null;
}

/**
 * Creates or refreshes one teacher-to-Customer identity. Runtime events may
 * never remap that identity or its Stripe mode; a reviewed operator workflow
 * must reconcile and clear a mapping before a replacement can be introduced.
 */
export async function upsertStripeBillingCustomer(input: {
  teacherEmail: string;
  stripeCustomerId: string;
  stripeAccountId: string;
  billingContractId: string;
  livemode?: boolean;
  now?: number;
}): Promise<StripeBillingAccountRow> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const stripeCustomerId = requireTrimmedValue("stripeCustomerId", input.stripeCustomerId);
  const stripeAccountId = requireTrimmedValue("stripeAccountId", input.stripeAccountId);
  const billingContractId = requireTrimmedValue(
    "billingContractId",
    input.billingContractId,
  );
  const livemode = input.livemode === true;
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await query(
    `INSERT INTO stripe_billing_accounts (
      teacher_email, stripe_customer_id, stripe_subscription_id,
      subscription_status, subscription_period_start, subscription_period_end,
      price_book_id, catalog_fingerprint,
      stripe_account_id, billing_contract_id, livemode,
      stripe_event_created, created_at, updated_at
    ) VALUES (?, ?, NULL, '', 0, 0, '', '', ?, ?, ?, 0, ?, ?)
    ON CONFLICT(teacher_email) DO UPDATE SET
      projection_revision = stripe_billing_accounts.projection_revision + 1,
      updated_at = excluded.updated_at
    WHERE stripe_billing_accounts.stripe_customer_id = excluded.stripe_customer_id
      AND stripe_billing_accounts.stripe_account_id = excluded.stripe_account_id
      AND stripe_billing_accounts.billing_contract_id = excluded.billing_contract_id
      AND stripe_billing_accounts.livemode = excluded.livemode`,
    [
      teacherEmail,
      stripeCustomerId,
      stripeAccountId,
      billingContractId,
      livemode ? 1 : 0,
      now,
      now,
    ]
  );
  const account = await getStripeBillingAccountByTeacherEmail(teacherEmail);
  if (!account) throw new Error("Stripe billing customer upsert did not persist an account.");
  if (
    account.stripeCustomerId !== stripeCustomerId ||
    account.stripeAccountId !== stripeAccountId ||
    account.billingContractId !== billingContractId ||
    account.livemode !== livemode
  ) {
    throw new Error(
      "Stripe Customer identity is already mapped differently and requires manual reconciliation.",
    );
  }
  return account;
}

/**
 * Rebinds a restored or rotated teacher mapping only after the caller has
 * exhaustively verified the replacement Customer in the pinned Stripe account.
 * The exact prior snapshot makes concurrent Checkout/webhook changes fail.
 */
export async function replaceStripeBillingCustomerMappingForRecovery(input: {
  teacherEmail: string;
  stripeCustomerId: string;
  stripeAccountId: string;
  billingContractId: string;
  livemode?: boolean;
  expectedAccount: Pick<
    StripeBillingAccountRow,
    | "stripeCustomerId"
    | "stripeAccountId"
    | "billingContractId"
    | "livemode"
    | "projectionRevision"
  >;
  now?: number;
}): Promise<StripeBillingAccountRow | null> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const stripeCustomerId = requireTrimmedValue("stripeCustomerId", input.stripeCustomerId);
  const stripeAccountId = requireTrimmedValue("stripeAccountId", input.stripeAccountId);
  const billingContractId = requireTrimmedValue(
    "billingContractId",
    input.billingContractId,
  );
  const livemode = input.livemode === true;
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const result = await query(
    `UPDATE stripe_billing_accounts
    SET stripe_customer_id = ?,
        stripe_subscription_id = NULL,
        subscription_status = '',
        subscription_period_start = 0,
        subscription_period_end = 0,
        price_book_id = '',
        catalog_fingerprint = '',
        stripe_account_id = ?,
        billing_contract_id = ?,
        livemode = ?,
        stripe_event_created = 0,
        projection_revision = projection_revision + 1,
        updated_at = ?
    WHERE teacher_email = ?
      AND stripe_customer_id = ?
      AND stripe_account_id = ?
      AND billing_contract_id = ?
      AND livemode = ?
      AND projection_revision = ?`,
    [
      stripeCustomerId,
      stripeAccountId,
      billingContractId,
      livemode ? 1 : 0,
      now,
      teacherEmail,
      input.expectedAccount.stripeCustomerId,
      input.expectedAccount.stripeAccountId,
      input.expectedAccount.billingContractId,
      input.expectedAccount.livemode ? 1 : 0,
      input.expectedAccount.projectionRevision,
    ],
  );
  if (toNumber(result.rowsAffected) !== 1) return null;
  return getStripeBillingAccountByTeacherEmail(teacherEmail);
}

/**
 * Projects a Stripe subscription webhook onto the local account. Older events
 * are ignored. At an equal Stripe timestamp, a non-entitled projection can
 * replace an entitled one, but an entitled projection cannot restore access
 * over an ordinary non-entitled one. The one exception is a verified retry
 * replacing `invalid_catalog`, which is the fail-closed placeholder written
 * before the webhook asks Stripe to retry the same event.
 */
export async function upsertStripeBillingSubscription(input: {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  subscriptionPeriodStart?: number;
  subscriptionPeriodEnd?: number;
  priceBookId: string;
  catalogFingerprint: string;
  stripeAccountId: string;
  billingContractId: string;
  livemode?: boolean;
  stripeEventCreated: number;
  now?: number;
  expectedAccount?: Pick<
    StripeBillingAccountRow,
    "stripeSubscriptionId" | "subscriptionStatus" | "stripeEventCreated" | "projectionRevision"
  >;
}): Promise<StripeBillingAccountRow | null> {
  const stripeCustomerId = requireTrimmedValue("stripeCustomerId", input.stripeCustomerId);
  const stripeSubscriptionId = requireTrimmedValue(
    "stripeSubscriptionId",
    input.stripeSubscriptionId
  );
  const subscriptionStatus = requireTrimmedValue(
    "subscriptionStatus",
    input.subscriptionStatus
  ).toLowerCase();
  const { periodStart, periodEnd } = normalizeSubscriptionPeriod({
    subscriptionStatus,
    subscriptionPeriodStart: input.subscriptionPeriodStart,
    subscriptionPeriodEnd: input.subscriptionPeriodEnd,
  });
  const priceBookId = requireTrimmedValue("priceBookId", input.priceBookId);
  const catalogFingerprint = input.catalogFingerprint.trim();
  const stripeAccountId = requireTrimmedValue("stripeAccountId", input.stripeAccountId);
  const billingContractId = requireTrimmedValue(
    "billingContractId",
    input.billingContractId,
  );
  const livemode = input.livemode === true;
  const stripeEventCreated = requireNonNegativeInteger(
    "stripeEventCreated",
    input.stripeEventCreated
  );
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const expectedAccount = input.expectedAccount
    ? {
        stripeSubscriptionId:
          input.expectedAccount.stripeSubscriptionId === null
            ? null
            : requireTrimmedValue(
                "expectedAccount.stripeSubscriptionId",
                input.expectedAccount.stripeSubscriptionId,
              ),
        subscriptionStatus: input.expectedAccount.subscriptionStatus.trim().toLowerCase(),
        stripeEventCreated: requireNonNegativeInteger(
          "expectedAccount.stripeEventCreated",
          input.expectedAccount.stripeEventCreated,
        ),
        projectionRevision: requireNonNegativeInteger(
          "expectedAccount.projectionRevision",
          input.expectedAccount.projectionRevision,
        ),
      }
    : null;
  if (
    expectedAccount?.stripeSubscriptionId &&
    expectedAccount.stripeSubscriptionId !== stripeSubscriptionId
  ) {
    throw new Error("Stripe subscription projection cannot replace the expected Subscription.");
  }
  const result = await query(
    `UPDATE stripe_billing_accounts
    SET stripe_subscription_id = ?,
        subscription_status = ?,
        subscription_period_start = ?,
        subscription_period_end = ?,
        price_book_id = ?,
        catalog_fingerprint = ?,
        stripe_event_created = ?,
        projection_revision = projection_revision + 1,
        updated_at = ?
    WHERE stripe_customer_id = ?
      AND livemode = ?
      AND stripe_account_id = ?
      AND billing_contract_id = ?
      ${
        expectedAccount
          ? `AND projection_revision = ?
      AND stripe_event_created = ?
      AND subscription_status = ?
      AND ${
        expectedAccount.stripeSubscriptionId === null
          ? "stripe_subscription_id IS NULL"
          : "stripe_subscription_id = ?"
      }`
          : ""
      }
      AND (
        stripe_event_created < ?
        OR (
          stripe_event_created = ?
          AND NOT (
            subscription_status <> 'active'
            AND ? = 'active'
            AND subscription_status <> 'invalid_catalog'
          )
        )
      )`,
    [
      stripeSubscriptionId,
      subscriptionStatus,
      periodStart,
      periodEnd,
      priceBookId,
      catalogFingerprint,
      stripeEventCreated,
      now,
      stripeCustomerId,
      livemode ? 1 : 0,
      stripeAccountId,
      billingContractId,
      ...(expectedAccount
        ? [
            expectedAccount.projectionRevision,
            expectedAccount.stripeEventCreated,
            expectedAccount.subscriptionStatus,
            ...(expectedAccount.stripeSubscriptionId === null
              ? []
              : [expectedAccount.stripeSubscriptionId]),
          ]
        : []),
      stripeEventCreated,
      stripeEventCreated,
      subscriptionStatus,
    ]
  );
  if (expectedAccount && toNumber(result.rowsAffected) !== 1) return null;
  return getStripeBillingAccountByCustomerId(
    stripeCustomerId,
    livemode,
    stripeAccountId,
    billingContractId,
  );
}

/**
 * Applies a freshly retrieved non-entitled Stripe state even when the event
 * that triggered the read is old. The optimistic account snapshot prevents an
 * old Subscription from replacing a newer mapping or racing a newer webhook.
 */
export async function projectCurrentStripeNonEntitledSubscription(input: {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  priceBookId: string;
  stripeAccountId: string;
  billingContractId: string;
  livemode?: boolean;
  observedEventCreated: number;
  expectedAccount: Pick<
    StripeBillingAccountRow,
    "stripeSubscriptionId" | "subscriptionStatus" | "stripeEventCreated" | "projectionRevision"
  >;
  now?: number;
}): Promise<StripeBillingAccountRow | null> {
  const stripeCustomerId = requireTrimmedValue("stripeCustomerId", input.stripeCustomerId);
  const stripeSubscriptionId = requireTrimmedValue(
    "stripeSubscriptionId",
    input.stripeSubscriptionId,
  );
  const subscriptionStatus = requireTrimmedValue(
    "subscriptionStatus",
    input.subscriptionStatus,
  ).toLowerCase();
  if (subscriptionStatus === "active") {
    throw new Error("Current-state projection is only valid for non-entitled subscriptions.");
  }
  const priceBookId = requireTrimmedValue("priceBookId", input.priceBookId);
  const stripeAccountId = requireTrimmedValue("stripeAccountId", input.stripeAccountId);
  const billingContractId = requireTrimmedValue(
    "billingContractId",
    input.billingContractId,
  );
  const livemode = input.livemode === true;
  const observedEventCreated = requireNonNegativeInteger(
    "observedEventCreated",
    input.observedEventCreated,
  );
  const expectedSubscriptionId =
    input.expectedAccount.stripeSubscriptionId === null
      ? null
      : requireTrimmedValue(
          "expectedAccount.stripeSubscriptionId",
          input.expectedAccount.stripeSubscriptionId,
        );
  if (expectedSubscriptionId && expectedSubscriptionId !== stripeSubscriptionId) {
    throw new Error("Current Stripe state does not match the mapped Subscription.");
  }
  const expectedSubscriptionStatus = input.expectedAccount.subscriptionStatus
    .trim()
    .toLowerCase();
  const expectedStripeEventCreated = requireNonNegativeInteger(
    "expectedAccount.stripeEventCreated",
    input.expectedAccount.stripeEventCreated,
  );
  const expectedProjectionRevision = requireNonNegativeInteger(
    "expectedAccount.projectionRevision",
    input.expectedAccount.projectionRevision,
  );
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const result = await query(
    `UPDATE stripe_billing_accounts
    SET stripe_subscription_id = ?,
        subscription_status = ?,
        subscription_period_start = 0,
        subscription_period_end = 0,
        price_book_id = ?,
        catalog_fingerprint = '',
        stripe_event_created = MAX(stripe_event_created, ?),
        projection_revision = projection_revision + 1,
        updated_at = ?
    WHERE stripe_customer_id = ?
      AND livemode = ?
      AND stripe_account_id = ?
      AND billing_contract_id = ?
      AND projection_revision = ?
      AND stripe_event_created = ?
      AND subscription_status = ?
      AND ${
        expectedSubscriptionId === null
          ? "stripe_subscription_id IS NULL"
          : "stripe_subscription_id = ?"
      }`,
    [
      stripeSubscriptionId,
      subscriptionStatus,
      priceBookId,
      observedEventCreated,
      now,
      stripeCustomerId,
      livemode ? 1 : 0,
      stripeAccountId,
      billingContractId,
      expectedProjectionRevision,
      expectedStripeEventCreated,
      expectedSubscriptionStatus,
      ...(expectedSubscriptionId === null ? [] : [expectedSubscriptionId]),
    ],
  );
  if (toNumber(result.rowsAffected) !== 1) return null;
  return getStripeBillingAccountByCustomerId(
    stripeCustomerId,
    livemode,
    stripeAccountId,
    billingContractId,
  );
}

/**
 * Applies a freshly retrieved and fully verified entitled Stripe state. This
 * deliberately does not compare the triggering webhook timestamp: the remote
 * Subscription read is current, while the webhook that prompted it may be old.
 * Exact snapshot matching prevents that current-state observation from
 * overwriting a concurrent webhook or a replacement Subscription. When the
 * snapshot loses only because another handler already wrote the exact same
 * verified projection, an exact-state fallback converges the watermark. A
 * divergent status, Subscription, catalog, account, contract, or mode still
 * fails the compare-and-swap.
 */
export async function projectCurrentStripeEntitledSubscription(input: {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  subscriptionPeriodStart: number;
  subscriptionPeriodEnd: number;
  priceBookId: string;
  catalogFingerprint: string;
  stripeAccountId: string;
  billingContractId: string;
  livemode?: boolean;
  observedEventCreated: number;
  expectedAccount: Pick<
    StripeBillingAccountRow,
    "stripeSubscriptionId" | "subscriptionStatus" | "stripeEventCreated" | "projectionRevision"
  >;
  now?: number;
}): Promise<StripeBillingAccountRow | null> {
  const stripeCustomerId = requireTrimmedValue("stripeCustomerId", input.stripeCustomerId);
  const stripeSubscriptionId = requireTrimmedValue(
    "stripeSubscriptionId",
    input.stripeSubscriptionId,
  );
  const subscriptionStatus = requireTrimmedValue(
    "subscriptionStatus",
    input.subscriptionStatus,
  ).toLowerCase();
  if (subscriptionStatus !== "active") {
    throw new Error("Current entitled projection requires an active Subscription.");
  }
  const { periodStart, periodEnd } = normalizeSubscriptionPeriod({
    subscriptionStatus,
    subscriptionPeriodStart: input.subscriptionPeriodStart,
    subscriptionPeriodEnd: input.subscriptionPeriodEnd,
  });
  const priceBookId = requireTrimmedValue("priceBookId", input.priceBookId);
  const catalogFingerprint = requireTrimmedValue(
    "catalogFingerprint",
    input.catalogFingerprint,
  );
  const stripeAccountId = requireTrimmedValue("stripeAccountId", input.stripeAccountId);
  const billingContractId = requireTrimmedValue(
    "billingContractId",
    input.billingContractId,
  );
  const livemode = input.livemode === true;
  const observedEventCreated = requireNonNegativeInteger(
    "observedEventCreated",
    input.observedEventCreated,
  );
  const expectedSubscriptionId =
    input.expectedAccount.stripeSubscriptionId === null
      ? null
      : requireTrimmedValue(
          "expectedAccount.stripeSubscriptionId",
          input.expectedAccount.stripeSubscriptionId,
        );
  if (expectedSubscriptionId && expectedSubscriptionId !== stripeSubscriptionId) {
    throw new Error("Current Stripe state does not match the mapped Subscription.");
  }
  const expectedSubscriptionStatus = input.expectedAccount.subscriptionStatus
    .trim()
    .toLowerCase();
  const expectedStripeEventCreated = requireNonNegativeInteger(
    "expectedAccount.stripeEventCreated",
    input.expectedAccount.stripeEventCreated,
  );
  const expectedProjectionRevision = requireNonNegativeInteger(
    "expectedAccount.projectionRevision",
    input.expectedAccount.projectionRevision,
  );
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const result = await query(
    `UPDATE stripe_billing_accounts
    SET stripe_subscription_id = ?,
        subscription_status = ?,
        subscription_period_start = ?,
        subscription_period_end = ?,
        price_book_id = ?,
        catalog_fingerprint = ?,
        stripe_event_created = MAX(stripe_event_created, ?),
        projection_revision = projection_revision + 1,
        updated_at = ?
    WHERE stripe_customer_id = ?
      AND livemode = ?
      AND stripe_account_id = ?
      AND billing_contract_id = ?
      AND projection_revision = ?
      AND stripe_event_created = ?
      AND subscription_status = ?
      AND ${
        expectedSubscriptionId === null
          ? "stripe_subscription_id IS NULL"
          : "stripe_subscription_id = ?"
      }`,
    [
      stripeSubscriptionId,
      subscriptionStatus,
      periodStart,
      periodEnd,
      priceBookId,
      catalogFingerprint,
      observedEventCreated,
      now,
      stripeCustomerId,
      livemode ? 1 : 0,
      stripeAccountId,
      billingContractId,
      expectedProjectionRevision,
      expectedStripeEventCreated,
      expectedSubscriptionStatus,
      ...(expectedSubscriptionId === null ? [] : [expectedSubscriptionId]),
    ],
  );
  if (toNumber(result.rowsAffected) !== 1) {
    // Stripe commonly delivers customer.subscription.created alongside
    // checkout.session.completed. Both handlers can retrieve and verify the
    // same current Subscription from the same local snapshot. Let the losing
    // handler converge only if the winner persisted every desired field in the
    // same immutable billing scope. This remains one atomic conditional write,
    // so a concurrent revocation or replacement cannot be mistaken for success.
    const converged = await query(
      `UPDATE stripe_billing_accounts
      SET stripe_event_created = MAX(stripe_event_created, ?),
          projection_revision = projection_revision + CASE
            WHEN stripe_event_created < ? THEN 1
            ELSE 0
          END,
          updated_at = CASE
            WHEN stripe_event_created < ? THEN ?
            ELSE updated_at
          END
      WHERE stripe_customer_id = ?
        AND stripe_subscription_id = ?
        AND subscription_status = ?
        AND subscription_period_start = ?
        AND subscription_period_end = ?
        AND price_book_id = ?
        AND catalog_fingerprint = ?
        AND livemode = ?
        AND stripe_account_id = ?
        AND billing_contract_id = ?`,
      [
        observedEventCreated,
        observedEventCreated,
        observedEventCreated,
        now,
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus,
        periodStart,
        periodEnd,
        priceBookId,
        catalogFingerprint,
        livemode ? 1 : 0,
        stripeAccountId,
        billingContractId,
      ],
    );
    if (toNumber(converged.rowsAffected) !== 1) return null;
  }
  return getStripeBillingAccountByCustomerId(
    stripeCustomerId,
    livemode,
    stripeAccountId,
    billingContractId,
  );
}

/**
 * Replaces a terminal mapped Subscription only after Checkout has retrieved and
 * verified a new entitled Subscription. Exact snapshot matching makes this a
 * compare-and-swap transition, so delayed Checkout events cannot win a race.
 */
export async function replaceTerminalStripeSubscriptionFromCheckout(input: {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  subscriptionPeriodStart: number;
  subscriptionPeriodEnd: number;
  priceBookId: string;
  catalogFingerprint: string;
  stripeAccountId: string;
  billingContractId: string;
  livemode?: boolean;
  observedEventCreated: number;
  expectedAccount: Pick<
    StripeBillingAccountRow,
    "stripeSubscriptionId" | "subscriptionStatus" | "stripeEventCreated" | "projectionRevision"
  >;
  now?: number;
}): Promise<StripeBillingAccountRow | null> {
  const stripeCustomerId = requireTrimmedValue("stripeCustomerId", input.stripeCustomerId);
  const stripeSubscriptionId = requireTrimmedValue(
    "stripeSubscriptionId",
    input.stripeSubscriptionId,
  );
  const subscriptionStatus = requireTrimmedValue(
    "subscriptionStatus",
    input.subscriptionStatus,
  ).toLowerCase();
  if (subscriptionStatus !== "active") {
    throw new Error("Checkout replacement requires an entitled Subscription state.");
  }
  const { periodStart, periodEnd } = normalizeSubscriptionPeriod({
    subscriptionStatus,
    subscriptionPeriodStart: input.subscriptionPeriodStart,
    subscriptionPeriodEnd: input.subscriptionPeriodEnd,
  });
  const priceBookId = requireTrimmedValue("priceBookId", input.priceBookId);
  const catalogFingerprint = requireTrimmedValue(
    "catalogFingerprint",
    input.catalogFingerprint,
  );
  const stripeAccountId = requireTrimmedValue("stripeAccountId", input.stripeAccountId);
  const billingContractId = requireTrimmedValue(
    "billingContractId",
    input.billingContractId,
  );
  const livemode = input.livemode === true;
  const observedEventCreated = requireNonNegativeInteger(
    "observedEventCreated",
    input.observedEventCreated,
  );
  const expectedSubscriptionId =
    input.expectedAccount.stripeSubscriptionId === null
      ? null
      : requireTrimmedValue(
          "expectedAccount.stripeSubscriptionId",
          input.expectedAccount.stripeSubscriptionId,
        );
  const expectedSubscriptionStatus = input.expectedAccount.subscriptionStatus
    .trim()
    .toLowerCase();
  if (
    !expectedSubscriptionId ||
    expectedSubscriptionId === stripeSubscriptionId ||
    !["canceled", "incomplete_expired"].includes(expectedSubscriptionStatus)
  ) {
    throw new Error("Checkout replacement requires a different terminal mapped Subscription.");
  }
  const expectedStripeEventCreated = requireNonNegativeInteger(
    "expectedAccount.stripeEventCreated",
    input.expectedAccount.stripeEventCreated,
  );
  const expectedProjectionRevision = requireNonNegativeInteger(
    "expectedAccount.projectionRevision",
    input.expectedAccount.projectionRevision,
  );
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const result = await query(
    `UPDATE stripe_billing_accounts
    SET stripe_subscription_id = ?,
        subscription_status = ?,
        subscription_period_start = ?,
        subscription_period_end = ?,
        price_book_id = ?,
        catalog_fingerprint = ?,
        stripe_event_created = MAX(stripe_event_created, ?),
        projection_revision = projection_revision + 1,
        updated_at = ?
    WHERE stripe_customer_id = ?
      AND livemode = ?
      AND stripe_account_id = ?
      AND billing_contract_id = ?
      AND projection_revision = ?
      AND stripe_subscription_id = ?
      AND subscription_status = ?
      AND stripe_event_created = ?`,
    [
      stripeSubscriptionId,
      subscriptionStatus,
      periodStart,
      periodEnd,
      priceBookId,
      catalogFingerprint,
      observedEventCreated,
      now,
      stripeCustomerId,
      livemode ? 1 : 0,
      stripeAccountId,
      billingContractId,
      expectedProjectionRevision,
      expectedSubscriptionId,
      expectedSubscriptionStatus,
      expectedStripeEventCreated,
    ],
  );
  if (toNumber(result.rowsAffected) !== 1) return null;
  return getStripeBillingAccountByCustomerId(
    stripeCustomerId,
    livemode,
    stripeAccountId,
    billingContractId,
  );
}

export async function getStripeSubscriptionGrantsAiAccess(teacherEmail: string): Promise<boolean> {
  const scope = await getReadyStripeSubscriptionScope();
  if (!scope) return false;
  const normalized = normalizeBillingTeacherEmail(teacherEmail);
  const now = Date.now();
  const result = await query(
    `SELECT EXISTS(
      SELECT 1
      FROM stripe_billing_accounts
      WHERE teacher_email = ?
        AND subscription_status = 'active'
        AND subscription_period_start <= ?
        AND subscription_period_end > ?
        AND price_book_id = ?
        AND catalog_fingerprint = ?
        AND stripe_account_id = ?
        AND billing_contract_id = ?
        AND livemode = ?
    ) as hasAccess`,
    [
      normalized,
      now,
      now,
      TEACHER_AI_PRICE_BOOK.id,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      scope.accountId,
      scope.billingContractId,
      scope.keyMode === "live" ? 1 : 0,
    ]
  );
  return toNumber(result.rows[0]?.hasAccess) === 1;
}

/** Existing manual grants remain valid while Stripe subscriptions are additive. */
export async function getUserHasAiAccess(email: string): Promise<boolean> {
  const normalized = normalizeBillingTeacherEmail(email);
  const manual = await query(
    `SELECT EXISTS(
      SELECT 1 FROM users
      WHERE LOWER(email) = LOWER(?)
        AND is_paid = 1
        AND ai_access_grant_source IN (${MANUAL_AI_ACCESS_GRANT_SQL_LIST})
    ) as hasAccess`,
    [normalized]
  );
  if (toNumber(manual.rows[0]?.hasAccess) === 1) return true;
  return getStripeSubscriptionGrantsAiAccess(normalized);
}

/**
 * Appends an auditable courtesy allowance to the Free lifetime bucket.
 *
 * The email intentionally has no users-table dependency, so an operator can
 * provision a grant before the teacher's first successful sign-in. Retrying an
 * identical grant is a no-op; reusing its key for different audit data fails
 * closed instead of silently changing the original grant.
 */
async function grantAiReviewLifetimeBonusAtomic(input: {
  teacherEmail: string;
  grantKey: string;
  units: number;
  reason: string;
  grantedBy: string;
  now?: number;
}): Promise<AiReviewLifetimeBonusGrantResult> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const grantKey = requireTrimmedValue("grantKey", input.grantKey);
  if (!Number.isSafeInteger(input.units) || input.units <= 0) {
    throw new RangeError("units must be a positive safe integer.");
  }
  const units = input.units;
  const reason = requireTrimmedValue("reason", input.reason);
  const grantedBy = requireTrimmedValue("grantedBy", input.grantedBy);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const insertion = await transaction.execute({
      sql: `INSERT INTO ai_review_lifetime_bonus_grants_v1 (
        teacher_email, grant_key, units, reason, granted_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(teacher_email, grant_key) DO NOTHING`,
      args: [teacherEmail, grantKey, units, reason, grantedBy, now],
    });
    const existingResult = await transaction.execute({
      sql: `SELECT
        teacher_email as teacherEmail,
        grant_key as grantKey,
        units,
        reason,
        granted_by as grantedBy,
        created_at as createdAt
      FROM ai_review_lifetime_bonus_grants_v1
      WHERE teacher_email = ? AND grant_key = ?
      LIMIT 1`,
      args: [teacherEmail, grantKey],
    });
    const row = existingResult.rows[0];
    if (!row) {
      throw new Error("AI review lifetime bonus grant was not persisted.");
    }
    if (
      toNumber(row.units) !== units
      || toStringValue(row.reason) !== reason
      || toStringValue(row.grantedBy) !== grantedBy
    ) {
      throw new Error(
        "AI review lifetime bonus grant key already exists with different payload.",
      );
    }
    const totalResult = await transaction.execute({
      sql: `SELECT COALESCE(SUM(units), 0) as totalBonusUnits
      FROM ai_review_lifetime_bonus_grants_v1
      WHERE teacher_email = ?`,
      args: [teacherEmail],
    });
    const totalBonusUnits = requireNonNegativeInteger(
      "totalBonusUnits",
      toNumber(totalResult.rows[0]?.totalBonusUnits),
    );
    await transaction.commit();
    return {
      teacherEmail: toStringValue(row.teacherEmail),
      grantKey: toStringValue(row.grantKey),
      units: toNumber(row.units),
      reason: toStringValue(row.reason),
      grantedBy: toStringValue(row.grantedBy),
      createdAt: toNumber(row.createdAt),
      created: toNumber(insertion.rowsAffected) === 1,
      totalBonusUnits,
    };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

let aiReviewLifetimeBonusGrantQueue: Promise<void> = Promise.resolve();

export async function grantAiReviewLifetimeBonus(input: {
  teacherEmail: string;
  grantKey: string;
  units: number;
  reason: string;
  grantedBy: string;
  now?: number;
}): Promise<AiReviewLifetimeBonusGrantResult> {
  const preceding = aiReviewLifetimeBonusGrantQueue;
  let releaseQueue!: () => void;
  aiReviewLifetimeBonusGrantQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await preceding;
  try {
    return await grantAiReviewLifetimeBonusAtomic(input);
  } finally {
    releaseQueue();
  }
}

const AI_REVIEW_RESERVATION_LEASE_MS = 15 * 60 * 1_000;
const TERMINAL_STRIPE_SUBSCRIPTION_STATUSES = new Set([
  "canceled",
  "incomplete_expired",
]);

type ResolvedAiReviewAllowance = {
  status: AiReviewAllowanceStatus;
  allowanceKind: AiReviewAllowanceKind | null;
  scopeKey: string;
  limit: number;
  stripeSubscriptionId: string | null;
  periodStart: number | null;
  periodEnd: number | null;
};

async function resolveAiReviewAllowanceInTransaction(input: {
  transaction: Transaction;
  teacherEmail: string;
  readyStripeScope: ReadyStripeSubscriptionScope | null;
  now: number;
}): Promise<ResolvedAiReviewAllowance> {
  const result = await input.transaction.execute({
    sql: `SELECT
      CASE
        WHEN COALESCE(u.is_paid, 0) = 1
          AND u.ai_access_grant_source IN (${MANUAL_AI_ACCESS_GRANT_SQL_LIST})
        THEN 1 ELSE 0
      END as manualAccess,
      sba.stripe_subscription_id as stripeSubscriptionId,
      COALESCE(sba.subscription_status, '') as subscriptionStatus,
      COALESCE(sba.subscription_period_start, 0) as subscriptionPeriodStart,
      COALESCE(sba.subscription_period_end, 0) as subscriptionPeriodEnd,
      COALESCE(sba.price_book_id, '') as priceBookId,
      COALESCE(sba.catalog_fingerprint, '') as catalogFingerprint,
      COALESCE(sba.stripe_account_id, '') as stripeAccountId,
      COALESCE(sba.billing_contract_id, '') as billingContractId,
      COALESCE(sba.livemode, 0) as livemode
    FROM (SELECT ? as teacher_email) identity
    LEFT JOIN users u ON LOWER(u.email) = LOWER(identity.teacher_email)
    LEFT JOIN stripe_billing_accounts sba
      ON LOWER(sba.teacher_email) = LOWER(identity.teacher_email)
    LIMIT 1`,
    args: [input.teacherEmail],
  });
  const row = result.rows[0];
  const subscriptionId = toStringValue(row?.stripeSubscriptionId).trim();
  const subscriptionStatus = toStringValue(row?.subscriptionStatus)
    .trim()
    .toLowerCase();

  // Any mapped state that Stripe still considers nonterminal owns the access
  // decision. It may not silently fall through to a lifetime bucket when its
  // account, contract, catalog, mode, or period is stale or contradictory.
  if (
    subscriptionId &&
    !TERMINAL_STRIPE_SUBSCRIPTION_STATUSES.has(subscriptionStatus)
  ) {
    const periodStart = toNumber(row?.subscriptionPeriodStart);
    const periodEnd = toNumber(row?.subscriptionPeriodEnd);
    const scope = input.readyStripeScope;
    const exactActiveSubscription =
      subscriptionStatus === "active" &&
      scope !== null &&
      toStringValue(row?.priceBookId) === STRIPE_CATALOG_MANIFEST.priceBookId &&
      toStringValue(row?.catalogFingerprint) === STRIPE_CATALOG_MANIFEST.fingerprint &&
      toStringValue(row?.stripeAccountId) === scope.accountId &&
      toStringValue(row?.billingContractId) === scope.billingContractId &&
      (toNumber(row?.livemode) === 1) === (scope.keyMode === "live") &&
      Number.isSafeInteger(periodStart) &&
      Number.isSafeInteger(periodEnd) &&
      periodStart > 0 &&
      periodEnd > periodStart &&
      periodStart <= input.now &&
      periodEnd > input.now;
    if (!exactActiveSubscription) {
      return {
        status: "subscription_unavailable",
        allowanceKind: null,
        scopeKey: "",
        limit: 0,
        stripeSubscriptionId: subscriptionId,
        periodStart: periodStart > 0 ? periodStart : null,
        periodEnd: periodEnd > 0 ? periodEnd : null,
      };
    }
    return {
      status: "teacher_period",
      allowanceKind: "teacher_period",
      scopeKey: `teacher_period:${subscriptionId}:${periodStart}:${periodEnd}`,
      limit: AI_REVIEW_TEACHER_PERIOD_LIMIT,
      stripeSubscriptionId: subscriptionId,
      periodStart,
      periodEnd,
    };
  }

  if (toNumber(row?.manualAccess) === 1) {
    return {
      status: "manual_lifetime",
      allowanceKind: "manual_lifetime",
      scopeKey: "manual_lifetime",
      limit: AI_REVIEW_MANUAL_LIFETIME_LIMIT,
      stripeSubscriptionId: null,
      periodStart: null,
      periodEnd: null,
    };
  }
  const bonusResult = await input.transaction.execute({
    sql: `SELECT COALESCE(SUM(units), 0) as bonusUnits
    FROM ai_review_lifetime_bonus_grants_v1
    WHERE teacher_email = ?`,
    args: [input.teacherEmail],
  });
  const bonusUnits = requireNonNegativeInteger(
    "AI review lifetime bonus units",
    toNumber(bonusResult.rows[0]?.bonusUnits),
  );
  const freeLifetimeLimit = AI_REVIEW_FREE_LIFETIME_LIMIT + bonusUnits;
  if (!Number.isSafeInteger(freeLifetimeLimit)) {
    throw new RangeError("AI review lifetime allowance exceeds the safe integer range.");
  }
  return {
    status: "free_lifetime",
    allowanceKind: "free_lifetime",
    scopeKey: "free_lifetime",
    limit: freeLifetimeLimit,
    stripeSubscriptionId: null,
    periodStart: null,
    periodEnd: null,
  };
}

async function summarizeAiReviewAllowanceInTransaction(input: {
  transaction: Transaction;
  teacherEmail: string;
  allowance: ResolvedAiReviewAllowance;
  now: number;
}): Promise<AiReviewAllowanceSummary> {
  if (!input.allowance.allowanceKind) {
    return {
      teacherEmail: input.teacherEmail,
      status: "subscription_unavailable",
      limit: 0,
      reserved: 0,
      consumed: 0,
      used: 0,
      remaining: 0,
      stripeSubscriptionId: input.allowance.stripeSubscriptionId,
      periodStart: input.allowance.periodStart,
      periodEnd: input.allowance.periodEnd,
    };
  }
  const result = await input.transaction.execute({
    sql: `SELECT
      SUM(CASE
        WHEN status = 'reserved' AND updated_at > ? THEN 1 ELSE 0
      END) as reserved,
      SUM(CASE WHEN status = 'consumed' THEN 1 ELSE 0 END) as consumed
    FROM ai_review_allowance_reservations_v1
    WHERE LOWER(teacher_email) = LOWER(?)
      AND scope_key = ?
      AND status IN ('reserved', 'consumed')`,
    args: [
      input.now - AI_REVIEW_RESERVATION_LEASE_MS,
      input.teacherEmail,
      input.allowance.scopeKey,
    ],
  });
  const reserved = toNumber(result.rows[0]?.reserved);
  const consumed = toNumber(result.rows[0]?.consumed);
  const used = reserved + consumed;
  return {
    teacherEmail: input.teacherEmail,
    status: input.allowance.status,
    limit: input.allowance.limit,
    reserved,
    consumed,
    used,
    remaining: Math.max(0, input.allowance.limit - used),
    stripeSubscriptionId: input.allowance.stripeSubscriptionId,
    periodStart: input.allowance.periodStart,
    periodEnd: input.allowance.periodEnd,
  };
}

/** Returns the currently authoritative allowance without creating capacity. */
export async function getAiReviewAllowanceSummary(input: {
  teacherEmail: string;
  now?: number;
}): Promise<AiReviewAllowanceSummary> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const readyStripeScope = await getReadyStripeSubscriptionScope();
  await ensureInitialized();
  const transaction = await getDbClient().transaction("read");
  try {
    const allowance = await resolveAiReviewAllowanceInTransaction({
      transaction,
      teacherEmail,
      readyStripeScope,
      now,
    });
    const summary = await summarizeAiReviewAllowanceInTransaction({
      transaction,
      teacherEmail,
      allowance,
      now,
    });
    await transaction.commit();
    return summary;
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

/**
 * Returns the lifetime Free reviews already delivered before a teacher moves
 * onto a paid allowance. This historical count remains available after the
 * active allowance switches to the Stripe-backed Teacher period.
 */
export async function getConsumedFreeAiReviewCount(teacherEmail: string): Promise<number> {
  const normalized = normalizeBillingTeacherEmail(teacherEmail);
  const result = await query(
    `SELECT COUNT(*) as count
      FROM ai_review_allowance_reservations_v1
      WHERE LOWER(teacher_email) = LOWER(?)
        AND allowance_kind = 'free_lifetime'
        AND status = 'consumed'`,
    [normalized],
  );
  return toNumber(result.rows[0]?.count);
}

/**
 * Atomically claims one potential successful review before any AI provider is
 * called. Reserved rows count against the cap, so concurrent requests cannot
 * oversubscribe it. A consumed semantic key is reusable without another unit.
 */
let aiReviewReservationQueue: Promise<void> = Promise.resolve();

async function reserveAiReviewAllowanceAtomic(input: {
  teacherEmail: string;
  semanticKey: string;
  now?: number;
}): Promise<AiReviewReservationResult> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const semanticKey = requireTrimmedValue("semanticKey", input.semanticKey);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const readyStripeScope = await getReadyStripeSubscriptionScope();
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const allowance = await resolveAiReviewAllowanceInTransaction({
      transaction,
      teacherEmail,
      readyStripeScope,
      now,
    });
    await transaction.execute({
      sql: `UPDATE ai_review_allowance_reservations_v1
      SET status = 'released', updated_at = ?, released_at = ?
      WHERE LOWER(teacher_email) = LOWER(?)
        AND status = 'reserved'
        AND updated_at <= ?`,
      args: [
        now,
        now,
        teacherEmail,
        now - AI_REVIEW_RESERVATION_LEASE_MS,
      ],
    });
    const baseSummary = await summarizeAiReviewAllowanceInTransaction({
      transaction,
      teacherEmail,
      allowance,
      now,
    });
    if (!allowance.allowanceKind) {
      await transaction.commit();
      return { ...baseSummary, reservationStatus: "subscription_unavailable" };
    }

    const existingResult = await transaction.execute({
      sql: `SELECT id, status, scope_key as scopeKey,
        attempt_id as attemptId, source_kind as sourceKind,
        updated_at as updatedAt
      FROM ai_review_allowance_reservations_v1
      WHERE LOWER(teacher_email) = LOWER(?) AND semantic_key = ?
      LIMIT 1`,
      args: [teacherEmail, semanticKey],
    });
    const existing = existingResult.rows[0];
    if (toStringValue(existing?.status) === "consumed") {
      const sourceAttemptId = toStringValue(existing?.attemptId).trim();
      if (!sourceAttemptId) {
        throw new Error("Consumed AI review allowance is missing its source attempt.");
      }
      const sourceKind: AiReviewSourceKind =
        toStringValue(existing?.sourceKind) === "transcript" ? "transcript" : "grading";
      await transaction.commit();
      return {
        ...baseSummary,
        reservationStatus: "duplicate",
        reservationId: toStringValue(existing.id),
        sourceAttemptId,
        sourceResultId: sourceAttemptId,
        sourceKind,
      };
    }
    if (
      toStringValue(existing?.status) === "reserved" &&
      toNumber(existing?.updatedAt) > now - AI_REVIEW_RESERVATION_LEASE_MS
    ) {
      await transaction.commit();
      return { ...baseSummary, reservationStatus: "in_flight" };
    }
    if (baseSummary.remaining <= 0) {
      await transaction.commit();
      return { ...baseSummary, reservationStatus: "exhausted" };
    }

    const reservationId = existing
      ? toStringValue(existing.id)
      : makeId("air");
    if (existing) {
      const reclaimed = await transaction.execute({
        sql: `UPDATE ai_review_allowance_reservations_v1
        SET allowance_kind = ?, scope_key = ?, stripe_subscription_id = ?,
            period_start = ?, period_end = ?, status = 'reserved', attempt_id = '',
            source_kind = 'grading', updated_at = ?, consumed_at = NULL,
            released_at = NULL
        WHERE id = ? AND LOWER(teacher_email) = LOWER(?)
          AND semantic_key = ?
          AND (status = 'released' OR (status = 'reserved' AND updated_at <= ?))`,
        args: [
          allowance.allowanceKind,
          allowance.scopeKey,
          allowance.stripeSubscriptionId ?? "",
          allowance.periodStart ?? 0,
          allowance.periodEnd ?? 0,
          now,
          reservationId,
          teacherEmail,
          semanticKey,
          now - AI_REVIEW_RESERVATION_LEASE_MS,
        ],
      });
      if (toNumber(reclaimed.rowsAffected) !== 1) {
        throw new Error("AI review reservation changed during reclamation.");
      }
    } else {
      await transaction.execute({
        sql: `INSERT INTO ai_review_allowance_reservations_v1 (
          id, teacher_email, semantic_key, allowance_kind, scope_key,
          stripe_subscription_id, period_start, period_end, status, attempt_id,
          created_at, updated_at, consumed_at, released_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', '', ?, ?, NULL, NULL)`,
        args: [
          reservationId,
          teacherEmail,
          semanticKey,
          allowance.allowanceKind,
          allowance.scopeKey,
          allowance.stripeSubscriptionId ?? "",
          allowance.periodStart ?? 0,
          allowance.periodEnd ?? 0,
          now,
          now,
        ],
      });
    }
    const summary = await summarizeAiReviewAllowanceInTransaction({
      transaction,
      teacherEmail,
      allowance,
      now,
    });
    await transaction.commit();
    return { ...summary, reservationStatus: "reserved", reservationId };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function reserveAiReviewAllowance(input: {
  teacherEmail: string;
  semanticKey: string;
  now?: number;
}): Promise<AiReviewReservationResult> {
  const preceding = aiReviewReservationQueue;
  let releaseQueue!: () => void;
  aiReviewReservationQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await preceding;
  try {
    return await reserveAiReviewAllowanceAtomic(input);
  } finally {
    releaseQueue();
  }
}

/** Releases capacity only while the claim is still unconsumed. */
export async function releaseAiReviewAllowanceReservation(input: {
  reservationId: string;
  teacherEmail: string;
  now?: number;
}): Promise<boolean> {
  const reservationId = requireTrimmedValue("reservationId", input.reservationId);
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const result = await query(
    `UPDATE ai_review_allowance_reservations_v1
    SET status = 'released', updated_at = ?, released_at = ?
    WHERE id = ? AND LOWER(teacher_email) = LOWER(?) AND status = 'reserved'`,
    [now, now, reservationId, teacherEmail],
  );
  return toNumber(result.rowsAffected) === 1;
}

async function consumeAiReviewReservationInTransaction(input: {
  transaction: Transaction;
  reservationId: string;
  teacherEmail: string;
  attemptId: string;
  readyStripeScope: ReadyStripeSubscriptionScope | null;
  now: number;
}) {
  const allowance = await resolveAiReviewAllowanceInTransaction({
    transaction: input.transaction,
    teacherEmail: input.teacherEmail,
    readyStripeScope: input.readyStripeScope,
    now: input.now,
  });
  if (!allowance.allowanceKind) return false;
  await input.transaction.execute({
    sql: `INSERT INTO submission_transcripts (
      id, submission_id, teacher_email, semantic_key, assignment_fingerprint,
      transcript_cache_key, transcript, detected_language, transcript_quality,
      duration_seconds, transcription_provider, transcription_model,
      estimated_cost_microusd, latency_ms, created_at, updated_at
    )
    SELECT ?, ag.submission_id, LOWER(ag.teacher_email), ag.cache_key,
      ag.assignment_fingerprint, '', TRIM(ag.transcript), ag.detected_language,
      ag.transcript_quality, ag.duration_seconds, ag.transcription_provider,
      ag.transcription_model, 0, 0, ?, ?
    FROM ai_grading_attempts ag
    JOIN submissions s ON s.id = ag.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.id = ?
      AND LOWER(ag.teacher_email) = LOWER(?)
      AND ag.status = 'completed'
      AND ag.delivery_status IN ('pending', 'not_applicable', 'delivered')
      AND TRIM(ag.transcript) <> ''
      AND TRIM(ag.error_code) = ''
      AND TRIM(ag.cache_key) <> ''
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ON CONFLICT(submission_id, semantic_key) DO UPDATE SET
      id = submission_transcripts.id`,
    args: [
      makeId("tr"),
      input.now,
      input.now,
      input.attemptId,
      input.teacherEmail,
      input.teacherEmail,
    ],
  });
  const durableTranscript = await input.transaction.execute({
    sql: `SELECT st.id
    FROM submission_transcripts st
    JOIN ai_grading_attempts ag
      ON ag.submission_id = st.submission_id
      AND ag.cache_key = st.semantic_key
    JOIN submissions s ON s.id = st.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.id = ?
      AND LOWER(ag.teacher_email) = LOWER(?)
      AND LOWER(st.teacher_email) = LOWER(?)
      AND LOWER(c.owner_email) = LOWER(?)
      AND TRIM(st.transcript) <> ''
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    args: [
      input.attemptId,
      input.teacherEmail,
      input.teacherEmail,
      input.teacherEmail,
    ],
  });
  if (!durableTranscript.rows[0]) return false;
  const result = await input.transaction.execute({
    sql: `UPDATE ai_review_allowance_reservations_v1
    SET status = 'consumed', attempt_id = ?, source_kind = 'grading',
        updated_at = ?,
        consumed_at = CASE WHEN status = 'reserved' THEN ? ELSE consumed_at END,
        released_at = NULL
    WHERE id = ?
      AND LOWER(teacher_email) = LOWER(?)
      AND semantic_key = (
        SELECT cache_key FROM ai_grading_attempts
        WHERE id = ?
          AND LOWER(teacher_email) = LOWER(?)
          AND status = 'completed'
          AND delivery_status IN ('pending', 'not_applicable', 'delivered')
          AND TRIM(transcript) <> ''
          AND TRIM(error_code) = ''
          AND TRIM(cache_key) <> ''
        LIMIT 1
      )
      AND (
        (
          status = 'reserved'
          AND allowance_kind = ?
          AND scope_key = ?
        )
        OR (
          status = 'consumed'
          AND source_kind = 'transcript'
          AND EXISTS (
            SELECT 1
            FROM submission_transcripts st
            JOIN submissions s ON s.id = st.submission_id
            JOIN assignments a ON a.id = s.assignment_id
            JOIN classes c ON c.id = a.class_id
            WHERE st.id = ai_review_allowance_reservations_v1.attempt_id
              AND LOWER(st.teacher_email) = LOWER(?)
              AND st.semantic_key = ai_review_allowance_reservations_v1.semantic_key
              AND LOWER(c.owner_email) = LOWER(?)
              AND s.deleted_at IS NULL
              AND a.deleted_at IS NULL
              AND c.deleted_at IS NULL
          )
        )
      )`,
    args: [
      input.attemptId,
      input.now,
      input.now,
      input.reservationId,
      input.teacherEmail,
      input.attemptId,
      input.teacherEmail,
      allowance.allowanceKind,
      allowance.scopeKey,
      input.teacherEmail,
      input.teacherEmail,
    ],
  });
  return toNumber(result.rowsAffected) === 1;
}

function rowToStripeWebhookEvent(row: Row): StripeWebhookEventRow {
  return {
    eventId: toStringValue(row.eventId),
    eventType: toStringValue(row.eventType),
    stripeEventCreated: toNumber(row.stripeEventCreated),
    processedAt: toNumber(row.processedAt),
  };
}

export async function getProcessedStripeWebhookEvent(
  eventId: string
): Promise<StripeWebhookEventRow | null> {
  const normalizedEventId = requireTrimmedValue("eventId", eventId);
  const result = await query(
    `SELECT
      event_id as eventId,
      event_type as eventType,
      stripe_event_created as stripeEventCreated,
      processed_at as processedAt
    FROM stripe_webhook_events
    WHERE event_id = ?
    LIMIT 1`,
    [normalizedEventId]
  );
  return result.rows[0] ? rowToStripeWebhookEvent(result.rows[0]) : null;
}

export async function hasProcessedStripeWebhookEvent(eventId: string): Promise<boolean> {
  return (await getProcessedStripeWebhookEvent(eventId)) !== null;
}

/** Call only after the webhook's business effects have completed successfully. */
export async function recordProcessedStripeWebhookEvent(input: {
  eventId: string;
  eventType: string;
  stripeEventCreated: number;
  processedAt?: number;
}): Promise<boolean> {
  const eventId = requireTrimmedValue("eventId", input.eventId);
  const eventType = requireTrimmedValue("eventType", input.eventType);
  const stripeEventCreated = requireNonNegativeInteger(
    "stripeEventCreated",
    input.stripeEventCreated
  );
  const processedAt = requireNonNegativeInteger("processedAt", input.processedAt ?? Date.now());
  const result = await query(
    `INSERT INTO stripe_webhook_events (
      event_id, event_type, stripe_event_created, processed_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING`,
    [eventId, eventType, stripeEventCreated, processedAt]
  );
  return toNumber(result.rowsAffected) === 1;
}

/**
 * Atomically records a verified Stripe event and its safe notification intents.
 * Call only after the event's idempotent local business projection succeeds.
 */
export async function recordProcessedStripeWebhookEventWithAdminAlerts(input: {
  eventId: string;
  eventType: string;
  stripeEventCreated: number;
  processedAt?: number;
  alerts: readonly AdminAlertOutboxInsert[];
}): Promise<{ recorded: boolean; insertedAlertCount: number }> {
  const eventId = requireTrimmedValue("eventId", input.eventId);
  const eventType = requireTrimmedValue("eventType", input.eventType);
  const stripeEventCreated = requireNonNegativeInteger(
    "stripeEventCreated",
    input.stripeEventCreated,
  );
  const processedAt = requireNonNegativeInteger("processedAt", input.processedAt ?? Date.now());
  if (input.alerts.length > 20) {
    throw new RangeError("At most 20 admin alerts can accompany one Stripe event.");
  }
  const alerts = input.alerts.map(normalizeAdminAlertOutboxInsert);
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const marker = await transaction.execute({
      sql: `INSERT INTO stripe_webhook_events (
        event_id, event_type, stripe_event_created, processed_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING`,
      args: [eventId, eventType, stripeEventCreated, processedAt],
    });
    if (toNumber(marker.rowsAffected) !== 1) {
      await transaction.commit();
      return { recorded: false, insertedAlertCount: 0 };
    }
    let insertedAlertCount = 0;
    for (const alert of alerts) {
      const result = await transaction.execute({
        sql: `INSERT INTO admin_alert_outbox (
          id,
          dedupe_key,
          event_type,
          destination,
          safe_payload_json,
          environment,
          status,
          attempt_count,
          next_attempt_at,
          created_at,
          delivered_at,
          last_error_code,
          lease_token,
          lease_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, '', '', 0)
        ON CONFLICT(dedupe_key) DO NOTHING`,
        args: [
          alert.id,
          alert.dedupeKey,
          alert.eventType,
          alert.destination,
          alert.safePayloadJson,
          alert.environment,
          alert.nextAttemptAt,
          alert.createdAt,
        ],
      });
      const inserted = toNumber(result.rowsAffected);
      insertedAlertCount += inserted;
      if (inserted === 0) {
        const existing = await transaction.execute({
          sql: `${ADMIN_ALERT_OUTBOX_SELECT} WHERE dedupe_key = ? LIMIT 1`,
          args: [alert.dedupeKey],
        });
        const row = existing.rows[0];
        if (!row) throw new Error("Admin alert outbox conflict could not be verified.");
        const stored = rowToAdminAlertOutbox(row);
        if (
          stored.eventType !== alert.eventType
          || stored.destination !== alert.destination
          || stored.environment !== alert.environment
        ) {
          throw new Error("Admin alert outbox dedupe conflict.");
        }
      }
    }
    await transaction.commit();
    return { recorded: true, insertedAlertCount };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function countQualifyingAiBillingClasses(teacherEmail: string): Promise<number> {
  const normalized = normalizeBillingTeacherEmail(teacherEmail);
  const result = await query(
    `SELECT COUNT(*) as qualifyingClassCount
    FROM classes c
    WHERE LOWER(c.owner_email) = LOWER(?)
      AND c.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM roster r WHERE r.class_id = c.id
      )
      AND EXISTS (
        SELECT 1
        FROM assignments a
        WHERE a.class_id = c.id
          AND a.deleted_at IS NULL
      )`,
    [normalized]
  );
  return Math.min(
    toNumber(result.rows[0]?.qualifyingClassCount),
    LEGACY_METERED_MAX_QUALIFYING_CLASSES,
  );
}

export type StripeBillingStorageHealth = {
  ready: boolean;
  legacyCreditPeriods: number;
  legacyUsageRows: number;
  legacyV2CreditPeriods: number;
  legacyV2UsageRows: number;
  unscopedAccounts: number;
  unscopedBillingMarkers: number;
  unscopedV3UsageRows: number;
};

/**
 * Legacy billing rows have no trustworthy catalog or Stripe-mode scope. They
 * remain untouched for audit, but billing must stay fail-closed until an
 * operator reconciles them explicitly.
 */
export async function getStripeBillingStorageHealth(): Promise<StripeBillingStorageHealth> {
  const result = await query(
    `SELECT
      (SELECT COUNT(*) FROM ai_billing_credit_periods) as legacyCreditPeriods,
      (SELECT COUNT(*) FROM ai_billing_usage) as legacyUsageRows,
      (SELECT COUNT(*) FROM ai_billing_credit_periods_v2) as legacyV2CreditPeriods,
      (SELECT COUNT(*) FROM ai_billing_usage_v2) as legacyV2UsageRows,
      (
        SELECT COUNT(*) FROM stripe_billing_accounts
        WHERE TRIM(stripe_account_id) = '' OR TRIM(billing_contract_id) = ''
      ) as unscopedAccounts,
      (
        SELECT COUNT(*) FROM ai_grading_attempts
        WHERE billing_required = 1 AND TRIM(billing_contract_id) = ''
      ) as unscopedBillingMarkers,
      (
        SELECT COUNT(*) FROM ai_billing_usage_v3
        WHERE TRIM(billing_contract_id) = ''
      ) as unscopedV3UsageRows`,
  );
  const legacyCreditPeriods = toNumber(result.rows[0]?.legacyCreditPeriods);
  const legacyUsageRows = toNumber(result.rows[0]?.legacyUsageRows);
  const legacyV2CreditPeriods = toNumber(result.rows[0]?.legacyV2CreditPeriods);
  const legacyV2UsageRows = toNumber(result.rows[0]?.legacyV2UsageRows);
  const unscopedAccounts = toNumber(result.rows[0]?.unscopedAccounts);
  const unscopedBillingMarkers = toNumber(result.rows[0]?.unscopedBillingMarkers);
  const unscopedV3UsageRows = toNumber(result.rows[0]?.unscopedV3UsageRows);
  return {
    ready:
      legacyCreditPeriods === 0 &&
      legacyUsageRows === 0 &&
      legacyV2CreditPeriods === 0 &&
      legacyV2UsageRows === 0 &&
      unscopedAccounts === 0 &&
      unscopedBillingMarkers === 0 &&
      unscopedV3UsageRows === 0,
    legacyCreditPeriods,
    legacyUsageRows,
    legacyV2CreditPeriods,
    legacyV2UsageRows,
    unscopedAccounts,
    unscopedBillingMarkers,
    unscopedV3UsageRows,
  };
}

export async function isStripeBillingStorageReady() {
  return (await getStripeBillingStorageHealth()).ready;
}

function rowToAiBillingCreditPeriod(row: Row): AiBillingCreditPeriodRow {
  return {
    teacherEmail: toStringValue(row.teacherEmail),
    billingMonth: toStringValue(row.billingMonth),
    priceBookId: toStringValue(row.priceBookId),
    catalogFingerprint: toStringValue(row.catalogFingerprint),
    livemode: toNumber(row.livemode) === 1,
    qualifyingClassHighWater: toNumber(row.qualifyingClassHighWater),
    usedCredits: toNumber(row.usedCredits),
    createdAt: toNumber(row.createdAt),
    updatedAt: toNumber(row.updatedAt),
  };
}

export async function getAiBillingCreditPeriod(
  teacherEmail: string,
  billingMonth: string,
  scope: AiBillingScope,
): Promise<AiBillingCreditPeriodRow | null> {
  const normalized = normalizeBillingTeacherEmail(teacherEmail);
  const month = normalizeBillingMonth(billingMonth);
  const normalizedScope = normalizeAiBillingScope(scope);
  const result = await query(
    `SELECT
      teacher_email as teacherEmail,
      billing_month as billingMonth,
      price_book_id as priceBookId,
      catalog_fingerprint as catalogFingerprint,
      livemode as livemode,
      qualifying_class_high_water as qualifyingClassHighWater,
      used_credits as usedCredits,
      created_at as createdAt,
      updated_at as updatedAt
    FROM ai_billing_credit_periods_v3
    WHERE teacher_email = ?
      AND billing_month = ?
      AND price_book_id = ?
      AND catalog_fingerprint = ?
      AND livemode = ?
    LIMIT 1`,
    [
      normalized,
      month,
      normalizedScope.priceBookId,
      normalizedScope.catalogFingerprint,
      normalizedScope.livemode ? 1 : 0,
    ],
  );
  return result.rows[0] ? rowToAiBillingCreditPeriod(result.rows[0]) : null;
}

function normalizeAiBillingUsageStatus(value: unknown): AiBillingUsageStatus {
  const status = toStringValue(value);
  if (status === "credited" || status === "reported" || status === "failed") return status;
  return "pending";
}

function normalizeAiBillingUsageDimension(value: unknown): AiBillingUsageDimension | null {
  const dimension = toStringValue(value);
  return dimension === "base" || dimension === "audio" ? dimension : null;
}

function rowToAiBillingUsage(row: Row): AiBillingUsageRow {
  return {
    id: toStringValue(row.id),
    teacherEmail: toStringValue(row.teacherEmail),
    billingMonth: toStringValue(row.billingMonth),
    cacheKey: toStringValue(row.cacheKey),
    priceBookId: toStringValue(row.priceBookId),
    attemptId: toStringValue(row.attemptId),
    submissionId: toStringValue(row.submissionId),
    stripeCustomerId: toStringValue(row.stripeCustomerId),
    stripeSubscriptionId: toStringValue(row.stripeSubscriptionId),
    catalogFingerprint: toStringValue(row.catalogFingerprint),
    billingContractId: toStringValue(row.billingContractId),
    livemode: toNumber(row.livemode) === 1,
    freeCreditApplied: toNumber(row.freeCreditApplied) === 1,
    baseUnits: toNumber(row.baseUnits),
    durationSeconds: toNumber(row.durationSeconds),
    outputTokens: toNumber(row.outputTokens),
    baseAttemptedAt: toNullableNumber(row.baseAttemptedAt),
    audioAttemptedAt: toNullableNumber(row.audioAttemptedAt),
    outputAttemptedAt: toNullableNumber(row.outputAttemptedAt),
    baseReportedAt: toNullableNumber(row.baseReportedAt),
    audioReportedAt: toNullableNumber(row.audioReportedAt),
    outputReportedAt: toNullableNumber(row.outputReportedAt),
    status: normalizeAiBillingUsageStatus(row.status),
    lastErrorDimension: normalizeAiBillingUsageDimension(row.lastErrorDimension),
    lastError: toStringValue(row.lastError),
    lastFailedAt: toNullableNumber(row.lastFailedAt),
    createdAt: toNumber(row.createdAt),
    updatedAt: toNumber(row.updatedAt),
  };
}

const AI_BILLING_USAGE_SELECT = `SELECT
  id as id,
  teacher_email as teacherEmail,
  billing_month as billingMonth,
  cache_key as cacheKey,
  price_book_id as priceBookId,
  attempt_id as attemptId,
  submission_id as submissionId,
  stripe_customer_id as stripeCustomerId,
  stripe_subscription_id as stripeSubscriptionId,
  catalog_fingerprint as catalogFingerprint,
  billing_contract_id as billingContractId,
  livemode as livemode,
  free_credit_applied as freeCreditApplied,
  base_units as baseUnits,
  duration_seconds as durationSeconds,
  output_tokens as outputTokens,
  base_attempted_at as baseAttemptedAt,
  audio_attempted_at as audioAttemptedAt,
  output_attempted_at as outputAttemptedAt,
  base_reported_at as baseReportedAt,
  audio_reported_at as audioReportedAt,
  output_reported_at as outputReportedAt,
  status as status,
  last_error_dimension as lastErrorDimension,
  last_error as lastError,
  last_failed_at as lastFailedAt,
  created_at as createdAt,
  updated_at as updatedAt
FROM ai_billing_usage_v3`;

/**
 * Materializes one semantic result from its immutable delivery-time marker.
 * Credit assignment was already reserved atomically with grade finalization;
 * outbox creation only copies that decision and can safely be replayed.
 */
export async function createAiBillingUsage(input: {
  teacherEmail: string;
  cacheKey: string;
  priceBookId: string;
  attemptId: string;
  submissionId: string;
  baseUnits?: number;
  durationSeconds: number;
  outputTokens: number;
  livemode?: boolean;
  occurredAt?: number;
  now?: number;
}): Promise<AiBillingUsageRow | null> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const cacheKey = requireTrimmedValue("cacheKey", input.cacheKey);
  const priceBookId = requireTrimmedValue("priceBookId", input.priceBookId);
  const attemptId = requireTrimmedValue("attemptId", input.attemptId);
  const submissionId = requireTrimmedValue("submissionId", input.submissionId);
  // Retain validation for the existing call contract, but never use caller
  // quantities as the billing source of truth. A marked successful result is
  // exactly one base unit, and the durable attempt owns its variable units.
  requireNonNegativeInteger("baseUnits", input.baseUnits ?? 1);
  requireNonNegativeFiniteNumber("durationSeconds", input.durationSeconds);
  requireNonNegativeInteger("outputTokens", input.outputTokens);
  const livemode = input.livemode === true;
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const requestedOccurredAt =
    input.occurredAt === undefined
      ? null
      : requireNonNegativeInteger("occurredAt", input.occurredAt);
  if (!(await isStripeBillingStorageReady())) {
    throw new Error(
      "Legacy unscoped Stripe billing rows require manual reconciliation before usage can be recorded.",
    );
  }
  const occurrence = await query(
    `SELECT
      COALESCE(completed_at, created_at) as occurredAt,
      billing_contract_id as billingContractId,
      billing_livemode as billingLivemode
    FROM ai_grading_attempts
    WHERE id = ?
      AND submission_id = ?
      AND LOWER(teacher_email) = LOWER(?)
      AND cache_key = ?
      AND billing_price_book_id = ?
      AND status = 'completed'
      AND delivery_status = 'delivered'
      AND billing_required = 1
    LIMIT 1`,
    [attemptId, submissionId, teacherEmail, cacheKey, priceBookId]
  );
  if (!occurrence.rows[0]) return null;
  const occurredAt = toNumber(occurrence.rows[0].occurredAt);
  const billingContractId = requireTrimmedValue(
    "billingContractId",
    toStringValue(occurrence.rows[0].billingContractId),
  );
  if ((toNumber(occurrence.rows[0].billingLivemode) === 1) !== livemode) return null;
  if (requestedOccurredAt !== null && requestedOccurredAt !== occurredAt) return null;
  const billingMonth = getAiBillingUtcMonth(occurredAt);
  const [billingYear, billingMonthNumber] = billingMonth.split("-").map(Number);
  const billingMonthStart = Date.UTC(billingYear, billingMonthNumber - 1, 1);
  const billingMonthEnd = Date.UTC(billingYear, billingMonthNumber, 1);
  const id = makeId("aiu");

  const results = await writeBatch([
    {
      sql: `INSERT INTO ai_billing_credit_periods_v3 (
        teacher_email, billing_month, price_book_id, catalog_fingerprint,
        livemode, qualifying_class_high_water,
        used_credits, created_at, updated_at
      )
      SELECT
        ?, ?, ?, ?, ?, ag.billing_qualifying_class_high_water,
        (
          SELECT COUNT(*)
          FROM ai_grading_attempts reserved
          WHERE LOWER(reserved.teacher_email) = LOWER(?)
            AND reserved.billing_required = 1
            AND reserved.billing_price_book_id = ?
            AND reserved.billing_catalog_fingerprint = ?
            AND reserved.billing_livemode = ?
            AND reserved.billing_free_credit_applied = 1
            AND COALESCE(reserved.completed_at, reserved.created_at) >= ?
            AND COALESCE(reserved.completed_at, reserved.created_at) < ?
        ),
        ?, ?
      FROM ai_grading_attempts ag
      WHERE ag.id = ?
        AND ag.submission_id = ?
        AND LOWER(ag.teacher_email) = LOWER(?)
        AND ag.cache_key = ?
        AND ag.billing_required = 1
        AND ag.billing_price_book_id = ?
        AND ag.billing_catalog_fingerprint = ?
        AND ag.billing_stripe_customer_id <> ''
        AND ag.billing_stripe_subscription_id <> ''
        AND ag.billing_livemode = ?
      ON CONFLICT(
        teacher_email,
        billing_month,
        price_book_id,
        catalog_fingerprint,
        livemode
      ) DO UPDATE SET
        qualifying_class_high_water = MAX(
          ai_billing_credit_periods_v3.qualifying_class_high_water,
          excluded.qualifying_class_high_water
        ),
        used_credits = MAX(
          ai_billing_credit_periods_v3.used_credits,
          excluded.used_credits
        ),
        updated_at = excluded.updated_at`,
      args: [
        teacherEmail,
        billingMonth,
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        livemode ? 1 : 0,
        teacherEmail,
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        livemode ? 1 : 0,
        billingMonthStart,
        billingMonthEnd,
        now,
        now,
        attemptId,
        submissionId,
        teacherEmail,
        cacheKey,
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        livemode ? 1 : 0,
      ],
    },
    {
      sql: `INSERT INTO ai_billing_usage_v3 (
        id, teacher_email, billing_month, cache_key, price_book_id,
        attempt_id, submission_id, stripe_customer_id,
        stripe_subscription_id, catalog_fingerprint, billing_contract_id, livemode,
        free_credit_applied, base_units,
        duration_seconds, output_tokens, base_reported_at, audio_reported_at,
        output_reported_at, status, last_error_dimension, last_error,
        last_failed_at, created_at, updated_at
      )
      SELECT
        ?, ?, ?, ?, ?, ?, ?,
        ag.billing_stripe_customer_id,
        ag.billing_stripe_subscription_id,
        ag.billing_catalog_fingerprint,
        ag.billing_contract_id,
        ag.billing_livemode,
        ag.billing_free_credit_applied,
        1,
        MAX(
          0,
          CAST(ag.duration_seconds AS INTEGER) +
            CASE
              WHEN ag.duration_seconds > CAST(ag.duration_seconds AS INTEGER) THEN 1
              ELSE 0
            END
        ),
        ag.billable_output_tokens,
        NULL, NULL, NULL,
        CASE WHEN ag.billing_free_credit_applied = 1 THEN 'credited' ELSE 'pending' END,
        NULL, '', NULL, ?, ?
      FROM ai_billing_credit_periods_v3 p
      JOIN submissions s ON s.id = ?
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      JOIN ai_grading_attempts ag ON ag.id = ?
      WHERE p.teacher_email = ?
        AND p.billing_month = ?
        AND p.price_book_id = ?
        AND p.catalog_fingerprint = ?
        AND p.livemode = ?
        AND LOWER(c.owner_email) = LOWER(?)
        AND s.submitted_at <= ?
        AND (s.deleted_at IS NULL OR s.deleted_at >= ?)
        AND a.created_at <= ?
        AND (a.deleted_at IS NULL OR a.deleted_at >= ?)
        AND c.created_at <= ?
        AND (c.deleted_at IS NULL OR c.deleted_at >= ?)
        AND ag.submission_id = s.id
        AND LOWER(ag.teacher_email) = LOWER(?)
        AND ag.status = 'completed'
        AND ag.cache_key = ?
        AND ag.billing_required = 1
        AND ag.billing_price_book_id = ?
        AND ag.billing_catalog_fingerprint = ?
        AND ag.billing_contract_id = ?
        AND ag.billing_stripe_customer_id <> ''
        AND ag.billing_stripe_subscription_id <> ''
        AND ag.billing_livemode = ?
      ON CONFLICT(
        teacher_email,
        cache_key,
        price_book_id,
        catalog_fingerprint,
        livemode
      ) DO NOTHING`,
      args: [
        id,
        teacherEmail,
        billingMonth,
        cacheKey,
        priceBookId,
        attemptId,
        submissionId,
        occurredAt,
        now,
        submissionId,
        attemptId,
        teacherEmail,
        billingMonth,
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        livemode ? 1 : 0,
        teacherEmail,
        occurredAt,
        occurredAt,
        occurredAt,
        occurredAt,
        occurredAt,
        occurredAt,
        teacherEmail,
        cacheKey,
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        billingContractId,
        livemode ? 1 : 0,
      ],
    },
    {
      sql: `${AI_BILLING_USAGE_SELECT}
      WHERE teacher_email = ?
        AND cache_key = ?
        AND price_book_id = ?
        AND catalog_fingerprint = ?
        AND livemode = ?
      LIMIT 1`,
      args: [
        teacherEmail,
        cacheKey,
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        livemode ? 1 : 0,
      ],
    },
  ]);

  const row = results[2]?.rows[0];
  return row ? rowToAiBillingUsage(row) : null;
}

export async function getAiBillingUsageById(id: string): Promise<AiBillingUsageRow | null> {
  const normalizedId = requireTrimmedValue("id", id);
  const result = await query(
    `${AI_BILLING_USAGE_SELECT}
    WHERE id = ?
    LIMIT 1`,
    [normalizedId]
  );
  return result.rows[0] ? rowToAiBillingUsage(result.rows[0]) : null;
}

export async function listPendingAiBillingUsage(
  limit = 100,
  livemode?: boolean,
  now = Date.now(),
  billingContractId?: string,
): Promise<AiBillingUsageRow[]> {
  const safeLimit = Math.max(1, Math.min(requireNonNegativeInteger("limit", limit), 500));
  const safeNow = requireNonNegativeInteger("now", now);
  const supportedSince = getStripeAutomaticUsageRecoverySupportedSince(safeNow);
  const normalizedContractId = billingContractId?.trim();
  const result = await query(
    `${AI_BILLING_USAGE_SELECT}
    WHERE free_credit_applied = 0
      AND price_book_id = ?
      AND catalog_fingerprint = ?
      AND stripe_customer_id <> ''
      AND stripe_subscription_id <> ''
      AND status IN ('pending', 'failed')
      ${livemode === undefined ? "" : "AND livemode = ?"}
      ${normalizedContractId ? "AND billing_contract_id = ?" : ""}
      AND created_at >= ?
      AND (
        (base_units > 0 AND base_reported_at IS NULL AND base_attempted_at IS NULL)
        OR (duration_seconds > 0 AND audio_reported_at IS NULL AND audio_attempted_at IS NULL)
      )
    ORDER BY created_at ASC, id ASC
    LIMIT ?`,
    [
      TEACHER_AI_PRICE_BOOK.id,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      ...(livemode === undefined ? [] : [livemode ? 1 : 0]),
      ...(normalizedContractId ? [normalizedContractId] : []),
      supportedSince,
      safeLimit,
    ]
  );
  return result.rows.map(rowToAiBillingUsage);
}

const AI_BILLING_DIMENSION_COLUMNS: Record<
  AiBillingUsageDimension,
  {
    quantity: "base_units" | "duration_seconds" | "output_tokens";
    attemptedAt: "base_attempted_at" | "audio_attempted_at" | "output_attempted_at";
    reportedAt: "base_reported_at" | "audio_reported_at" | "output_reported_at";
  }
> = {
  base: {
    quantity: "base_units",
    attemptedAt: "base_attempted_at",
    reportedAt: "base_reported_at",
  },
  audio: {
    quantity: "duration_seconds",
    attemptedAt: "audio_attempted_at",
    reportedAt: "audio_reported_at",
  },
};

function requireAiBillingDimension(value: AiBillingUsageDimension) {
  if (value !== "base" && value !== "audio") {
    throw new Error("dimension must be base or audio.");
  }
  return value;
}

/**
 * Atomically claims one external meter-event delivery. Claims are intentionally
 * never reset automatically: after a crash or network error, delivery is
 * ambiguous and must be reconciled rather than blindly retried after Stripe's
 * rolling identifier-deduplication window.
 */
export async function claimAiBillingUsageDimensionForDelivery(input: {
  usageId: string;
  dimension: AiBillingUsageDimension;
  attemptedAt?: number;
}): Promise<{ usage: AiBillingUsageRow | null; claimed: boolean }> {
  const usageId = requireTrimmedValue("usageId", input.usageId);
  const dimension = requireAiBillingDimension(input.dimension);
  const attemptedAt = requireNonNegativeInteger("attemptedAt", input.attemptedAt ?? Date.now());
  const columns = AI_BILLING_DIMENSION_COLUMNS[dimension];
  const results = await writeBatch([
    {
      sql: `UPDATE ai_billing_usage_v3
      SET ${columns.attemptedAt} = ?,
          updated_at = ?
      WHERE id = ?
        AND free_credit_applied = 0
        AND ${columns.quantity} > 0
        AND ${columns.reportedAt} IS NULL
        AND ${columns.attemptedAt} IS NULL`,
      args: [attemptedAt, attemptedAt, usageId],
    },
    {
      sql: `${AI_BILLING_USAGE_SELECT} WHERE id = ? LIMIT 1`,
      args: [usageId],
    },
  ]);
  const row = results[1]?.rows[0];
  return {
    usage: row ? rowToAiBillingUsage(row) : null,
    claimed: toNumber(results[0]?.rowsAffected) > 0,
  };
}

export async function markAiBillingUsageDimensionReported(input: {
  usageId: string;
  dimension: AiBillingUsageDimension;
  reportedAt?: number;
}): Promise<AiBillingUsageRow | null> {
  const usageId = requireTrimmedValue("usageId", input.usageId);
  const dimension = requireAiBillingDimension(input.dimension);
  const reportedAt = requireNonNegativeInteger("reportedAt", input.reportedAt ?? Date.now());
  const columns = AI_BILLING_DIMENSION_COLUMNS[dimension];
  const results = await writeBatch([
    {
      sql: `UPDATE ai_billing_usage_v3
      SET ${columns.reportedAt} = COALESCE(${columns.reportedAt}, ?),
          last_error_dimension = CASE
            WHEN last_error_dimension = ? THEN NULL ELSE last_error_dimension
          END,
          last_error = CASE
            WHEN last_error_dimension = ? THEN '' ELSE last_error
          END,
          last_failed_at = CASE
            WHEN last_error_dimension = ? THEN NULL ELSE last_failed_at
          END,
          updated_at = ?
      WHERE id = ?
        AND free_credit_applied = 0
        AND ${columns.quantity} > 0`,
      args: [reportedAt, dimension, dimension, dimension, reportedAt, usageId],
    },
    {
      sql: `UPDATE ai_billing_usage_v3
      SET status = CASE
            WHEN (base_units = 0 OR base_reported_at IS NOT NULL)
              AND (duration_seconds = 0 OR audio_reported_at IS NOT NULL)
            THEN 'reported'
            WHEN last_error <> '' THEN 'failed'
            ELSE 'pending'
          END,
          updated_at = ?
      WHERE id = ?
        AND free_credit_applied = 0`,
      args: [reportedAt, usageId],
    },
    {
      sql: `${AI_BILLING_USAGE_SELECT} WHERE id = ? LIMIT 1`,
      args: [usageId],
    },
  ]);
  const row = results[2]?.rows[0];
  return row ? rowToAiBillingUsage(row) : null;
}

export async function markAiBillingUsageDimensionFailed(input: {
  usageId: string;
  dimension: AiBillingUsageDimension;
  error: string;
  failedAt?: number;
}): Promise<AiBillingUsageRow | null> {
  const usageId = requireTrimmedValue("usageId", input.usageId);
  const dimension = requireAiBillingDimension(input.dimension);
  const error = requireTrimmedValue("error", input.error).slice(0, 1_000);
  const failedAt = requireNonNegativeInteger("failedAt", input.failedAt ?? Date.now());
  const columns = AI_BILLING_DIMENSION_COLUMNS[dimension];
  const results = await writeBatch([
    {
      sql: `UPDATE ai_billing_usage_v3
      SET status = 'failed',
          last_error_dimension = ?,
          last_error = ?,
          last_failed_at = ?,
          updated_at = ?
      WHERE id = ?
        AND free_credit_applied = 0
        AND ${columns.quantity} > 0
        AND ${columns.attemptedAt} IS NOT NULL
        AND ${columns.reportedAt} IS NULL`,
      args: [dimension, error, failedAt, failedAt, usageId],
    },
    {
      sql: `${AI_BILLING_USAGE_SELECT} WHERE id = ? LIMIT 1`,
      args: [usageId],
    },
  ]);
  const row = results[1]?.rows[0];
  return row ? rowToAiBillingUsage(row) : null;
}

export async function getAiBillingMonthlySummary(
  teacherEmail: string,
  billingMonth: string,
  scope: AiBillingScope,
): Promise<AiBillingMonthlySummary> {
  const normalized = normalizeBillingTeacherEmail(teacherEmail);
  const month = normalizeBillingMonth(billingMonth);
  const normalizedScope = normalizeAiBillingScope(scope);
  const result = await query(
    `SELECT
      COALESCE((
        SELECT qualifying_class_high_water
        FROM ai_billing_credit_periods_v3
        WHERE teacher_email = ?
          AND billing_month = ?
          AND price_book_id = ?
          AND catalog_fingerprint = ?
          AND livemode = ?
      ), 0) as qualifyingClassHighWater,
      COALESCE((
        SELECT used_credits
        FROM ai_billing_credit_periods_v3
        WHERE teacher_email = ?
          AND billing_month = ?
          AND price_book_id = ?
          AND catalog_fingerprint = ?
          AND livemode = ?
      ), 0) as usedCredits,
      COUNT(*) as successfulResults,
      COALESCE(SUM(CASE WHEN free_credit_applied = 1 THEN 1 ELSE 0 END), 0) as freeCreditResults,
      COALESCE(SUM(CASE WHEN free_credit_applied = 0 THEN 1 ELSE 0 END), 0) as billableResults,
      COALESCE(SUM(CASE WHEN free_credit_applied = 0 THEN base_units ELSE 0 END), 0) as billableBaseUnits,
      COALESCE(SUM(CASE WHEN free_credit_applied = 0 THEN duration_seconds ELSE 0 END), 0) as billableDurationSeconds,
      COALESCE(SUM(CASE WHEN free_credit_applied = 0 THEN output_tokens ELSE 0 END), 0) as billableOutputTokens,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pendingResults,
      COALESCE(SUM(CASE WHEN status = 'reported' THEN 1 ELSE 0 END), 0) as reportedResults,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failedResults
    FROM ai_billing_usage_v3
    WHERE teacher_email = ?
      AND billing_month = ?
      AND price_book_id = ?
      AND catalog_fingerprint = ?
      AND billing_contract_id = ?
      AND livemode = ?`,
    [
      normalized,
      month,
      normalizedScope.priceBookId,
      normalizedScope.catalogFingerprint,
      normalizedScope.livemode ? 1 : 0,
      normalized,
      month,
      normalizedScope.priceBookId,
      normalizedScope.catalogFingerprint,
      normalizedScope.livemode ? 1 : 0,
      normalized,
      month,
      normalizedScope.priceBookId,
      normalizedScope.catalogFingerprint,
      normalizedScope.billingContractId,
      normalizedScope.livemode ? 1 : 0,
    ],
  );
  const row = result.rows[0];
  const qualifyingClassHighWater = Math.min(
    toNumber(row?.qualifyingClassHighWater),
    LEGACY_METERED_MAX_QUALIFYING_CLASSES,
  );
  const earnedCredits = Math.max(0, qualifyingClassHighWater - 1);
  const usedCredits = toNumber(row?.usedCredits);
  return {
    teacherEmail: normalized,
    billingMonth: month,
    qualifyingClassHighWater,
    earnedCredits,
    usedCredits,
    remainingCredits: Math.max(0, earnedCredits - usedCredits),
    successfulResults: toNumber(row?.successfulResults),
    freeCreditResults: toNumber(row?.freeCreditResults),
    billableResults: toNumber(row?.billableResults),
    billableBaseUnits: toNumber(row?.billableBaseUnits),
    billableDurationSeconds: toNumber(row?.billableDurationSeconds),
    billableOutputTokens: toNumber(row?.billableOutputTokens),
    pendingResults: toNumber(row?.pendingResults),
    reportedResults: toNumber(row?.reportedResults),
    failedResults: toNumber(row?.failedResults),
  };
}

export type SubmissionForAiGradeRow = {
  submissionId: string;
  assignmentId: string;
  assignmentTitle: string;
  audioBlobUrl: string;
  description: string;
  instructions: string;
  targetLanguage?: string;
  rubric: Rubric | null;
  maxPoints: number;
  finalGrade: number | null;
  finalGradeSource?: "teacher" | "ai";
  finalFeedback: string;
};

/**
 * Submissions in one assignment that a bulk AI run should touch: still
 * ungraded, still present, and actually holding audio. Ordered oldest first so
 * a partial run works through the backlog in the order students submitted.
 */
export async function listUngradedSubmissionsForAiGrade(
  assignmentId: string,
  ownerEmail: string
): Promise<
  Array<
    SubmissionForAiGradeRow & {
      studentName: string;
      hasPersistedTranscript: boolean;
      consumedTranscriptFingerprints: string[];
      completedAttemptFingerprints: string[];
    }
  >
> {
  const result = await query(
    `SELECT
      s.id as submissionId,
      s.student_name as studentName,
      a.id as assignmentId,
      a.title as assignmentTitle,
      COALESCE(s.audio_blob_url, s.audio_data, '') as audioBlobUrl,
      COALESCE(a.description, '') as description,
      a.instructions as instructions,
      COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as targetLanguage,
      a.rubric as rubric,
      a.max_points as maxPoints,
      s.grade as finalGrade,
      COALESCE(s.feedback, '') as finalFeedback,
      EXISTS (
        SELECT 1
        FROM submission_transcripts st
        WHERE st.submission_id = s.id
          AND LOWER(st.teacher_email) = LOWER(?)
          AND TRIM(st.transcript) <> ''
      ) as hasPersistedTranscript,
      COALESCE((
        SELECT GROUP_CONCAT(DISTINCT st.assignment_fingerprint)
        FROM submission_transcripts st
        JOIN ai_review_allowance_reservations_v1 reservation
          ON LOWER(reservation.teacher_email) = LOWER(st.teacher_email)
          AND reservation.semantic_key = st.semantic_key
          AND reservation.status = 'consumed'
        WHERE st.submission_id = s.id
          AND LOWER(st.teacher_email) = LOWER(?)
          AND TRIM(st.transcript) <> ''
          AND TRIM(st.assignment_fingerprint) <> ''
      ), '') as consumedTranscriptFingerprints,
      COALESCE((
        SELECT GROUP_CONCAT(DISTINCT ag.assignment_fingerprint)
        FROM ai_grading_attempts ag
        WHERE ag.submission_id = s.id
          AND LOWER(ag.teacher_email) = LOWER(?)
          AND ag.status = 'completed'
          AND ag.delivery_status IN ('delivered', 'not_applicable')
          AND TRIM(ag.assignment_fingerprint) <> ''
      ), '') as completedAttemptFingerprints
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ?
      AND s.grade IS NULL
      AND TRIM(COALESCE(s.feedback, '')) = ''
      AND s.rubric_scores IS NULL
      AND COALESCE(s.audio_blob_url, s.audio_data, '') <> ''
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND LOWER(c.owner_email) = LOWER(?)
    ORDER BY s.submitted_at ASC, s.id ASC`,
    [ownerEmail, ownerEmail, ownerEmail, assignmentId, ownerEmail]
  );
  return result.rows.map((row) => ({
    submissionId: toStringValue(row.submissionId),
    studentName: toStringValue(row.studentName),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    targetLanguage: toStringValue(row.targetLanguage) || "Spanish",
    rubric: parseJsonValue<Rubric>(row.rubric),
    maxPoints: toNumber(row.maxPoints),
    finalGrade: toNullableNumber(row.finalGrade),
    finalFeedback: toStringValue(row.finalFeedback),
    hasPersistedTranscript: toNumber(row.hasPersistedTranscript) === 1,
    consumedTranscriptFingerprints: toStringValue(row.consumedTranscriptFingerprints)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    completedAttemptFingerprints: toStringValue(row.completedAttemptFingerprints)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  }));
}

export async function findSubmissionForAiGrade(
  submissionId: string,
  ownerEmail: string
): Promise<SubmissionForAiGradeRow | null> {
  const result = await query(
    `SELECT
      s.id as submissionId,
      a.id as assignmentId,
      a.title as assignmentTitle,
      COALESCE(s.audio_blob_url, s.audio_data, '') as audioBlobUrl,
      COALESCE(a.description, '') as description,
      a.instructions as instructions,
      COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as targetLanguage,
      a.rubric as rubric,
      a.max_points as maxPoints,
      s.grade as finalGrade,
      s.grade_source as finalGradeSource,
      COALESCE(s.feedback, '') as finalFeedback
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND s.grade IS NULL
      AND TRIM(COALESCE(s.feedback, '')) = ''
      AND s.rubric_scores IS NULL
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND LOWER(c.owner_email) = LOWER(?)
    LIMIT 1`,
    [submissionId, ownerEmail]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    submissionId: toStringValue(row.submissionId),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    targetLanguage: toStringValue(row.targetLanguage) || "Spanish",
    rubric: parseJsonValue<Rubric>(row.rubric),
    maxPoints: toNumber(row.maxPoints),
    finalGrade: toNullableNumber(row.finalGrade),
    finalGradeSource: toStringValue(row.finalGradeSource) === "ai" ? "ai" : "teacher",
    finalFeedback: toStringValue(row.finalFeedback),
  };
}

function rowToAiAttempt(row: Row): AiGradingAttemptRow {
  return {
    id: toStringValue(row.id),
    submissionId: toStringValue(row.submissionId),
    teacherEmail: toStringValue(row.teacherEmail),
    status: toStringValue(row.status) === "failed" ? "failed" : "completed",
    deliveryStatus: ["delivered", "withheld", "not_applicable"].includes(
      toStringValue(row.deliveryStatus),
    )
      ? (toStringValue(row.deliveryStatus) as AiGradingAttemptDeliveryStatus)
      : "pending",
    transcript: toStringValue(row.transcript),
    detectedLanguage: toStringValue(row.detectedLanguage),
    transcriptQuality: toStringValue(row.transcriptQuality),
    durationSeconds: toNumber(row.durationSeconds),
    suggestedScore: toNullableNumber(row.suggestedScore),
    rubricScores: parseJsonValue<RubricScore[]>(row.rubricScores) ?? [],
    feedback: toStringValue(row.feedback),
    strengths: parseJsonValue<string[]>(row.strengths) ?? [],
    improvements: parseJsonValue<string[]>(row.improvements) ?? [],
    evidence: parseJsonValue<string[]>(row.evidence) ?? [],
    confidence: ["high", "medium", "low"].includes(toStringValue(row.confidence))
      ? (toStringValue(row.confidence) as "high" | "medium" | "low")
      : "low",
    warnings: parseJsonValue<string[]>(row.warnings) ?? [],
    teacherAttention: toStringValue(row.teacherAttention),
    transcriptionProvider: toStringValue(row.transcriptionProvider),
    gradingProvider: toStringValue(row.gradingProvider),
    transcriptionModel: toStringValue(row.transcriptionModel),
    gradingModel: toStringValue(row.gradingModel),
    errorCode: toStringValue(row.errorCode),
    errorMessage: toStringValue(row.errorMessage),
    cacheKey: toStringValue(row.cacheKey),
    assignmentFingerprint: toStringValue(row.assignmentFingerprint),
    cacheHit: toNumber(row.cacheHit) === 1,
    inputTokens: toNumber(row.inputTokens),
    cachedInputTokens: toNumber(row.cachedInputTokens),
    outputTokens: toNumber(row.outputTokens),
    latencyMs: toNumber(row.latencyMs),
    retries: toNumber(row.retries),
    escalated: toNumber(row.escalated) === 1,
    escalationReason: toStringValue(row.escalationReason),
    estimatedCostMicrousd: toNumber(row.estimatedCostMicrousd),
    promptVersion: toStringValue(row.promptVersion),
    resultSource: toStringValue(row.resultSource) || "ai",
    billingRequired: toNumber(row.billingRequired) === 1,
    billingPriceBookId: toStringValue(row.billingPriceBookId),
    billingStripeCustomerId: toStringValue(row.billingStripeCustomerId),
    billingStripeSubscriptionId: toStringValue(row.billingStripeSubscriptionId),
    billingCatalogFingerprint: toStringValue(row.billingCatalogFingerprint),
    billingContractId: toStringValue(row.billingContractId),
    billingLivemode: toNumber(row.billingLivemode) === 1,
    billingQualifyingClassHighWater: toNumber(row.billingQualifyingClassHighWater),
    billingFreeCreditApplied: toNumber(row.billingFreeCreditApplied) === 1,
    billableOutputTokens: toNumber(row.billableOutputTokens),
    createdAt: toNumber(row.createdAt),
    completedAt: toNullableNumber(row.completedAt),
  };
}

export async function createAiGradingAttempt(input: {
  submissionId: string;
  teacherEmail: string;
  status: AiGradingAttemptStatus;
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: string;
  durationSeconds: number;
  suggestedScore: number | null;
  rubricScores: RubricScore[];
  feedback: string;
  strengths: string[];
  improvements: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
  teacherAttention: string;
  transcriptionProvider: string;
  gradingProvider: string;
  transcriptionModel: string;
  gradingModel: string;
  errorCode?: string;
  errorMessage?: string;
  cacheKey?: string;
  assignmentFingerprint?: string;
  cacheHit?: boolean;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  retries?: number;
  escalated?: boolean;
  escalationReason?: string;
  estimatedCostMicrousd?: number;
  promptVersion?: string;
  resultSource?: string;
  billingRequired?: boolean;
  billingPriceBookId?: string;
  billableOutputTokens?: number;
}): Promise<AiGradingAttemptRow> {
  const billingPriceBookId = input.billingPriceBookId?.trim() ?? "";
  // Billing identity and credit assignment must be committed atomically with
  // grade delivery. Attempt creation therefore never manufactures a marker;
  // finalizeAiGradeDelivery (or the guarded post-apply compatibility helper)
  // owns that transition.
  const billingRequired = false;
  const billingQualifyingClassHighWater = 0;
  const deliveryStatus: AiGradingAttemptDeliveryStatus =
    input.status === "failed" ? "not_applicable" : "pending";
  const item = {
    ...input,
    id: makeId("ai"),
    createdAt: Date.now(),
    completedAt: Date.now(),
    errorCode: input.errorCode ?? "",
    errorMessage: input.errorMessage ?? "",
    cacheKey: input.cacheKey ?? "",
    assignmentFingerprint: input.assignmentFingerprint?.trim() ?? "",
    cacheHit: input.cacheHit ?? false,
    inputTokens: toNonNegativeInteger(input.inputTokens),
    cachedInputTokens: toNonNegativeInteger(input.cachedInputTokens),
    outputTokens: toNonNegativeInteger(input.outputTokens),
    latencyMs: toNonNegativeInteger(input.latencyMs),
    retries: toNonNegativeInteger(input.retries),
    escalated: input.escalated ?? false,
    escalationReason: input.escalationReason ?? "",
    estimatedCostMicrousd: toNonNegativeInteger(input.estimatedCostMicrousd),
    promptVersion: input.promptVersion ?? "",
    resultSource: input.resultSource ?? "ai",
    deliveryStatus,
    billingRequired,
    billingPriceBookId,
    billingStripeCustomerId: "",
    billingStripeSubscriptionId: "",
    billingCatalogFingerprint: "",
    billingContractId: "",
    billingLivemode: false,
    billingQualifyingClassHighWater,
    billingFreeCreditApplied: false,
    billableOutputTokens: toNonNegativeInteger(input.billableOutputTokens),
  };
  await query(
    `INSERT INTO ai_grading_attempts (
      id, submission_id, teacher_email, status, delivery_status, transcript, detected_language,
      transcript_quality, duration_seconds, suggested_score, rubric_scores,
      feedback, strengths, improvements, evidence, confidence, warnings,
      teacher_attention, transcription_provider, grading_provider,
      transcription_model, grading_model, error_code, error_message,
      cache_key, assignment_fingerprint, cache_hit, input_tokens,
      cached_input_tokens, output_tokens,
      latency_ms, retries, escalated, escalation_reason, estimated_cost_microusd,
      prompt_version, result_source, billing_required, billing_price_book_id,
      billing_stripe_customer_id, billing_stripe_subscription_id,
      billing_catalog_fingerprint, billing_contract_id, billing_livemode,
      billing_qualifying_class_high_water, billing_free_credit_applied,
      billable_output_tokens,
      created_at, completed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
    [
      item.id,
      item.submissionId,
      item.teacherEmail.toLowerCase(),
      item.status,
      item.deliveryStatus,
      item.transcript,
      item.detectedLanguage,
      item.transcriptQuality,
      item.durationSeconds,
      item.suggestedScore,
      stringifyJsonValue(item.rubricScores),
      item.feedback,
      stringifyJsonValue(item.strengths),
      stringifyJsonValue(item.improvements),
      stringifyJsonValue(item.evidence),
      item.confidence,
      stringifyJsonValue(item.warnings),
      item.teacherAttention,
      item.transcriptionProvider,
      item.gradingProvider,
      item.transcriptionModel,
      item.gradingModel,
      item.errorCode ?? "",
      item.errorMessage ?? "",
      item.cacheKey,
      item.assignmentFingerprint,
      item.cacheHit ? 1 : 0,
      item.inputTokens,
      item.cachedInputTokens,
      item.outputTokens,
      item.latencyMs,
      item.retries,
      item.escalated ? 1 : 0,
      item.escalationReason,
      item.estimatedCostMicrousd,
      item.promptVersion,
      item.resultSource,
      item.billingRequired ? 1 : 0,
      item.billingPriceBookId,
      item.billingStripeCustomerId,
      item.billingStripeSubscriptionId,
      item.billingCatalogFingerprint,
      item.billingContractId,
      item.billingLivemode ? 1 : 0,
      item.billingQualifyingClassHighWater,
      item.billingFreeCreditApplied ? 1 : 0,
      item.billableOutputTokens,
      item.createdAt,
      item.completedAt,
    ]
  );
  return {
    ...item,
    errorCode: item.errorCode ?? "",
    errorMessage: item.errorMessage ?? "",
  };
}

/**
 * Owner-scoped lookup used only to resolve an idempotent retry after an AI
 * grade was already delivered. Callers must not send a graded row to a
 * provider; gradeOneSubmission enforces that boundary again after hashing.
 */
export async function findOwnedSubmissionForAiReview(
  submissionId: string,
  ownerEmail: string,
): Promise<SubmissionForAiGradeRow | null> {
  const result = await query(
    `SELECT
      s.id as submissionId,
      a.id as assignmentId,
      a.title as assignmentTitle,
      COALESCE(s.audio_blob_url, s.audio_data, '') as audioBlobUrl,
      COALESCE(a.description, '') as description,
      a.instructions as instructions,
      COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as targetLanguage,
      a.rubric as rubric,
      a.max_points as maxPoints,
      s.grade as finalGrade,
      s.grade_source as finalGradeSource,
      COALESCE(s.feedback, '') as finalFeedback
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND LOWER(c.owner_email) = LOWER(?)
    LIMIT 1`,
    [submissionId, ownerEmail],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    submissionId: toStringValue(row.submissionId),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
    description: toStringValue(row.description),
    instructions: toStringValue(row.instructions),
    targetLanguage: toStringValue(row.targetLanguage) || "Spanish",
    rubric: parseJsonValue<Rubric>(row.rubric),
    maxPoints: toNumber(row.maxPoints),
    finalGrade: toNullableNumber(row.finalGrade),
    finalGradeSource: toStringValue(row.finalGradeSource) === "ai" ? "ai" : "teacher",
    finalFeedback: toStringValue(row.finalFeedback),
  };
}

const MAX_PERSISTED_TRANSCRIPT_CHARS = 100_000;

function normalizePersistedTranscript(value: string) {
  const transcript = requireTrimmedValue("transcript", value);
  if (transcript.length > MAX_PERSISTED_TRANSCRIPT_CHARS) {
    throw new RangeError("Transcript is too long to persist.");
  }
  return transcript;
}

function rowToSubmissionTranscript(row: Row): SubmissionTranscriptRow {
  return {
    id: toStringValue(row.id),
    submissionId: toStringValue(row.submissionId),
    teacherEmail: toStringValue(row.teacherEmail),
    semanticKey: toStringValue(row.semanticKey),
    assignmentFingerprint: toStringValue(row.assignmentFingerprint),
    transcriptCacheKey: toStringValue(row.transcriptCacheKey),
    transcript: toStringValue(row.transcript),
    detectedLanguage: toStringValue(row.detectedLanguage),
    transcriptQuality: toStringValue(row.transcriptQuality),
    durationSeconds: toNumber(row.durationSeconds),
    transcriptionProvider: toStringValue(row.transcriptionProvider),
    transcriptionModel: toStringValue(row.transcriptionModel),
    estimatedCostMicrousd: toNumber(row.estimatedCostMicrousd),
    latencyMs: toNumber(row.latencyMs),
    createdAt: toNumber(row.createdAt),
    updatedAt: toNumber(row.updatedAt),
  };
}

const SUBMISSION_TRANSCRIPT_SELECT = `SELECT
  st.id as id,
  st.submission_id as submissionId,
  st.teacher_email as teacherEmail,
  st.semantic_key as semanticKey,
  st.assignment_fingerprint as assignmentFingerprint,
  st.transcript_cache_key as transcriptCacheKey,
  st.transcript as transcript,
  st.detected_language as detectedLanguage,
  st.transcript_quality as transcriptQuality,
  st.duration_seconds as durationSeconds,
  st.transcription_provider as transcriptionProvider,
  st.transcription_model as transcriptionModel,
  st.estimated_cost_microusd as estimatedCostMicrousd,
  st.latency_ms as latencyMs,
  st.created_at as createdAt,
  st.updated_at as updatedAt
FROM submission_transcripts st
JOIN submissions s ON s.id = st.submission_id
JOIN assignments a ON a.id = s.assignment_id
JOIN classes c ON c.id = a.class_id`;

export async function findSubmissionTranscriptForOwner(
  submissionId: string,
  ownerEmail: string,
): Promise<SubmissionTranscriptRow | null> {
  const result = await query(
    `${SUBMISSION_TRANSCRIPT_SELECT}
    WHERE st.submission_id = ?
      AND LOWER(st.teacher_email) = LOWER(?)
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY st.updated_at DESC, st.created_at DESC, st.id DESC
    LIMIT 1`,
    [submissionId, ownerEmail, ownerEmail],
  );
  return result.rows[0] ? rowToSubmissionTranscript(result.rows[0]) : null;
}

export async function findSubmissionTranscriptByIdForOwner(
  transcriptId: string,
  ownerEmail: string,
): Promise<SubmissionTranscriptRow | null> {
  const result = await query(
    `${SUBMISSION_TRANSCRIPT_SELECT}
    WHERE st.id = ?
      AND LOWER(st.teacher_email) = LOWER(?)
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    [transcriptId, ownerEmail, ownerEmail],
  );
  return result.rows[0] ? rowToSubmissionTranscript(result.rows[0]) : null;
}

export async function findSubmissionTranscriptForOwnerBySemanticKey(
  submissionId: string,
  semanticKey: string,
  ownerEmail: string,
): Promise<SubmissionTranscriptRow | null> {
  const result = await query(
    `${SUBMISSION_TRANSCRIPT_SELECT}
    WHERE st.submission_id = ?
      AND st.semantic_key = ?
      AND LOWER(st.teacher_email) = LOWER(?)
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    [submissionId, semanticKey, ownerEmail, ownerEmail],
  );
  return result.rows[0] ? rowToSubmissionTranscript(result.rows[0]) : null;
}

type PersistedTranscriptInput = {
  submissionId: string;
  teacherEmail: string;
  semanticKey: string;
  assignmentFingerprint: string;
  transcriptCacheKey?: string;
  transcript: string;
  detectedLanguage: string;
  transcriptQuality: string;
  durationSeconds: number;
  transcriptionProvider: string;
  transcriptionModel: string;
  estimatedCostMicrousd?: number;
  latencyMs?: number;
};

function assignmentFingerprintFromAttemptDeliveryRow(row: Row) {
  return processedAssignmentFingerprint(
    legacyAssignmentToGradingAssignment({
      submissionId: toStringValue(row.submissionId),
      assignmentId: toStringValue(row.assignmentId),
      assignmentTitle: toStringValue(row.assignmentTitle),
      audioBlobUrl: "",
      description: toStringValue(row.assignmentDescription),
      instructions: toStringValue(row.assignmentInstructions),
      targetLanguage: toStringValue(row.assignmentTargetLanguage) || "Spanish",
      rubric: parseJsonValue<Rubric>(row.assignmentRubric),
      maxPoints: toNumber(row.assignmentMaxPoints),
      finalGrade: null,
      finalFeedback: "",
    }),
  );
}

async function upsertSubmissionTranscriptInTransaction(input: {
  transaction: Transaction;
  transcriptId: string;
  now: number;
  value: PersistedTranscriptInput;
}) {
  const value = input.value;
  const result = await input.transaction.execute({
    sql: `INSERT INTO submission_transcripts (
      id, submission_id, teacher_email, semantic_key, assignment_fingerprint,
      transcript_cache_key,
      transcript, detected_language, transcript_quality, duration_seconds,
      transcription_provider, transcription_model, estimated_cost_microusd,
      latency_ms, created_at, updated_at
    )
    SELECT ?, s.id, LOWER(c.owner_email), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ON CONFLICT(submission_id, semantic_key) DO UPDATE SET
      id = submission_transcripts.id`,
    args: [
      input.transcriptId,
      value.semanticKey,
      requireTrimmedValue("assignmentFingerprint", value.assignmentFingerprint),
      value.transcriptCacheKey ?? "",
      normalizePersistedTranscript(value.transcript),
      value.detectedLanguage.trim(),
      value.transcriptQuality.trim(),
      toNonNegativeInteger(value.durationSeconds),
      requireTrimmedValue("transcriptionProvider", value.transcriptionProvider),
      requireTrimmedValue("transcriptionModel", value.transcriptionModel),
      toNonNegativeInteger(value.estimatedCostMicrousd),
      toNonNegativeInteger(value.latencyMs),
      input.now,
      input.now,
      value.submissionId,
      normalizeBillingTeacherEmail(value.teacherEmail),
    ],
  });
  return toNumber(result.rowsAffected) === 1;
}

/**
 * Makes a standalone transcript visible and consumes its single 30/300 unit in
 * one transaction. Provider work may happen before this call, but a failed
 * allowance transition never leaves a readable transcript row behind.
 */
export async function finalizeSubmissionTranscriptDelivery(input: {
  reservationId: string;
  value: PersistedTranscriptInput;
  now?: number;
}): Promise<SubmissionTranscriptRow | null> {
  const reservationId = requireTrimmedValue("reservationId", input.reservationId);
  const teacherEmail = normalizeBillingTeacherEmail(input.value.teacherEmail);
  const semanticKey = requireTrimmedValue("semanticKey", input.value.semanticKey);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const readyStripeScope = await getReadyStripeSubscriptionScope();
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const existing = await transaction.execute({
      sql: `SELECT id FROM submission_transcripts
      WHERE submission_id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND semantic_key = ?
      LIMIT 1`,
      args: [input.value.submissionId, teacherEmail, semanticKey],
    });
    const transcriptId = toStringValue(existing.rows[0]?.id).trim() || makeId("tr");
    const saved = await upsertSubmissionTranscriptInTransaction({
      transaction,
      transcriptId,
      now,
      value: { ...input.value, teacherEmail, semanticKey },
    });
    if (!saved) {
      await transaction.rollback();
      return null;
    }
    const allowance = await resolveAiReviewAllowanceInTransaction({
      transaction,
      teacherEmail,
      readyStripeScope,
      now,
    });
    if (!allowance.allowanceKind) {
      await transaction.rollback();
      return null;
    }
    const consumed = await transaction.execute({
      sql: `UPDATE ai_review_allowance_reservations_v1
      SET status = 'consumed', attempt_id = ?, source_kind = 'transcript',
          updated_at = ?, consumed_at = ?, released_at = NULL
      WHERE id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND semantic_key = ?
        AND status = 'reserved'
        AND allowance_kind = ?
        AND scope_key = ?`,
      args: [
        transcriptId,
        now,
        now,
        reservationId,
        teacherEmail,
        semanticKey,
        allowance.allowanceKind,
        allowance.scopeKey,
      ],
    });
    if (toNumber(consumed.rowsAffected) !== 1) {
      await transaction.rollback();
      return null;
    }
    await transaction.commit();
    return await findSubmissionTranscriptByIdForOwner(transcriptId, teacherEmail);
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

/** Persists a transcript for an explicitly unmetered deployment path. */
export async function saveUnmeteredSubmissionTranscript(input: {
  value: PersistedTranscriptInput;
  now?: number;
}): Promise<SubmissionTranscriptRow | null> {
  const teacherEmail = normalizeBillingTeacherEmail(input.value.teacherEmail);
  const semanticKey = requireTrimmedValue("semanticKey", input.value.semanticKey);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const existing = await transaction.execute({
      sql: `SELECT id FROM submission_transcripts
      WHERE submission_id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND semantic_key = ?
      LIMIT 1`,
      args: [input.value.submissionId, teacherEmail, semanticKey],
    });
    const transcriptId = toStringValue(existing.rows[0]?.id).trim() || makeId("tr");
    const saved = await upsertSubmissionTranscriptInTransaction({
      transaction,
      transcriptId,
      now,
      value: { ...input.value, teacherEmail, semanticKey },
    });
    if (!saved) {
      await transaction.rollback();
      return null;
    }
    await transaction.commit();
    return await findSubmissionTranscriptByIdForOwner(transcriptId, teacherEmail);
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

/** Copies a transcript from an exact consumed result without using another unit. */
export async function copyConsumedReviewTranscriptToSubmission(input: {
  reservationId: string;
  sourceResultId: string;
  sourceKind: AiReviewSourceKind;
  submissionId: string;
  teacherEmail: string;
  semanticKey: string;
  assignmentFingerprint: string;
  now?: number;
}): Promise<SubmissionTranscriptRow | null> {
  const reservationId = requireTrimmedValue("reservationId", input.reservationId);
  const sourceResultId = requireTrimmedValue("sourceResultId", input.sourceResultId);
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const semanticKey = requireTrimmedValue("semanticKey", input.semanticKey);
  const assignmentFingerprint = requireTrimmedValue(
    "assignmentFingerprint",
    input.assignmentFingerprint,
  );
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const reservation = await transaction.execute({
      sql: `SELECT source_kind as sourceKind, attempt_id as sourceResultId
      FROM ai_review_allowance_reservations_v1
      WHERE id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND semantic_key = ?
        AND status = 'consumed'
      LIMIT 1`,
      args: [reservationId, teacherEmail, semanticKey],
    });
    const reservedSource = reservation.rows[0];
    const storedKind: AiReviewSourceKind =
      toStringValue(reservedSource?.sourceKind) === "transcript" ? "transcript" : "grading";
    if (
      !reservedSource ||
      storedKind !== input.sourceKind ||
      toStringValue(reservedSource.sourceResultId) !== sourceResultId
    ) {
      await transaction.rollback();
      return null;
    }

    const source = input.sourceKind === "transcript"
      ? await transaction.execute({
          sql: `SELECT
            st.assignment_fingerprint as assignmentFingerprint,
            st.transcript_cache_key as transcriptCacheKey,
            st.transcript as transcript,
            st.detected_language as detectedLanguage,
            st.transcript_quality as transcriptQuality,
            st.duration_seconds as durationSeconds,
            st.transcription_provider as transcriptionProvider,
            st.transcription_model as transcriptionModel,
            st.estimated_cost_microusd as estimatedCostMicrousd,
            st.latency_ms as latencyMs
          FROM submission_transcripts st
          JOIN submissions s ON s.id = st.submission_id
          JOIN assignments a ON a.id = s.assignment_id
          JOIN classes c ON c.id = a.class_id
          WHERE st.id = ?
            AND LOWER(st.teacher_email) = LOWER(?)
            AND st.semantic_key = ?
            AND LOWER(c.owner_email) = LOWER(?)
            AND s.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND c.deleted_at IS NULL
          LIMIT 1`,
          args: [sourceResultId, teacherEmail, semanticKey, teacherEmail],
        })
      : await transaction.execute({
          sql: `SELECT
            ag.assignment_fingerprint as assignmentFingerprint,
            '' as transcriptCacheKey,
            ag.transcript as transcript,
            ag.detected_language as detectedLanguage,
            ag.transcript_quality as transcriptQuality,
            ag.duration_seconds as durationSeconds,
            ag.transcription_provider as transcriptionProvider,
            ag.transcription_model as transcriptionModel,
            ag.estimated_cost_microusd as estimatedCostMicrousd,
            ag.latency_ms as latencyMs
          FROM ai_grading_attempts ag
          JOIN submissions s ON s.id = ag.submission_id
          JOIN assignments a ON a.id = s.assignment_id
          JOIN classes c ON c.id = a.class_id
          WHERE ag.id = ?
            AND LOWER(ag.teacher_email) = LOWER(?)
            AND ag.cache_key = ?
            AND ag.status = 'completed'
            AND ag.delivery_status IN ('delivered', 'not_applicable')
            AND TRIM(ag.transcript) <> ''
            AND LOWER(c.owner_email) = LOWER(?)
            AND s.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND c.deleted_at IS NULL
          LIMIT 1`,
          args: [sourceResultId, teacherEmail, semanticKey, teacherEmail],
        });
    const sourceRow = source.rows[0];
    if (!sourceRow) {
      await transaction.rollback();
      return null;
    }
    const existing = await transaction.execute({
      sql: `SELECT id FROM submission_transcripts
      WHERE submission_id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND semantic_key = ?
      LIMIT 1`,
      args: [input.submissionId, teacherEmail, semanticKey],
    });
    const transcriptId = toStringValue(existing.rows[0]?.id).trim() || makeId("tr");
    const saved = await upsertSubmissionTranscriptInTransaction({
      transaction,
      transcriptId,
      now,
      value: {
        submissionId: input.submissionId,
        teacherEmail,
        semanticKey,
        assignmentFingerprint:
          toStringValue(sourceRow.assignmentFingerprint).trim() || assignmentFingerprint,
        transcriptCacheKey: toStringValue(sourceRow.transcriptCacheKey),
        transcript: toStringValue(sourceRow.transcript),
        detectedLanguage: toStringValue(sourceRow.detectedLanguage),
        transcriptQuality: toStringValue(sourceRow.transcriptQuality),
        durationSeconds: toNumber(sourceRow.durationSeconds),
        transcriptionProvider: toStringValue(sourceRow.transcriptionProvider),
        transcriptionModel: toStringValue(sourceRow.transcriptionModel),
        estimatedCostMicrousd: toNumber(sourceRow.estimatedCostMicrousd),
        latencyMs: toNumber(sourceRow.latencyMs),
      },
    });
    if (!saved) {
      await transaction.rollback();
      return null;
    }
    await transaction.commit();
    return await findSubmissionTranscriptByIdForOwner(transcriptId, teacherEmail);
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function markAiGradingAttemptNotApplicable(input: {
  attemptId: string;
  ownerEmail: string;
  reviewReservationId?: string;
}): Promise<boolean> {
  const attemptId = requireTrimmedValue("attemptId", input.attemptId);
  const ownerEmail = normalizeBillingTeacherEmail(input.ownerEmail);
  const reviewReservationId = input.reviewReservationId?.trim() || null;
  const readyStripeScope = reviewReservationId
    ? await getReadyStripeSubscriptionScope()
    : null;
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const attemptResult = await transaction.execute({
      sql: `SELECT
        ag.submission_id as submissionId,
        ag.assignment_fingerprint as assignmentFingerprint,
        a.id as assignmentId,
        a.title as assignmentTitle,
        COALESCE(a.description, '') as assignmentDescription,
        a.instructions as assignmentInstructions,
        COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as assignmentTargetLanguage,
        COALESCE(a.max_points, 100) as assignmentMaxPoints,
        a.rubric as assignmentRubric
      FROM ai_grading_attempts ag
      JOIN submissions s ON s.id = ag.submission_id
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE ag.id = ?
        AND LOWER(ag.teacher_email) = LOWER(?)
        AND ag.status = 'completed'
        AND ag.delivery_status = 'pending'
        AND ag.billing_required = 0
        AND s.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND LOWER(c.owner_email) = LOWER(?)
      LIMIT 1`,
      args: [attemptId, ownerEmail, ownerEmail],
    });
    const attempt = attemptResult.rows[0];
    if (
      !attempt ||
      !toStringValue(attempt.assignmentFingerprint).trim() ||
      toStringValue(attempt.assignmentFingerprint).trim() !==
        assignmentFingerprintFromAttemptDeliveryRow(attempt)
    ) {
      await transaction.rollback();
      return false;
    }
    const result = await transaction.execute({
      sql: `UPDATE ai_grading_attempts
      SET delivery_status = 'not_applicable'
      WHERE id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND status = 'completed'
        AND delivery_status = 'pending'
        AND billing_required = 0
        AND EXISTS (
          SELECT 1
          FROM submissions s
          JOIN assignments a ON a.id = s.assignment_id
          JOIN classes c ON c.id = a.class_id
          WHERE s.id = ai_grading_attempts.submission_id
            AND s.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND c.deleted_at IS NULL
            AND LOWER(c.owner_email) = LOWER(?)
        )`,
      args: [attemptId, ownerEmail, ownerEmail],
    });
    if (toNumber(result.rowsAffected) !== 1) {
      await transaction.rollback();
      return false;
    }
    if (reviewReservationId) {
      const consumed = await consumeAiReviewReservationInTransaction({
        transaction,
        reservationId: reviewReservationId,
        teacherEmail: ownerEmail,
        attemptId,
        readyStripeScope,
        now: Date.now(),
      });
      if (!consumed) {
        await transaction.rollback();
        return false;
      }
    }
    await transaction.commit();
    return true;
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

/**
 * Makes a result permanently non-public when grade/billing finalization loses
 * its atomic guard. Pending and withheld attempts are excluded from all public
 * attempt reads, so even a cleanup failure cannot expose an unfinalized result.
 */
export async function withholdAiGradingAttemptResult(input: {
  attemptId: string;
  ownerEmail: string;
  reason: string;
}): Promise<boolean> {
  const attemptId = requireTrimmedValue("attemptId", input.attemptId);
  const ownerEmail = normalizeBillingTeacherEmail(input.ownerEmail);
  const reason = requireTrimmedValue("reason", input.reason).slice(0, 120);
  const result = await query(
    `UPDATE ai_grading_attempts
    SET status = 'failed',
        delivery_status = 'withheld',
        transcript = '',
        detected_language = '',
        transcript_quality = '',
        suggested_score = NULL,
        rubric_scores = '[]',
        feedback = '',
        strengths = '[]',
        improvements = '[]',
        evidence = '[]',
        confidence = 'low',
        warnings = '[]',
        teacher_attention = 'unable_to_grade',
        error_code = 'result_not_delivered',
        error_message = ?,
        result_source = 'withheld'
    WHERE id = ?
      AND LOWER(teacher_email) = LOWER(?)
      AND delivery_status = 'pending'
      AND billing_required = 0
      AND EXISTS (
        SELECT 1
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.id = ai_grading_attempts.submission_id
          AND LOWER(c.owner_email) = LOWER(?)
      )`,
    [reason, attemptId, ownerEmail, ownerEmail],
  );
  return toNumber(result.rowsAffected) === 1;
}

/**
 * Durably marks a completed, delivered AI result for billing after its grade
 * has been applied. Every entitlement and ownership predicate is part of the
 * same update so a stale pre-check cannot make an inactive or foreign result
 * billable.
 */
export async function markAiGradingAttemptBillingRequired(input: {
  attemptId: string;
  ownerEmail: string;
  priceBookId: string;
}): Promise<boolean> {
  const attemptId = requireTrimmedValue("attemptId", input.attemptId);
  const ownerEmail = requireTrimmedValue("ownerEmail", input.ownerEmail).toLowerCase();
  const priceBookId = requireTrimmedValue("priceBookId", input.priceBookId);
  const stripeUsageScope =
    priceBookId === TEACHER_AI_PRICE_BOOK.id
      ? await getReadyStripeUsageScope()
      : null;
  if (!stripeUsageScope) return false;
  const livemode = stripeUsageScope.keyMode === "live";
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  async function rollbackResult(result: boolean) {
    if (!transaction.closed) await transaction.rollback();
    return result;
  }
  try {
    const existing = await transaction.execute({
      sql: `SELECT 1
      FROM ai_grading_attempts
      WHERE id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND billing_required = 1
        AND billing_price_book_id = ?
        AND billing_catalog_fingerprint = ?
        AND billing_contract_id = ?
        AND billing_stripe_customer_id <> ''
        AND billing_stripe_subscription_id <> ''
      LIMIT 1`,
      args: [
        attemptId,
        ownerEmail,
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        stripeUsageScope.billingContractId,
      ],
    });
    if (existing.rows.length === 1) return await rollbackResult(true);

    const candidateResult = await transaction.execute({
      sql: `SELECT
        ag.cache_key as cacheKey,
        COALESCE(ag.completed_at, ag.created_at) as occurredAt,
        sba.stripe_customer_id as stripeCustomerId,
        sba.stripe_subscription_id as stripeSubscriptionId
      FROM ai_grading_attempts ag
      JOIN submissions s ON s.id = ag.submission_id
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      JOIN stripe_billing_accounts sba
        ON LOWER(sba.teacher_email) = LOWER(ag.teacher_email)
      WHERE ag.id = ?
        AND LOWER(ag.teacher_email) = LOWER(?)
        AND ag.billing_required = 0
        AND ag.billing_stripe_customer_id = ''
        AND ag.billing_stripe_subscription_id = ''
        AND ag.billing_catalog_fingerprint = ''
        AND ag.status = 'completed'
        AND ag.delivery_status = 'pending'
        AND TRIM(ag.cache_key) <> ''
        AND ag.suggested_score IS NOT NULL
        AND TRIM(ag.error_code) = ''
        AND ag.result_source NOT IN ('deterministic', 'failed', 'teacher_review', 'withheld')
        AND ag.confidence = 'high'
        AND s.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND LOWER(c.owner_email) = LOWER(?)
        AND s.grade_source = 'ai'
        AND s.grade = ag.suggested_score
        AND sba.subscription_status = 'active'
        AND sba.price_book_id = ?
        AND sba.catalog_fingerprint = ?
        AND sba.stripe_account_id = ?
        AND sba.billing_contract_id = ?
        AND sba.livemode = ?
        AND sba.stripe_customer_id <> ''
        AND sba.stripe_subscription_id IS NOT NULL
        AND sba.stripe_subscription_id <> ''
      LIMIT 1`,
      args: [
        attemptId,
        ownerEmail,
        ownerEmail,
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        stripeUsageScope.accountId,
        stripeUsageScope.billingContractId,
        livemode ? 1 : 0,
      ],
    });
    const candidate = candidateResult.rows[0];
    if (!candidate) return await rollbackResult(false);

    const duplicateResult = await transaction.execute({
      sql: `SELECT 1
      WHERE EXISTS (
        SELECT 1
        FROM ai_grading_attempts prior
        WHERE prior.id <> ?
          AND LOWER(prior.teacher_email) = LOWER(?)
          AND prior.cache_key = ?
          AND prior.billing_required = 1
          AND prior.billing_price_book_id = ?
          AND prior.billing_catalog_fingerprint = ?
          AND prior.billing_livemode = ?
      ) OR EXISTS (
        SELECT 1
        FROM ai_billing_usage_v3 usage
        WHERE LOWER(usage.teacher_email) = LOWER(?)
          AND usage.cache_key = ?
          AND usage.price_book_id = ?
          AND usage.catalog_fingerprint = ?
          AND usage.livemode = ?
      )
      LIMIT 1`,
      args: [
        attemptId,
        ownerEmail,
        toStringValue(candidate.cacheKey),
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        livemode ? 1 : 0,
        ownerEmail,
        toStringValue(candidate.cacheKey),
        priceBookId,
        STRIPE_CATALOG_MANIFEST.fingerprint,
        livemode ? 1 : 0,
      ],
    });
    if (duplicateResult.rows.length > 0) {
      const delivered = await transaction.execute({
        sql: `UPDATE ai_grading_attempts
        SET delivery_status = 'delivered'
        WHERE id = ?
          AND LOWER(teacher_email) = LOWER(?)
          AND status = 'completed'
          AND delivery_status = 'pending'
          AND billing_required = 0`,
        args: [attemptId, ownerEmail],
      });
      if (toNumber(delivered.rowsAffected) !== 1) return await rollbackResult(false);
      await transaction.commit();
      return false;
    }

    const markerNow = Date.now();
    const creditReservation = await reserveAiBillingCreditInTransaction({
      transaction,
      teacherEmail: ownerEmail,
      billingMonth: getAiBillingUtcMonth(toNumber(candidate.occurredAt)),
      priceBookId,
      catalogFingerprint: STRIPE_CATALOG_MANIFEST.fingerprint,
      livemode,
      now: markerNow,
    });
    const markerResult = await transaction.execute({
      sql: `UPDATE ai_grading_attempts
      SET billing_required = 1,
          delivery_status = 'delivered',
          billing_price_book_id = ?,
          billing_stripe_customer_id = ?,
          billing_stripe_subscription_id = ?,
          billing_catalog_fingerprint = ?,
          billing_contract_id = ?,
          billing_livemode = ?,
          billing_qualifying_class_high_water = ?,
          billing_free_credit_applied = ?
      WHERE id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND billing_required = 0
        AND delivery_status = 'pending'
        AND billing_stripe_customer_id = ''
        AND billing_stripe_subscription_id = ''
        AND billing_catalog_fingerprint = ''`,
      args: [
        priceBookId,
        toStringValue(candidate.stripeCustomerId),
        toStringValue(candidate.stripeSubscriptionId),
        STRIPE_CATALOG_MANIFEST.fingerprint,
        stripeUsageScope.billingContractId,
        livemode ? 1 : 0,
        creditReservation.qualifyingClassHighWater,
        creditReservation.freeCreditApplied ? 1 : 0,
        attemptId,
        ownerEmail,
      ],
    });
    if (toNumber(markerResult.rowsAffected) !== 1) {
      return await rollbackResult(false);
    }
    await transaction.commit();
    return true;
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

/**
 * Finds supported-window, subscribed-at-delivery attempts whose durable billing
 * marker has not produced a semantic usage row yet. This closes the gap if the
 * process stops after saving a grade but before creating its Stripe outbox row.
 */
export async function listUnqueuedAiBillingAttempts(
  priceBookId: string,
  limit = 100,
  now = Date.now(),
  livemode?: boolean,
  billingContractId?: string,
): Promise<UnqueuedAiBillingAttemptRow[]> {
  const normalizedPriceBookId = requireTrimmedValue("priceBookId", priceBookId);
  const safeLimit = Math.max(1, Math.min(requireNonNegativeInteger("limit", limit), 500));
  const safeNow = requireNonNegativeInteger("now", now);
  const supportedSince = getStripeAutomaticUsageRecoverySupportedSince(safeNow);
  const normalizedContractId = billingContractId?.trim();
  const result = await query(
    `SELECT
      ag.id as attemptId,
      ag.teacher_email as teacherEmail,
      ag.cache_key as cacheKey,
      ag.billing_price_book_id as priceBookId,
      ag.submission_id as submissionId,
      ag.duration_seconds as durationSeconds,
      ag.billable_output_tokens as outputTokens,
      ag.billing_livemode as livemode,
      ag.billing_contract_id as billingContractId,
      COALESCE(ag.completed_at, ag.created_at) as occurredAt
    FROM ai_grading_attempts ag
    WHERE ag.status = 'completed'
      AND ag.billing_required = 1
      AND ag.billing_price_book_id = ?
      AND ag.billing_catalog_fingerprint = ?
      AND ag.billing_stripe_customer_id <> ''
      AND ag.billing_stripe_subscription_id <> ''
      ${livemode === undefined ? "" : "AND ag.billing_livemode = ?"}
      ${normalizedContractId ? "AND ag.billing_contract_id = ?" : ""}
      AND ag.cache_key <> ''
      AND (
        ag.billing_free_credit_applied = 1
        OR COALESCE(ag.completed_at, ag.created_at) >= ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ai_billing_usage_v3 u
        WHERE LOWER(u.teacher_email) = LOWER(ag.teacher_email)
          AND u.cache_key = ag.cache_key
          AND u.price_book_id = ag.billing_price_book_id
          AND u.catalog_fingerprint = ag.billing_catalog_fingerprint
          AND u.livemode = ag.billing_livemode
      )
    ORDER BY COALESCE(ag.completed_at, ag.created_at) ASC, ag.id ASC
    LIMIT ?`,
    [
      normalizedPriceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      ...(livemode === undefined ? [] : [livemode ? 1 : 0]),
      ...(normalizedContractId ? [normalizedContractId] : []),
      supportedSince,
      safeLimit,
    ]
  );
  return result.rows.map((row) => ({
    attemptId: toStringValue(row.attemptId),
    teacherEmail: toStringValue(row.teacherEmail),
    cacheKey: toStringValue(row.cacheKey),
    priceBookId: toStringValue(row.priceBookId),
    submissionId: toStringValue(row.submissionId),
    durationSeconds: toNumber(row.durationSeconds),
    outputTokens: toNumber(row.outputTokens),
    livemode: toNumber(row.livemode) === 1,
    billingContractId: toStringValue(row.billingContractId),
    occurredAt: toNumber(row.occurredAt),
  }));
}

/**
 * Counts every durable billing state that must be drained or reconciled before
 * retention cleanup can delete its grading source. Attempted-but-unreported and
 * expired-unqueued states require manual review; the other two are recoverable
 * automatically while the Stripe runtime is healthy.
 */
export async function getAiBillingReconciliationHealth(
  priceBookId = TEACHER_AI_PRICE_BOOK.id,
  now = Date.now(),
  scope?: Readonly<{ livemode: boolean; billingContractId: string }>,
): Promise<AiBillingReconciliationHealth> {
  const normalizedPriceBookId = requireTrimmedValue("priceBookId", priceBookId);
  const safeNow = requireNonNegativeInteger("now", now);
  const supportedSince = getStripeAutomaticUsageRecoverySupportedSince(safeNow);
  const normalizedScope = scope
    ? {
        livemode: scope.livemode === true ? 1 : 0,
        billingContractId: requireTrimmedValue(
          "billingContractId",
          scope.billingContractId,
        ),
      }
    : null;
  const currentUsageScopeSql = normalizedScope
    ? "AND livemode = ? AND billing_contract_id = ?"
    : "AND 1 = 0";
  const invalidUsageScopeSql = normalizedScope
    ? "OR livemode <> ? OR billing_contract_id <> ?"
    : "OR 1 = 1";
  const currentAttemptScopeSql = normalizedScope
    ? "AND ag.billing_livemode = ? AND ag.billing_contract_id = ?"
    : "AND 1 = 0";
  const invalidAttemptScopeSql = normalizedScope
    ? "OR ag.billing_livemode <> ? OR ag.billing_contract_id <> ?"
    : "OR 1 = 1";
  const scopeArgs = normalizedScope
    ? [normalizedScope.livemode, normalizedScope.billingContractId]
    : [];
  const result = await query(
    `SELECT
      COALESCE((
        SELECT SUM(
          CASE WHEN base_units > 0 AND base_attempted_at IS NULL
            AND base_reported_at IS NULL THEN 1 ELSE 0 END
          + CASE WHEN duration_seconds > 0 AND audio_attempted_at IS NULL
            AND audio_reported_at IS NULL THEN 1 ELSE 0 END
        )
        FROM ai_billing_usage_v3
        WHERE free_credit_applied = 0
          AND price_book_id = ?
          AND catalog_fingerprint = ?
          AND stripe_customer_id <> ''
          AND stripe_subscription_id <> ''
          ${currentUsageScopeSql}
          AND created_at >= ?
      ), 0) as pendingUnattempted,
      COALESCE((
        SELECT SUM(
          CASE WHEN base_units > 0 AND base_attempted_at IS NULL
            AND base_reported_at IS NULL THEN 1 ELSE 0 END
          + CASE WHEN duration_seconds > 0 AND audio_attempted_at IS NULL
            AND audio_reported_at IS NULL THEN 1 ELSE 0 END
        )
        FROM ai_billing_usage_v3
        WHERE free_credit_applied = 0
          AND price_book_id = ?
          AND catalog_fingerprint = ?
          AND stripe_customer_id <> ''
          AND stripe_subscription_id <> ''
          ${currentUsageScopeSql}
          AND created_at < ?
      ), 0) as expiredPendingUnattempted,
      COALESCE((
        SELECT SUM(
          CASE WHEN base_units > 0 AND base_attempted_at IS NULL
            AND base_reported_at IS NULL THEN 1 ELSE 0 END
          + CASE WHEN duration_seconds > 0 AND audio_attempted_at IS NULL
            AND audio_reported_at IS NULL THEN 1 ELSE 0 END
        )
        FROM ai_billing_usage_v3
        WHERE free_credit_applied = 0
          AND price_book_id = ?
          AND (
            catalog_fingerprint <> ?
            OR stripe_customer_id = ''
            OR stripe_subscription_id = ''
            ${invalidUsageScopeSql}
          )
      ), 0) as invalidPendingUnattempted,
      COALESCE((
        SELECT SUM(
          CASE WHEN base_units > 0 AND base_attempted_at IS NOT NULL
            AND base_reported_at IS NULL THEN 1 ELSE 0 END
          + CASE WHEN duration_seconds > 0 AND audio_attempted_at IS NOT NULL
            AND audio_reported_at IS NULL THEN 1 ELSE 0 END
        )
        FROM ai_billing_usage_v3
        WHERE free_credit_applied = 0
          AND price_book_id = ?
      ), 0) as attemptedUnreported,
      COALESCE((
        SELECT COUNT(*)
        FROM ai_grading_attempts ag
        WHERE ag.status = 'completed'
          AND ag.billing_required = 1
          AND ag.billing_price_book_id = ?
          AND ag.billing_catalog_fingerprint = ?
          AND ag.billing_stripe_customer_id <> ''
          AND ag.billing_stripe_subscription_id <> ''
          ${currentAttemptScopeSql}
          AND ag.cache_key <> ''
          AND (
            ag.billing_free_credit_applied = 1
            OR COALESCE(ag.completed_at, ag.created_at) >= ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ai_billing_usage_v3 u
            WHERE LOWER(u.teacher_email) = LOWER(ag.teacher_email)
              AND u.cache_key = ag.cache_key
              AND u.price_book_id = ag.billing_price_book_id
              AND u.catalog_fingerprint = ag.billing_catalog_fingerprint
              AND u.livemode = ag.billing_livemode
          )
      ), 0) as recoverableUnqueued,
      COALESCE((
        SELECT COUNT(*)
        FROM ai_grading_attempts ag
        WHERE ag.status = 'completed'
          AND ag.billing_required = 1
          AND ag.billing_price_book_id = ?
          AND ag.cache_key <> ''
          AND (
            ag.billing_catalog_fingerprint <> ?
            OR ag.billing_stripe_customer_id = ''
            OR ag.billing_stripe_subscription_id = ''
            ${invalidAttemptScopeSql}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ai_billing_usage_v3 u
            WHERE LOWER(u.teacher_email) = LOWER(ag.teacher_email)
              AND u.cache_key = ag.cache_key
              AND u.price_book_id = ag.billing_price_book_id
              AND u.catalog_fingerprint = ag.billing_catalog_fingerprint
              AND u.livemode = ag.billing_livemode
          )
      ), 0) as invalidUnqueued,
      COALESCE((
        SELECT COUNT(*)
        FROM ai_grading_attempts ag
        WHERE ag.status = 'completed'
          AND ag.billing_required = 1
          AND ag.billing_price_book_id = ?
          AND ag.billing_catalog_fingerprint = ?
          AND ag.billing_stripe_customer_id <> ''
          AND ag.billing_stripe_subscription_id <> ''
          ${currentAttemptScopeSql}
          AND ag.cache_key <> ''
          AND ag.billing_free_credit_applied = 0
          AND COALESCE(ag.completed_at, ag.created_at) < ?
          AND NOT EXISTS (
            SELECT 1
            FROM ai_billing_usage_v3 u
            WHERE LOWER(u.teacher_email) = LOWER(ag.teacher_email)
              AND u.cache_key = ag.cache_key
              AND u.price_book_id = ag.billing_price_book_id
              AND u.catalog_fingerprint = ag.billing_catalog_fingerprint
              AND u.livemode = ag.billing_livemode
          )
      ), 0) as expiredUnqueued`,
    [
      normalizedPriceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      ...scopeArgs,
      supportedSince,
      normalizedPriceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      ...scopeArgs,
      supportedSince,
      normalizedPriceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      ...scopeArgs,
      normalizedPriceBookId,
      normalizedPriceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      ...scopeArgs,
      supportedSince,
      normalizedPriceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      ...scopeArgs,
      normalizedPriceBookId,
      STRIPE_CATALOG_MANIFEST.fingerprint,
      ...scopeArgs,
      supportedSince,
    ]
  );
  return {
    pendingUnattempted: toNumber(result.rows[0]?.pendingUnattempted),
    expiredPendingUnattempted: toNumber(result.rows[0]?.expiredPendingUnattempted),
    invalidPendingUnattempted: toNumber(result.rows[0]?.invalidPendingUnattempted),
    attemptedUnreported: toNumber(result.rows[0]?.attemptedUnreported),
    recoverableUnqueued: toNumber(result.rows[0]?.recoverableUnqueued),
    invalidUnqueued: toNumber(result.rows[0]?.invalidUnqueued),
    expiredUnqueued: toNumber(result.rows[0]?.expiredUnqueued),
  };
}

export async function listAiGradingAttemptsForSubmission(
  submissionId: string,
  ownerEmail: string,
  limit = 5
): Promise<AiGradingAttemptRow[]> {
  const result = await query(
    `SELECT
      ag.id as id,
      ag.submission_id as submissionId,
      ag.teacher_email as teacherEmail,
      ag.status as status,
      ag.delivery_status as deliveryStatus,
      ag.transcript as transcript,
      ag.detected_language as detectedLanguage,
      ag.transcript_quality as transcriptQuality,
      ag.duration_seconds as durationSeconds,
      ag.suggested_score as suggestedScore,
      ag.rubric_scores as rubricScores,
      ag.feedback as feedback,
      ag.strengths as strengths,
      ag.improvements as improvements,
      ag.evidence as evidence,
      ag.confidence as confidence,
      ag.warnings as warnings,
      ag.teacher_attention as teacherAttention,
      ag.transcription_provider as transcriptionProvider,
      ag.grading_provider as gradingProvider,
      ag.transcription_model as transcriptionModel,
      ag.grading_model as gradingModel,
      ag.error_code as errorCode,
      ag.error_message as errorMessage,
      ag.cache_key as cacheKey,
      ag.assignment_fingerprint as assignmentFingerprint,
      ag.cache_hit as cacheHit,
      ag.input_tokens as inputTokens,
      ag.cached_input_tokens as cachedInputTokens,
      ag.output_tokens as outputTokens,
      ag.latency_ms as latencyMs,
      ag.retries as retries,
      ag.escalated as escalated,
      ag.escalation_reason as escalationReason,
      ag.estimated_cost_microusd as estimatedCostMicrousd,
      ag.prompt_version as promptVersion,
      ag.result_source as resultSource,
      ag.billing_required as billingRequired,
      ag.billing_price_book_id as billingPriceBookId,
      ag.billing_stripe_customer_id as billingStripeCustomerId,
      ag.billing_stripe_subscription_id as billingStripeSubscriptionId,
      ag.billing_catalog_fingerprint as billingCatalogFingerprint,
      ag.billing_contract_id as billingContractId,
      ag.billing_livemode as billingLivemode,
      ag.billing_qualifying_class_high_water as billingQualifyingClassHighWater,
      ag.billing_free_credit_applied as billingFreeCreditApplied,
      ag.billable_output_tokens as billableOutputTokens,
      ag.created_at as createdAt,
      ag.completed_at as completedAt
    FROM ai_grading_attempts ag
    JOIN submissions s ON s.id = ag.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.submission_id = ?
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND ag.delivery_status IN ('delivered', 'not_applicable')
    ORDER BY ag.created_at DESC
    LIMIT ?`,
    [submissionId, ownerEmail, Math.max(1, Math.min(limit, 20))]
  );
  return result.rows.map(rowToAiAttempt);
}

/** Durable source for a consumed semantic-key retry; never exposes cross-owner data. */
export async function getReusableAiReviewAttempt(input: {
  attemptId: string;
  teacherEmail: string;
  semanticKey: string;
}): Promise<AiGradingAttemptRow | null> {
  const attemptId = requireTrimmedValue("attemptId", input.attemptId);
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const semanticKey = requireTrimmedValue("semanticKey", input.semanticKey);
  const source = await query(
    `SELECT
      ag.id as id,
      ag.submission_id as submissionId,
      ag.teacher_email as teacherEmail,
      ag.status as status,
      ag.delivery_status as deliveryStatus,
      ag.transcript as transcript,
      ag.detected_language as detectedLanguage,
      ag.transcript_quality as transcriptQuality,
      ag.duration_seconds as durationSeconds,
      ag.suggested_score as suggestedScore,
      ag.rubric_scores as rubricScores,
      ag.feedback as feedback,
      ag.strengths as strengths,
      ag.improvements as improvements,
      ag.evidence as evidence,
      ag.confidence as confidence,
      ag.warnings as warnings,
      ag.teacher_attention as teacherAttention,
      ag.transcription_provider as transcriptionProvider,
      ag.grading_provider as gradingProvider,
      ag.transcription_model as transcriptionModel,
      ag.grading_model as gradingModel,
      ag.error_code as errorCode,
      ag.error_message as errorMessage,
      ag.cache_key as cacheKey,
      ag.assignment_fingerprint as assignmentFingerprint,
      ag.cache_hit as cacheHit,
      ag.input_tokens as inputTokens,
      ag.cached_input_tokens as cachedInputTokens,
      ag.output_tokens as outputTokens,
      ag.latency_ms as latencyMs,
      ag.retries as retries,
      ag.escalated as escalated,
      ag.escalation_reason as escalationReason,
      ag.estimated_cost_microusd as estimatedCostMicrousd,
      ag.prompt_version as promptVersion,
      ag.result_source as resultSource,
      ag.billing_required as billingRequired,
      ag.billing_price_book_id as billingPriceBookId,
      ag.billing_stripe_customer_id as billingStripeCustomerId,
      ag.billing_stripe_subscription_id as billingStripeSubscriptionId,
      ag.billing_catalog_fingerprint as billingCatalogFingerprint,
      ag.billing_contract_id as billingContractId,
      ag.billing_livemode as billingLivemode,
      ag.billing_qualifying_class_high_water as billingQualifyingClassHighWater,
      ag.billing_free_credit_applied as billingFreeCreditApplied,
      ag.billable_output_tokens as billableOutputTokens,
      ag.created_at as createdAt,
      ag.completed_at as completedAt
    FROM ai_grading_attempts ag
    JOIN submissions s ON s.id = ag.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.id = ?
      AND LOWER(ag.teacher_email) = LOWER(?)
      AND ag.cache_key = ?
      AND ag.status = 'completed'
      AND ag.delivery_status IN ('delivered', 'not_applicable')
      AND TRIM(ag.transcript) <> ''
      AND TRIM(ag.error_code) = ''
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    [attemptId, teacherEmail, semanticKey, teacherEmail],
  );
  return source.rows[0] ? rowToAiAttempt(source.rows[0]) : null;
}

function rowToGradingResultCache(row: Row): GradingResultCacheRow {
  return {
    cacheKey: toStringValue(row.cacheKey),
    submissionId: toStringValue(row.submissionId),
    teacherEmail: toStringValue(row.teacherEmail),
    resultJson: toStringValue(row.resultJson),
    provider: toStringValue(row.provider),
    model: toStringValue(row.model),
    promptVersion: toStringValue(row.promptVersion),
    createdAt: toNumber(row.createdAt),
    updatedAt: toNumber(row.updatedAt),
    expiresAt: toNumber(row.expiresAt),
  };
}

function hasValidJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a reusable result only while its source submission and owning class
 * are active. The owner join is deliberate: a cache key is never an access
 * token and cannot be used to read another teacher's grading data.
 */
export async function findValidGradingResultCache(
  cacheKey: string,
  ownerEmail: string,
  now = Date.now()
): Promise<GradingResultCacheRow | null> {
  const result = await query(
    `SELECT
      grc.cache_key as cacheKey,
      grc.submission_id as submissionId,
      grc.teacher_email as teacherEmail,
      grc.result_json as resultJson,
      grc.provider as provider,
      grc.model as model,
      grc.prompt_version as promptVersion,
      grc.created_at as createdAt,
      grc.updated_at as updatedAt,
      grc.expires_at as expiresAt
    FROM grading_result_cache grc
    JOIN submissions s ON s.id = grc.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE grc.cache_key = ?
      AND LOWER(grc.teacher_email) = LOWER(?)
      AND LOWER(c.owner_email) = LOWER(?)
      AND grc.expires_at > ?
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    LIMIT 1`,
    [cacheKey, ownerEmail, ownerEmail, now]
  );
  const row = result.rows[0];
  if (!row) return null;
  const cached = rowToGradingResultCache(row);
  return hasValidJson(cached.resultJson) ? cached : null;
}

export async function upsertGradingResultCache(input: {
  cacheKey: string;
  submissionId: string;
  teacherEmail: string;
  resultJson: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  expiresAt: number;
  now?: number;
}): Promise<GradingResultCacheRow | null> {
  const cacheKey = input.cacheKey.trim();
  const teacherEmail = input.teacherEmail.trim().toLowerCase();
  const resultJson = input.resultJson.trim();
  if (!cacheKey) throw new Error("A grading cache key is required.");
  if (!resultJson || !hasValidJson(resultJson)) {
    throw new Error("A grading cache entry must contain valid JSON.");
  }

  const now = toNonNegativeInteger(input.now ?? Date.now());
  const expiresAt = toNonNegativeInteger(input.expiresAt);
  const result = await query(
    `INSERT INTO grading_result_cache (
      cache_key, submission_id, teacher_email, result_json, provider, model,
      prompt_version, created_at, updated_at, expires_at
    )
    SELECT ?, s.id, LOWER(c.owner_email), ?, ?, ?, ?, ?, ?, ?
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ON CONFLICT(cache_key, teacher_email) DO UPDATE SET
      submission_id = excluded.submission_id,
      result_json = excluded.result_json,
      provider = excluded.provider,
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at`,
    [
      cacheKey,
      resultJson,
      input.provider ?? "",
      input.model ?? "",
      input.promptVersion ?? "",
      now,
      now,
      expiresAt,
      input.submissionId,
      teacherEmail,
    ]
  );
  if (toNumber(result.rowsAffected) === 0) return null;
  return findValidGradingResultCache(cacheKey, teacherEmail, now);
}

function rowToGradingProviderRequest(row: Row): GradingProviderRequestRow {
  const status = toStringValue(row.status);
  return {
    id: toStringValue(row.id),
    attemptId: row.attemptId === null ? null : toStringValue(row.attemptId),
    submissionId: toStringValue(row.submissionId),
    teacherEmail: toStringValue(row.teacherEmail),
    requestStage: toStringValue(row.requestStage),
    provider: toStringValue(row.provider),
    model: toStringValue(row.model),
    providerRequestId: toStringValue(row.providerRequestId),
    status: status === "pending" || status === "failed" ? status : "completed",
    inputTokens: toNumber(row.inputTokens),
    cachedInputTokens: toNumber(row.cachedInputTokens),
    outputTokens: toNumber(row.outputTokens),
    latencyMs: toNumber(row.latencyMs),
    retries: toNumber(row.retries),
    escalated: toNumber(row.escalated) === 1,
    escalationReason: toStringValue(row.escalationReason),
    estimatedCostMicrousd: toNumber(row.estimatedCostMicrousd),
    promptVersion: toStringValue(row.promptVersion),
    errorCode: toStringValue(row.errorCode),
    createdAt: toNumber(row.createdAt),
    completedAt: toNullableNumber(row.completedAt),
  };
}

/** Records one provider call without storing its prompt or response body. */
export async function recordGradingProviderRequest(input: {
  id?: string;
  attemptId?: string | null;
  submissionId: string;
  teacherEmail: string;
  requestStage: string;
  provider: string;
  model: string;
  providerRequestId?: string;
  status?: GradingProviderRequestStatus;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  retries?: number;
  escalated?: boolean;
  escalationReason?: string;
  estimatedCostMicrousd?: number;
  promptVersion?: string;
  errorCode?: string;
  createdAt?: number;
  completedAt?: number | null;
}): Promise<GradingProviderRequestRow | null> {
  const status = input.status ?? "completed";
  const createdAt = toNonNegativeInteger(input.createdAt ?? Date.now());
  const item: GradingProviderRequestRow = {
    id: input.id?.trim() || makeId("gpr"),
    attemptId: input.attemptId?.trim() || null,
    submissionId: input.submissionId,
    teacherEmail: input.teacherEmail.trim().toLowerCase(),
    requestStage: input.requestStage.trim(),
    provider: input.provider.trim(),
    model: input.model.trim(),
    providerRequestId: input.providerRequestId?.trim() ?? "",
    status,
    inputTokens: toNonNegativeInteger(input.inputTokens),
    cachedInputTokens: toNonNegativeInteger(input.cachedInputTokens),
    outputTokens: toNonNegativeInteger(input.outputTokens),
    latencyMs: toNonNegativeInteger(input.latencyMs),
    retries: toNonNegativeInteger(input.retries),
    escalated: input.escalated ?? false,
    escalationReason: input.escalationReason?.trim() ?? "",
    estimatedCostMicrousd: toNonNegativeInteger(input.estimatedCostMicrousd),
    promptVersion: input.promptVersion?.trim() ?? "",
    errorCode: input.errorCode?.trim() ?? "",
    createdAt,
    completedAt:
      typeof input.completedAt === "number"
        ? toNonNegativeInteger(input.completedAt)
        : status === "pending"
          ? null
          : createdAt,
  };

  const result = await query(
    `INSERT INTO grading_provider_requests (
      id, attempt_id, submission_id, teacher_email, request_stage, provider,
      model, provider_request_id, status, input_tokens, cached_input_tokens,
      output_tokens, latency_ms, retries, escalated, escalation_reason,
      estimated_cost_microusd, prompt_version, error_code, created_at, completed_at
    )
    SELECT ?, ?, s.id, LOWER(c.owner_email), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.id = ?
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (
        ? IS NULL OR EXISTS (
          SELECT 1
          FROM ai_grading_attempts ag
          WHERE ag.id = ?
            AND ag.submission_id = s.id
        )
      )`,
    [
      item.id,
      item.attemptId,
      item.requestStage,
      item.provider,
      item.model,
      item.providerRequestId,
      item.status,
      item.inputTokens,
      item.cachedInputTokens,
      item.outputTokens,
      item.latencyMs,
      item.retries,
      item.escalated ? 1 : 0,
      item.escalationReason,
      item.estimatedCostMicrousd,
      item.promptVersion,
      item.errorCode,
      item.createdAt,
      item.completedAt,
      item.submissionId,
      item.teacherEmail,
      item.attemptId,
      item.attemptId,
    ]
  );
  return toNumber(result.rowsAffected) === 1 ? item : null;
}

export async function listGradingProviderRequestsForSubmission(
  submissionId: string,
  ownerEmail: string,
  limit = 100
): Promise<GradingProviderRequestRow[]> {
  const result = await query(
    `SELECT
      gpr.id as id,
      gpr.attempt_id as attemptId,
      gpr.submission_id as submissionId,
      gpr.teacher_email as teacherEmail,
      gpr.request_stage as requestStage,
      gpr.provider as provider,
      gpr.model as model,
      gpr.provider_request_id as providerRequestId,
      gpr.status as status,
      gpr.input_tokens as inputTokens,
      gpr.cached_input_tokens as cachedInputTokens,
      gpr.output_tokens as outputTokens,
      gpr.latency_ms as latencyMs,
      gpr.retries as retries,
      gpr.escalated as escalated,
      gpr.escalation_reason as escalationReason,
      gpr.estimated_cost_microusd as estimatedCostMicrousd,
      gpr.prompt_version as promptVersion,
      gpr.error_code as errorCode,
      gpr.created_at as createdAt,
      gpr.completed_at as completedAt
    FROM grading_provider_requests gpr
    JOIN submissions s ON s.id = gpr.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE gpr.submission_id = ?
      AND LOWER(c.owner_email) = LOWER(?)
      AND s.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY gpr.created_at ASC, gpr.id ASC
    LIMIT ?`,
    [submissionId, ownerEmail, Math.max(1, Math.min(Math.floor(limit), 500))]
  );
  return result.rows.map(rowToGradingProviderRequest);
}

async function getTeacherGradingUsageBetween(
  teacherEmail: string,
  since: number,
  before: number | null
): Promise<GradingUsageAggregate> {
  const result = await query(
    `SELECT
      COUNT(*) as requestCount,
      COALESCE(SUM(input_tokens), 0) as inputTokens,
      COALESCE(SUM(cached_input_tokens), 0) as cachedInputTokens,
      COALESCE(SUM(output_tokens), 0) as outputTokens,
      COALESCE(SUM(latency_ms), 0) as latencyMs,
      COALESCE(SUM(retries), 0) as retries,
      COALESCE(SUM(CASE WHEN escalated = 1 THEN 1 ELSE 0 END), 0) as escalations,
      COALESCE(SUM(estimated_cost_microusd), 0) as estimatedCostMicrousd
    FROM grading_provider_requests
    WHERE LOWER(teacher_email) = LOWER(?)
      AND created_at >= ?
      AND (? IS NULL OR created_at < ?)`,
    [teacherEmail, since, before, before]
  );
  const row = result.rows[0];
  return {
    requestCount: toNumber(row?.requestCount),
    inputTokens: toNumber(row?.inputTokens),
    cachedInputTokens: toNumber(row?.cachedInputTokens),
    outputTokens: toNumber(row?.outputTokens),
    latencyMs: toNumber(row?.latencyMs),
    retries: toNumber(row?.retries),
    escalations: toNumber(row?.escalations),
    estimatedCostMicrousd: toNumber(row?.estimatedCostMicrousd),
  };
}

export async function getTeacherGradingUsageSince(
  teacherEmail: string,
  since: number
): Promise<GradingUsageAggregate> {
  return getTeacherGradingUsageBetween(teacherEmail, since, null);
}

export async function getTeacherGradingUsageForUtcMonth(
  teacherEmail: string,
  now = Date.now()
): Promise<GradingUsageAggregate> {
  const date = new Date(now);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const nextMonthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return getTeacherGradingUsageBetween(teacherEmail, monthStart, nextMonthStart);
}

export async function deleteExpiredGradingResultCache(now = Date.now()): Promise<number> {
  const result = await query(`DELETE FROM grading_result_cache WHERE expires_at <= ?`, [now]);
  return toNumber(result.rowsAffected);
}

export async function deleteGradingProviderRequestsBefore(cutoffTimestamp: number): Promise<number> {
  const result = await query(`DELETE FROM grading_provider_requests WHERE created_at < ?`, [cutoffTimestamp]);
  return toNumber(result.rowsAffected);
}

export async function cleanupGradingPersistence(input: {
  now?: number;
  providerRequestCutoff: number;
}) {
  const cacheEntriesDeleted = await deleteExpiredGradingResultCache(input.now ?? Date.now());
  const providerRequestsDeleted = await deleteGradingProviderRequestsBefore(input.providerRequestCutoff);
  return { cacheEntriesDeleted, providerRequestsDeleted };
}

export async function countAiAttemptsForSubmission(submissionId: string, ownerEmail: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt
    FROM ai_grading_attempts ag
    JOIN submissions s ON s.id = ag.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.submission_id = ?
      AND LOWER(c.owner_email) = LOWER(?)
      `,
    [submissionId, ownerEmail]
  );
  return toNumber(result.rows[0]?.cnt);
}

export async function countAiAttemptsForTeacherSince(teacherEmail: string, since: number): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt
    FROM ai_grading_attempts
    WHERE LOWER(teacher_email) = LOWER(?)
      AND created_at >= ?`,
    [teacherEmail, since]
  );
  return toNumber(result.rows[0]?.cnt);
}

export async function countAiAttemptsSince(since: number): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt
    FROM ai_grading_attempts
    WHERE created_at >= ?`,
    [since]
  );
  return toNumber(result.rows[0]?.cnt);
}

export async function reserveAiBudget(input: {
  generationCount: number;
  periodStart: number;
  monthlyBudgetUsd: number;
  reservedCostUsdPerGeneration: number;
}): Promise<boolean> {
  const generationCount = Math.max(1, Math.floor(input.generationCount));
  const budgetMicrousd = Math.floor(input.monthlyBudgetUsd * 1_000_000);
  const perGenerationMicrousd = Math.ceil(input.reservedCostUsdPerGeneration * 1_000_000);
  const reservedMicrousd = perGenerationMicrousd * generationCount;

  if (budgetMicrousd <= 0 || perGenerationMicrousd <= 0 || reservedMicrousd > budgetMicrousd) {
    return false;
  }

  const result = await query(
    `INSERT INTO ai_budget_reservations (
      id, generation_count, reserved_microusd, created_at
    )
    SELECT ?, ?, ?, ?
    WHERE COALESCE((
      SELECT SUM(reserved_microusd)
      FROM ai_budget_reservations
      WHERE created_at >= ?
    ), 0) + ? <= ?`,
    [
      makeId("aib"),
      generationCount,
      reservedMicrousd,
      Date.now(),
      input.periodStart,
      reservedMicrousd,
      budgetMicrousd,
    ]
  );

  return toNumber(result.rowsAffected) === 1;
}

export async function hasAudioTooLongFailure(submissionId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
    FROM ai_grading_attempts
    WHERE submission_id = ?
      AND error_code = 'audio_too_long'
    LIMIT 1`,
    [submissionId]
  );
  return result.rows.length > 0;
}

export async function latestAiAttemptCreatedAt(submissionId: string, ownerEmail: string): Promise<number | null> {
  const result = await query(
    `SELECT MAX(ag.created_at) as createdAt
    FROM ai_grading_attempts ag
    JOIN submissions s ON s.id = ag.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE ag.submission_id = ?
      AND LOWER(c.owner_email) = LOWER(?)`,
    [submissionId, ownerEmail]
  );
  return result.rows[0]?.createdAt === null ? null : toNullableNumber(result.rows[0]?.createdAt);
}

export async function deleteLocalAiFixtureData(): Promise<{
  attemptsDeleted: number;
  submissionsDeleted: number;
  assignmentsDeleted: number;
  classesDeleted: number;
  usersDeleted: number;
}> {
  const attempts = await query(
    `DELETE FROM ai_grading_attempts
    WHERE submission_id IN (
      SELECT s.id
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE c.id LIKE 'local_ai_%'
    )`
  );
  const submissions = await query(
    `DELETE FROM submissions
    WHERE id LIKE 'local_ai_%'
       OR assignment_id IN (SELECT id FROM assignments WHERE id LIKE 'local_ai_%')`
  );
  const assignments = await query(`DELETE FROM assignments WHERE id LIKE 'local_ai_%'`);
  const classes = await query(`DELETE FROM classes WHERE id LIKE 'local_ai_%'`);
  const users = await query(`DELETE FROM users WHERE email IN ('dev-teacher@local.test', 'local-ai-student@example.test')`);
  return {
    attemptsDeleted: toNumber(attempts.rowsAffected),
    submissionsDeleted: toNumber(submissions.rowsAffected),
    assignmentsDeleted: toNumber(assignments.rowsAffected),
    classesDeleted: toNumber(classes.rowsAffected),
    usersDeleted: toNumber(users.rowsAffected),
  };
}

export async function ensureLocalAiFixture(): Promise<{
  teacherEmail: string;
  classId: string;
  assignmentId: string;
  submissionId: string;
}> {
  const teacherEmail = "dev-teacher@local.test";
  const studentEmail = "local-ai-student@example.test";
  const classId = "local_ai_class";
  const assignmentId = "local_ai_assignment";
  const submissionId = "local_ai_submission";
  const rubric: Rubric = {
    title: "Local AI speaking rubric",
    criteria: [
      { id: "content", name: "Content", description: "Addresses the prompt with details.", maxPoints: 5 },
      { id: "language", name: "Language", description: "Uses target-language vocabulary and structures.", maxPoints: 5 },
    ],
  };
  const audioData = createSilentWavFixtureDataUrl();

  await query(
    `INSERT INTO users (email, role, created_at, is_paid, ai_access_grant_source)
    VALUES (?, 'teacher', ?, 1, 'manual')
    ON CONFLICT(email) DO UPDATE SET
      role = 'teacher', is_paid = 1, ai_access_grant_source = 'manual'`,
    [teacherEmail, Date.now()]
  );
  await query(
    `INSERT INTO classes (id, name, owner_email, created_at, deleted_at)
    VALUES (?, 'Local AI Test Class', ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET owner_email = excluded.owner_email, deleted_at = NULL`,
    [classId, teacherEmail, Date.now()]
  );
  await query(
    `INSERT INTO assignments (
      id, class_id, title, description, instructions, max_points, max_submissions,
      max_recording_seconds, rubric, attachment_name, attachment_url,
      attachment_content_type, created_at, deleted_at
    ) VALUES (?, ?, 'Local AI Speaking Test', '', 'Introduce yourself and describe your school day in Spanish.', 10, 0, 180, ?, '', '', '', ?, NULL)
    ON CONFLICT(id) DO UPDATE SET rubric = excluded.rubric, instructions = excluded.instructions, deleted_at = NULL`,
    [assignmentId, classId, stringifyJsonValue(rubric), Date.now()]
  );
  await query(
    `INSERT INTO submissions (
      id, assignment_id, student_name, student_email, audio_data, audio_blob_url,
      submitted_at, feedback, grade, rubric_scores, deleted_at
    ) VALUES (?, ?, 'Local AI Student', ?, ?, NULL, ?, '', NULL, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET
      audio_data = excluded.audio_data,
      audio_blob_url = NULL,
      grade = NULL,
      feedback = '',
      rubric_scores = NULL,
      deleted_at = NULL`,
    [submissionId, assignmentId, studentEmail, audioData, Date.now()]
  );
  return { teacherEmail, classId, assignmentId, submissionId };
}

export async function upsertRosterEntry(input: {
  classId: string;
  studentEmail: string;
  studentName: string;
  addedBy: "submission" | "teacher";
}): Promise<boolean> {
  const result = await query(
    `INSERT OR IGNORE INTO roster (id, class_id, student_email, student_name, added_at, added_by)
     VALUES (?, ?, LOWER(?), ?, ?, ?)`,
    [makeId("roster"), input.classId, input.studentEmail, input.studentName, Date.now(), input.addedBy]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function bulkUpsertRosterEntries(
  classId: string,
  students: { studentEmail: string; studentName: string }[]
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const student of students) {
    const result = await query(
      `INSERT OR IGNORE INTO roster (id, class_id, student_email, student_name, added_at, added_by)
       VALUES (?, ?, LOWER(?), ?, ?, 'teacher')`,
      [makeId("roster"), classId, student.studentEmail, student.studentName, Date.now()]
    );
    if (toNumber(result.rowsAffected) > 0) {
      added++;
    } else {
      skipped++;
    }
  }
  return { added, skipped };
}

export async function listRosterByClassId(classId: string, ownerEmail: string): Promise<RosterRow[]> {
  const result = await query(
    `SELECT
       r.id,
       r.class_id as classId,
       r.student_email as studentEmail,
       r.student_name as studentName,
       r.added_at as addedAt,
       r.added_by as addedBy
     FROM roster r
     JOIN classes c ON c.id = r.class_id
     WHERE r.class_id = ?
       AND c.deleted_at IS NULL
       AND LOWER(c.owner_email) = LOWER(?)
     ORDER BY LOWER(r.student_name), r.added_at ASC`,
    [classId, ownerEmail]
  );
  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    classId: toStringValue(row.classId),
    studentEmail: toStringValue(row.studentEmail),
    studentName: toStringValue(row.studentName),
    addedAt: toNumber(row.addedAt),
    addedBy: toStringValue(row.addedBy) === "teacher" ? "teacher" : "submission",
  }));
}

export async function deleteRosterEntry(
  classId: string,
  studentEmail: string,
  ownerEmail: string
): Promise<boolean> {
  const result = await query(
    `DELETE FROM roster
     WHERE class_id = ?
       AND LOWER(student_email) = LOWER(?)
       AND class_id IN (
         SELECT id FROM classes
         WHERE id = ?
           AND LOWER(owner_email) = LOWER(?)
           AND deleted_at IS NULL
       )`,
    [classId, studentEmail, classId, ownerEmail]
  );
  return toNumber(result.rowsAffected) > 0;
}

export async function listStudentAssignmentSummaries(
  classId: string,
  studentEmail: string,
  ownerEmail: string
): Promise<StudentAssignmentRow[]> {
  const result = await query(
    `SELECT
       a.id as assignmentId,
       a.title as assignmentTitle,
       COALESCE(a.max_points, 100) as maxPoints,
       a.created_at as createdAt,
       s.id as submissionId,
       s.submitted_at as submittedAt,
       s.grade as grade,
       COALESCE(s.feedback, '') as feedback
     FROM assignments a
     JOIN classes c ON c.id = a.class_id
     LEFT JOIN submissions s
       ON s.assignment_id = a.id
       AND LOWER(s.student_email) = LOWER(?)
       AND s.deleted_at IS NULL
     WHERE a.class_id = ?
       AND a.deleted_at IS NULL
       AND c.deleted_at IS NULL
       AND LOWER(c.owner_email) = LOWER(?)
     ORDER BY s.submitted_at IS NULL, s.submitted_at DESC, a.created_at DESC`,
    [studentEmail, classId, ownerEmail]
  );
  return result.rows.map((row) => ({
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    maxPoints: toNumber(row.maxPoints),
    createdAt: toNumber(row.createdAt),
    submissionId: row.submissionId ? toStringValue(row.submissionId) : null,
    audioData: row.submissionId
      ? toProtectedAudioPath(toStringValue(row.submissionId))
      : null,
    submittedAt: row.submittedAt ? toNumber(row.submittedAt) : null,
    grade: toNullableNumber(row.grade),
    feedback: toStringValue(row.feedback),
  }));
}

const AI_DAILY_GENERATION_QUOTA_LEASE_MS = 16 * 60 * 1000;

export type AiDailyGenerationQuotaReservation =
  | { status: "reserved"; reservationId: string }
  | { status: "teacher_limit" | "global_limit" };

/** Atomically counts started attempts plus live leases and claims one generation slot. */
export async function reserveAiDailyGenerationQuota(input: {
  teacherEmail: string;
  since: number;
  dailyTeacherLimit: number;
  dailyGlobalLimit: number;
  now?: number;
}): Promise<AiDailyGenerationQuotaReservation> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const now = Math.max(0, Math.floor(input.now ?? Date.now()));
  const since = Math.max(0, Math.floor(input.since));
  const teacherLimit = Math.max(0, Math.floor(input.dailyTeacherLimit));
  const globalLimit = Math.max(0, Math.floor(input.dailyGlobalLimit));
  const reservationId = `daily_quota_${crypto.randomUUID()}`;
  const result = await query(
    `INSERT INTO ai_daily_generation_quota_reservations (id, teacher_email, created_at, expires_at)
    SELECT ?, ?, ?, ?
    WHERE (
      (SELECT COUNT(*) FROM ai_grading_attempts
        WHERE LOWER(teacher_email) = LOWER(?) AND created_at >= ?)
      + (SELECT COUNT(*) FROM ai_daily_generation_quota_reservations
        WHERE LOWER(teacher_email) = LOWER(?) AND expires_at > ?)
    ) < ?
      AND (
        (SELECT COUNT(*) FROM ai_grading_attempts WHERE created_at >= ?)
        + (SELECT COUNT(*) FROM ai_daily_generation_quota_reservations WHERE expires_at > ?)
      ) < ?`,
    [reservationId, teacherEmail, now, now + AI_DAILY_GENERATION_QUOTA_LEASE_MS,
      teacherEmail, since, teacherEmail, now, teacherLimit, since, now, globalLimit],
  );
  if (toNumber(result.rowsAffected) === 1) {
    await query(
      `DELETE FROM ai_daily_generation_quota_reservations WHERE expires_at <= ? AND id <> ?`,
      [now, reservationId],
    ).catch(() => undefined);
    return { status: "reserved", reservationId };
  }
  const counts = await query(
    `SELECT
      (SELECT COUNT(*) FROM ai_grading_attempts
        WHERE LOWER(teacher_email) = LOWER(?) AND created_at >= ?)
      + (SELECT COUNT(*) FROM ai_daily_generation_quota_reservations
        WHERE LOWER(teacher_email) = LOWER(?) AND expires_at > ?) AS teacher_used,
      (SELECT COUNT(*) FROM ai_grading_attempts WHERE created_at >= ?)
      + (SELECT COUNT(*) FROM ai_daily_generation_quota_reservations WHERE expires_at > ?) AS global_used`,
    [teacherEmail, since, teacherEmail, now, since, now],
  );
  return toNumber(counts.rows[0]?.teacher_used) >= teacherLimit
    ? { status: "teacher_limit" }
    : { status: "global_limit" };
}

export async function releaseAiDailyGenerationQuota(input: {
  reservationId: string;
  teacherEmail: string;
}): Promise<boolean> {
  const result = await query(
    `DELETE FROM ai_daily_generation_quota_reservations
     WHERE id = ? AND LOWER(teacher_email) = LOWER(?)`,
    [requireTrimmedValue("reservationId", input.reservationId), input.teacherEmail],
  );
  return toNumber(result.rowsAffected) === 1;
}

// Keep the item lease just beyond the processed-recording allowance lease. If
// a serverless invocation disappears after reserving a unit, the next worker
// must not reclaim the item while that allowance reservation is still live.
const AI_GRADING_BATCH_ITEM_LEASE_MS = 16 * 60 * 1_000;

function aiGradingAssignmentFromRow(row: Row): SubmissionForAiGradeRow {
  return {
    submissionId: toStringValue(row.submissionId),
    assignmentId: toStringValue(row.assignmentId),
    assignmentTitle: toStringValue(row.assignmentTitle),
    audioBlobUrl: toStringValue(row.audioBlobUrl),
    description: toStringValue(row.assignmentDescription),
    instructions: toStringValue(row.assignmentInstructions),
    targetLanguage: toStringValue(row.assignmentTargetLanguage) || "Spanish",
    rubric: parseJsonValue<Rubric>(row.assignmentRubric),
    maxPoints: toNumber(row.assignmentMaxPoints),
    finalGrade: toNullableNumber(row.finalGrade),
    finalGradeSource:
      toStringValue(row.finalGradeSource) === "ai" ? "ai" : "teacher",
    finalFeedback: toStringValue(row.finalFeedback),
  };
}

async function selectAiGradingAssignmentInTransaction(
  transaction: Transaction,
  assignmentId: string,
  teacherEmail: string,
) {
  const result = await transaction.execute({
    sql: `SELECT
      '' as submissionId,
      a.id as assignmentId,
      a.title as assignmentTitle,
      '' as audioBlobUrl,
      COALESCE(a.description, '') as assignmentDescription,
      a.instructions as assignmentInstructions,
      COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as assignmentTargetLanguage,
      a.rubric as assignmentRubric,
      COALESCE(a.max_points, 100) as assignmentMaxPoints,
      NULL as finalGrade,
      'teacher' as finalGradeSource,
      '' as finalFeedback
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ?
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND LOWER(c.owner_email) = LOWER(?)
    LIMIT 1`,
    args: [assignmentId, teacherEmail],
  });
  return result.rows[0] ? aiGradingAssignmentFromRow(result.rows[0]) : null;
}

export async function getAiGradingAssignmentFingerprint(
  assignmentId: string,
  teacherEmail: string,
): Promise<string | null> {
  const normalizedEmail = normalizeBillingTeacherEmail(teacherEmail);
  await ensureInitialized();
  const transaction = await getDbClient().transaction("read");
  try {
    const assignment = await selectAiGradingAssignmentInTransaction(
      transaction,
      requireTrimmedValue("assignmentId", assignmentId),
      normalizedEmail,
    );
    await transaction.commit();
    if (!assignment) return null;
    return processedAssignmentFingerprint(
      legacyAssignmentToGradingAssignment(assignment),
    );
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

function normalizeAiGradingBatchStatus(value: unknown): AiGradingBatchStatus {
  const status = toStringValue(value);
  return [
    "queued",
    "processing",
    "review_ready",
    "partial_failure",
    "saved",
    "cancelled",
  ].includes(status)
    ? (status as AiGradingBatchStatus)
    : "cancelled";
}

function normalizeAiGradingBatchItemStatus(
  value: unknown,
): AiGradingBatchItemStatus {
  const status = toStringValue(value);
  return [
    "queued",
    "processing",
    "review_ready",
    "failed",
    "skipped",
    "saved",
    "conflict",
  ].includes(status)
    ? (status as AiGradingBatchItemStatus)
    : "failed";
}

function batchAttemptFromJoinedRow(row: Row): AiGradingAttemptRow | null {
  const attemptId = toStringValue(row.attemptId).trim();
  if (!attemptId) return null;
  return rowToAiAttempt({
    id: attemptId,
    submissionId: row.submissionId,
    teacherEmail: row.batchTeacherEmail,
    status: row.attemptStatus,
    deliveryStatus: row.attemptDeliveryStatus,
    transcript: row.attemptTranscript,
    detectedLanguage: row.attemptDetectedLanguage,
    transcriptQuality: row.attemptTranscriptQuality,
    durationSeconds: row.attemptDurationSeconds,
    suggestedScore: row.attemptSuggestedScore,
    rubricScores: row.attemptRubricScores,
    feedback: row.attemptFeedback,
    strengths: row.attemptStrengths,
    improvements: row.attemptImprovements,
    evidence: row.attemptEvidence,
    confidence: row.attemptConfidence,
    warnings: row.attemptWarnings,
    teacherAttention: row.attemptTeacherAttention,
    transcriptionProvider: row.attemptTranscriptionProvider,
    gradingProvider: row.attemptGradingProvider,
    transcriptionModel: row.attemptTranscriptionModel,
    gradingModel: row.attemptGradingModel,
    errorCode: row.attemptErrorCode,
    errorMessage: row.attemptErrorMessage,
    cacheKey: row.attemptCacheKey,
    assignmentFingerprint: row.attemptAssignmentFingerprint,
    cacheHit: row.attemptCacheHit,
    inputTokens: row.attemptInputTokens,
    cachedInputTokens: row.attemptCachedInputTokens,
    outputTokens: row.attemptOutputTokens,
    latencyMs: row.attemptLatencyMs,
    retries: row.attemptRetries,
    escalated: row.attemptEscalated,
    escalationReason: row.attemptEscalationReason,
    estimatedCostMicrousd: row.attemptEstimatedCostMicrousd,
    promptVersion: row.attemptPromptVersion,
    resultSource: row.attemptResultSource,
    billingRequired: row.attemptBillingRequired,
    billingPriceBookId: row.attemptBillingPriceBookId,
    billingStripeCustomerId: row.attemptBillingStripeCustomerId,
    billingStripeSubscriptionId: row.attemptBillingStripeSubscriptionId,
    billingCatalogFingerprint: row.attemptBillingCatalogFingerprint,
    billingContractId: row.attemptBillingContractId,
    billingLivemode: row.attemptBillingLivemode,
    billingQualifyingClassHighWater:
      row.attemptBillingQualifyingClassHighWater,
    billingFreeCreditApplied: row.attemptBillingFreeCreditApplied,
    billableOutputTokens: row.attemptBillableOutputTokens,
    createdAt: row.attemptCreatedAt,
    completedAt: row.attemptCompletedAt,
  } as unknown as Row);
}

const AI_GRADING_BATCH_JOINED_SELECT = `SELECT
  b.id as batchId,
  b.teacher_email as batchTeacherEmail,
  b.assignment_id as assignmentId,
  a.title as assignmentTitle,
  b.assignment_fingerprint as assignmentFingerprint,
  b.status as batchStatus,
  b.eligible_count as eligibleCount,
  b.new_units_required as newUnitsRequired,
  b.transcripts_required as transcriptsRequired,
  b.enhanced as enhanced,
  b.created_at as batchCreatedAt,
  b.updated_at as batchUpdatedAt,
  b.completed_at as batchCompletedAt,
  b.saved_at as batchSavedAt,
  i.id as itemId,
  i.submission_id as submissionId,
  COALESCE(s.student_name, '') as studentName,
  COALESCE(s.student_email, '') as studentEmail,
  COALESCE(s.submitted_at, 0) as submittedAt,
  i.ordinal as ordinal,
  i.status as itemStatus,
  i.attempt_id as attemptId,
  i.draft_grade as draftGrade,
  i.draft_rubric_scores as draftRubricScores,
  i.draft_feedback as draftFeedback,
  i.teacher_edited as teacherEdited,
  i.error_code as itemErrorCode,
  i.error_message as itemErrorMessage,
  i.retry_count as retryCount,
  i.updated_at as itemUpdatedAt,
  ag.status as attemptStatus,
  ag.delivery_status as attemptDeliveryStatus,
  ag.transcript as attemptTranscript,
  ag.detected_language as attemptDetectedLanguage,
  ag.transcript_quality as attemptTranscriptQuality,
  ag.duration_seconds as attemptDurationSeconds,
  ag.suggested_score as attemptSuggestedScore,
  ag.rubric_scores as attemptRubricScores,
  ag.feedback as attemptFeedback,
  ag.strengths as attemptStrengths,
  ag.improvements as attemptImprovements,
  ag.evidence as attemptEvidence,
  ag.confidence as attemptConfidence,
  ag.warnings as attemptWarnings,
  ag.teacher_attention as attemptTeacherAttention,
  ag.transcription_provider as attemptTranscriptionProvider,
  ag.grading_provider as attemptGradingProvider,
  ag.transcription_model as attemptTranscriptionModel,
  ag.grading_model as attemptGradingModel,
  ag.error_code as attemptErrorCode,
  ag.error_message as attemptErrorMessage,
  ag.cache_key as attemptCacheKey,
  ag.assignment_fingerprint as attemptAssignmentFingerprint,
  ag.cache_hit as attemptCacheHit,
  ag.input_tokens as attemptInputTokens,
  ag.cached_input_tokens as attemptCachedInputTokens,
  ag.output_tokens as attemptOutputTokens,
  ag.latency_ms as attemptLatencyMs,
  ag.retries as attemptRetries,
  ag.escalated as attemptEscalated,
  ag.escalation_reason as attemptEscalationReason,
  ag.estimated_cost_microusd as attemptEstimatedCostMicrousd,
  ag.prompt_version as attemptPromptVersion,
  ag.result_source as attemptResultSource,
  ag.billing_required as attemptBillingRequired,
  ag.billing_price_book_id as attemptBillingPriceBookId,
  ag.billing_stripe_customer_id as attemptBillingStripeCustomerId,
  ag.billing_stripe_subscription_id as attemptBillingStripeSubscriptionId,
  ag.billing_catalog_fingerprint as attemptBillingCatalogFingerprint,
  ag.billing_contract_id as attemptBillingContractId,
  ag.billing_livemode as attemptBillingLivemode,
  ag.billing_qualifying_class_high_water as attemptBillingQualifyingClassHighWater,
  ag.billing_free_credit_applied as attemptBillingFreeCreditApplied,
  ag.billable_output_tokens as attemptBillableOutputTokens,
  ag.created_at as attemptCreatedAt,
  ag.completed_at as attemptCompletedAt
FROM ai_grading_batches b
JOIN assignments a ON a.id = b.assignment_id
JOIN classes c ON c.id = a.class_id
JOIN ai_grading_batch_items i ON i.batch_id = b.id
JOIN submissions s ON s.id = i.submission_id AND s.deleted_at IS NULL
LEFT JOIN ai_grading_attempts ag ON ag.id = i.attempt_id`;

function batchFromJoinedRows(rows: Row[]): AiGradingBatchRow | null {
  const first = rows[0];
  if (!first) return null;
  const items = rows.map((row) => ({
    id: toStringValue(row.itemId),
    batchId: toStringValue(row.batchId),
    submissionId: toStringValue(row.submissionId),
    studentName: toStringValue(row.studentName),
    studentEmail: toStringValue(row.studentEmail),
    submittedAt: toNumber(row.submittedAt),
    ordinal: toNumber(row.ordinal),
    status: normalizeAiGradingBatchItemStatus(row.itemStatus),
    attemptId: toStringValue(row.attemptId).trim() || null,
    attempt: batchAttemptFromJoinedRow(row),
    errorCode: toStringValue(row.itemErrorCode),
    errorMessage: toStringValue(row.itemErrorMessage),
    retryCount: toNumber(row.retryCount),
    teacherEdited: toNumber(row.teacherEdited) === 1,
    draft: {
      grade: toNullableNumber(row.draftGrade),
      rubricScores: parseJsonValue<RubricScore[]>(row.draftRubricScores),
      feedback: toStringValue(row.draftFeedback),
    },
    updatedAt: toNumber(row.itemUpdatedAt),
  }));
  const count = (status: AiGradingBatchItemStatus) =>
    items.filter((item) => item.status === status).length;
  return {
    id: toStringValue(first.batchId),
    teacherEmail: toStringValue(first.batchTeacherEmail),
    assignmentId: toStringValue(first.assignmentId),
    assignmentTitle: toStringValue(first.assignmentTitle),
    assignmentFingerprint: toStringValue(first.assignmentFingerprint),
    status: normalizeAiGradingBatchStatus(first.batchStatus),
    eligibleCount: toNumber(first.eligibleCount),
    newUnitsRequired: toNumber(first.newUnitsRequired),
    transcriptsRequired: toNumber(first.transcriptsRequired),
    savedTranscripts: Math.max(
      0,
      toNumber(first.eligibleCount) - toNumber(first.transcriptsRequired),
    ),
    enhanced: toNumber(first.enhanced) === 1,
    counts: {
      total: items.length,
      queued: count("queued"),
      processing: count("processing"),
      reviewReady: count("review_ready"),
      failed: count("failed"),
      skipped: count("skipped"),
      saved: count("saved"),
      conflict: count("conflict"),
    },
    items,
    createdAt: toNumber(first.batchCreatedAt),
    updatedAt: toNumber(first.batchUpdatedAt),
    completedAt: toNullableNumber(first.batchCompletedAt),
    savedAt: toNullableNumber(first.batchSavedAt),
  };
}

async function reconcileDeletedAiGradingBatchItems(input: {
  batchId: string;
  teacherEmail: string;
  now?: number;
}) {
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const changed = await transaction.execute({
      sql: `UPDATE ai_grading_batch_items
      SET status = 'conflict', attempt_id = NULL, draft_grade = NULL,
          draft_rubric_scores = NULL, draft_feedback = '', teacher_edited = 0,
          error_code = 'submission_deleted',
          error_message = 'This submission is no longer available.',
          lease_token = '', lease_expires_at = 0, updated_at = ?
      WHERE batch_id = ?
        AND status NOT IN ('saved', 'conflict')
        AND EXISTS (
          SELECT 1 FROM submissions s
          WHERE s.id = ai_grading_batch_items.submission_id
            AND s.deleted_at IS NOT NULL
        )
        AND EXISTS (
          SELECT 1 FROM ai_grading_batches b
          JOIN assignments a ON a.id = b.assignment_id
          JOIN classes c ON c.id = a.class_id
          WHERE b.id = ai_grading_batch_items.batch_id
            AND LOWER(b.teacher_email) = LOWER(?)
            AND LOWER(c.owner_email) = LOWER(?)
        )`,
      args: [now, input.batchId, input.teacherEmail, input.teacherEmail],
    });
    if (toNumber(changed.rowsAffected) > 0) {
      const visible = await transaction.execute({
        sql: `SELECT COUNT(*) as count
        FROM ai_grading_batch_items i
        JOIN submissions s ON s.id = i.submission_id
        WHERE i.batch_id = ? AND s.deleted_at IS NULL`,
        args: [input.batchId],
      });
      if (toNumber(visible.rows[0]?.count) === 0) {
        await transaction.execute({
          sql: `UPDATE ai_grading_batches
          SET status = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?)
          WHERE id = ? AND LOWER(teacher_email) = LOWER(?)
            AND status NOT IN ('saved', 'cancelled')`,
          args: [now, now, input.batchId, input.teacherEmail],
        });
      } else {
        await refreshAiGradingBatchStatusInTransaction(transaction, input.batchId, now);
      }
    }
    await transaction.commit();
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function findAiGradingBatchForOwner(
  batchId: string,
  teacherEmail: string,
): Promise<AiGradingBatchRow | null> {
  await reconcileDeletedAiGradingBatchItems({ batchId, teacherEmail });
  const result = await query(
    `${AI_GRADING_BATCH_JOINED_SELECT}
    WHERE b.id = ?
      AND LOWER(b.teacher_email) = LOWER(?)
      AND LOWER(c.owner_email) = LOWER(?)
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY i.ordinal ASC`,
    [requireTrimmedValue("batchId", batchId), teacherEmail, teacherEmail],
  );
  return batchFromJoinedRows(result.rows);
}

export async function findActiveAiGradingBatchForAssignment(input: {
  assignmentId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
}): Promise<AiGradingBatchRow | null> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  await reconcileManuallyCompletedAiGradingBatch({
    assignmentId: input.assignmentId,
    teacherEmail,
    assignmentFingerprint: input.assignmentFingerprint,
  });
  const result = await query(
    `SELECT b.id as id
    FROM ai_grading_batches b
    JOIN assignments a ON a.id = b.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE b.assignment_id = ?
      AND LOWER(b.teacher_email) = LOWER(?)
      AND b.assignment_fingerprint = ?
      AND b.status IN ('queued', 'processing', 'review_ready', 'partial_failure')
      AND LOWER(c.owner_email) = LOWER(?)
      AND a.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY b.created_at DESC
    LIMIT 1`,
    [
      requireTrimmedValue("assignmentId", input.assignmentId),
      teacherEmail,
      requireTrimmedValue("assignmentFingerprint", input.assignmentFingerprint),
      teacherEmail,
    ],
  );
  const id = toStringValue(result.rows[0]?.id).trim();
  return id ? findAiGradingBatchForOwner(id, teacherEmail) : null;
}

async function reconcileManuallyCompletedAiGradingBatch(input: {
  assignmentId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
}) {
  await ensureInitialized();
  const now = Date.now();
  const transaction = await getDbClient().transaction("write");
  try {
    const active = await transaction.execute({
      sql: `SELECT b.id as id
      FROM ai_grading_batches b
      JOIN assignments a ON a.id = b.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE b.assignment_id = ?
        AND LOWER(b.teacher_email) = LOWER(?)
        AND b.assignment_fingerprint = ?
        AND b.status IN ('queued', 'processing', 'review_ready', 'partial_failure')
        AND LOWER(c.owner_email) = LOWER(?)
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL`,
      args: [
        input.assignmentId,
        input.teacherEmail,
        input.assignmentFingerprint,
        input.teacherEmail,
      ],
    });
    for (const row of active.rows) {
      const batchId = toStringValue(row.id);
      await transaction.execute({
        sql: `UPDATE ai_grading_batch_items
        SET status = 'conflict', error_code = 'submission_changed',
            error_message = 'This submission was graded outside this batch. The teacher''s saved work was kept.',
            lease_token = '', lease_expires_at = 0, updated_at = ?
        WHERE batch_id = ?
          AND status NOT IN ('saved', 'conflict')
          AND EXISTS (
            SELECT 1 FROM submissions s
            WHERE s.id = ai_grading_batch_items.submission_id
              AND (
                s.grade IS NOT NULL
                OR TRIM(COALESCE(s.feedback, '')) <> ''
                OR s.rubric_scores IS NOT NULL
              )
          )`,
        args: [now, batchId],
      });
      const unfinished = await transaction.execute({
        sql: `SELECT COUNT(*) as count
        FROM ai_grading_batch_items i
        JOIN submissions s ON s.id = i.submission_id
        WHERE i.batch_id = ?
          AND i.status <> 'saved'
          AND s.deleted_at IS NULL
          AND s.grade IS NULL
          AND TRIM(COALESCE(s.feedback, '')) = ''
          AND s.rubric_scores IS NULL`,
        args: [batchId],
      });
      if (toNumber(unfinished.rows[0]?.count) === 0) {
        await transaction.execute({
          sql: `UPDATE ai_grading_batches
          SET status = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?)
          WHERE id = ? AND status NOT IN ('saved', 'cancelled')`,
          args: [now, now, batchId],
        });
      } else {
        await refreshAiGradingBatchStatusInTransaction(transaction, batchId, now);
      }
    }
    await transaction.commit();
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

async function refreshAiGradingBatchStatusInTransaction(
  transaction: Transaction,
  batchId: string,
  now: number,
) {
  const current = await transaction.execute({
    sql: `SELECT status FROM ai_grading_batches WHERE id = ? LIMIT 1`,
    args: [batchId],
  });
  const currentStatus = normalizeAiGradingBatchStatus(current.rows[0]?.status);
  if (currentStatus === "saved" || currentStatus === "cancelled") return currentStatus;
  const result = await transaction.execute({
    sql: `SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status = 'review_ready' THEN 1 ELSE 0 END) as reviewReady,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
      SUM(CASE WHEN status = 'saved' THEN 1 ELSE 0 END) as saved,
      SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) as conflict
    FROM ai_grading_batch_items
    WHERE batch_id = ?`,
    args: [batchId],
  });
  const row = result.rows[0];
  const queued = toNumber(row?.queued);
  const processing = toNumber(row?.processing);
  const reviewReady = toNumber(row?.reviewReady);
  const failed = toNumber(row?.failed);
  const skipped = toNumber(row?.skipped);
  const saved = toNumber(row?.saved);
  const conflict = toNumber(row?.conflict);
  let status: AiGradingBatchStatus;
  if (queued > 0 || processing > 0) {
    status =
      processing > 0 || reviewReady + failed + skipped + saved + conflict > 0
        ? "processing"
        : "queued";
  } else if (failed + skipped + conflict > 0) {
    status = "partial_failure";
  } else if (reviewReady > 0) {
    status = "review_ready";
  } else {
    status = "partial_failure";
  }
  const finished = queued === 0 && processing === 0;
  await transaction.execute({
    sql: `UPDATE ai_grading_batches
    SET status = ?, updated_at = ?, completed_at = CASE
      WHEN ? = 1 THEN COALESCE(completed_at, ?)
      ELSE NULL
    END
    WHERE id = ? AND status NOT IN ('saved', 'cancelled')`,
    args: [status, now, finished ? 1 : 0, now, batchId],
  });
  return status;
}

export type CreateOrResumeAiGradingBatchResult =
  | { status: "ready"; created: boolean; batch: AiGradingBatchRow }
  | {
      status: "assignment_changed" | "scope_changed" | "empty";
      created: false;
      batch: null;
    };

function isUniqueConstraintError(error: unknown) {
  return error instanceof Error && /unique constraint/i.test(error.message);
}

let aiGradingBatchCreateQueue: Promise<void> = Promise.resolve();

async function createOrResumeAiGradingBatchAtomic(input: {
  assignmentId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
  idempotencyKey: string;
  expectedSubmissionIds: string[];
  newUnitsRequired: number;
  transcriptsRequired: number;
  enhanced?: boolean;
  now?: number;
}): Promise<CreateOrResumeAiGradingBatchResult> {
  const assignmentId = requireTrimmedValue("assignmentId", input.assignmentId);
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const assignmentFingerprint = requireTrimmedValue(
    "assignmentFingerprint",
    input.assignmentFingerprint,
  );
  const idempotencyKey = requireTrimmedValue(
    "idempotencyKey",
    input.idempotencyKey,
  ).slice(0, 120);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  const expectedSubmissionIds = input.expectedSubmissionIds.map((id) =>
    requireTrimmedValue("expectedSubmissionId", id),
  );
  if (new Set(expectedSubmissionIds).size !== expectedSubmissionIds.length) {
    throw new RangeError("expectedSubmissionIds must be unique.");
  }
  const expectedNewUnitsRequired = requireNonNegativeInteger(
    "newUnitsRequired",
    input.newUnitsRequired,
  );
  const expectedTranscriptsRequired = requireNonNegativeInteger(
    "transcriptsRequired",
    input.transcriptsRequired,
  );
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  let batchId = "";
  let created = false;
  let raced = false;
  try {
    const assignment = await selectAiGradingAssignmentInTransaction(
      transaction,
      assignmentId,
      teacherEmail,
    );
    if (!assignment) {
      await transaction.rollback();
      return { status: "empty", created: false, batch: null };
    }
    const currentFingerprint = processedAssignmentFingerprint(
      legacyAssignmentToGradingAssignment(assignment),
    );
    if (!currentFingerprint || currentFingerprint !== assignmentFingerprint) {
      await transaction.rollback();
      return { status: "assignment_changed", created: false, batch: null };
    }

    const idempotent = await transaction.execute({
      sql: `SELECT id, assignment_fingerprint as assignmentFingerprint
      FROM ai_grading_batches
      WHERE teacher_email = ? AND assignment_id = ? AND idempotency_key = ?
      LIMIT 1`,
      args: [teacherEmail, assignmentId, idempotencyKey],
    });
    const idempotentRow = idempotent.rows[0];
    if (idempotentRow) {
      if (
        toStringValue(idempotentRow.assignmentFingerprint) !==
        assignmentFingerprint
      ) {
        await transaction.rollback();
        return { status: "assignment_changed", created: false, batch: null };
      }
      batchId = toStringValue(idempotentRow.id);
      await transaction.commit();
    } else {
      await transaction.execute({
        sql: `UPDATE ai_grading_batches
        SET status = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?)
        WHERE teacher_email = ?
          AND assignment_id = ?
          AND assignment_fingerprint <> ?
          AND status IN ('queued', 'processing', 'review_ready', 'partial_failure')`,
        args: [now, now, teacherEmail, assignmentId, assignmentFingerprint],
      });
      const active = await transaction.execute({
        sql: `SELECT id FROM ai_grading_batches
        WHERE teacher_email = ?
          AND assignment_id = ?
          AND assignment_fingerprint = ?
          AND status IN ('queued', 'processing', 'review_ready', 'partial_failure')
        ORDER BY created_at DESC
        LIMIT 1`,
        args: [teacherEmail, assignmentId, assignmentFingerprint],
      });
      if (active.rows[0]) {
        batchId = toStringValue(active.rows[0].id);
        await transaction.commit();
      } else {
        const eligible = await transaction.execute({
          sql: `SELECT
            s.id as submissionId,
            CASE WHEN EXISTS (
              SELECT 1
              FROM submission_transcripts st
              JOIN ai_review_allowance_reservations_v1 reservation
                ON LOWER(reservation.teacher_email) = LOWER(st.teacher_email)
                AND reservation.semantic_key = st.semantic_key
                AND reservation.status = 'consumed'
              WHERE st.submission_id = s.id
                AND LOWER(st.teacher_email) = LOWER(?)
                AND st.assignment_fingerprint = ?
                AND TRIM(st.transcript) <> ''
            ) THEN 0 ELSE 1 END as needsUnit
            , CASE WHEN EXISTS (
              SELECT 1
              FROM submission_transcripts st
              WHERE st.submission_id = s.id
                AND LOWER(st.teacher_email) = LOWER(?)
                AND TRIM(st.transcript) <> ''
            ) THEN 0 ELSE 1 END as needsTranscript
          FROM submissions s
          JOIN assignments a ON a.id = s.assignment_id
          JOIN classes c ON c.id = a.class_id
          WHERE a.id = ?
            AND s.grade IS NULL
            AND TRIM(COALESCE(s.feedback, '')) = ''
            AND s.rubric_scores IS NULL
            AND COALESCE(s.audio_blob_url, s.audio_data, '') <> ''
            AND s.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND c.deleted_at IS NULL
            AND LOWER(c.owner_email) = LOWER(?)
            AND NOT EXISTS (
              SELECT 1 FROM ai_grading_attempts ag
              WHERE ag.submission_id = s.id
                AND LOWER(ag.teacher_email) = LOWER(?)
                AND ag.status = 'completed'
                AND ag.delivery_status IN ('delivered', 'not_applicable')
                AND ag.assignment_fingerprint = ?
            )
          ORDER BY s.submitted_at ASC, s.id ASC`,
          args: [
            teacherEmail,
            assignmentFingerprint,
            teacherEmail,
            assignmentId,
            teacherEmail,
            teacherEmail,
            assignmentFingerprint,
          ],
        });
        if (eligible.rows.length === 0 && expectedSubmissionIds.length === 0) {
          await transaction.rollback();
          return { status: "empty", created: false, batch: null };
        }
        const newUnitsRequired = eligible.rows.reduce(
          (sum, row) => sum + toNumber(row.needsUnit),
          0,
        );
        const transcriptsRequired = eligible.rows.reduce(
          (sum, row) => sum + toNumber(row.needsTranscript),
          0,
        );
        const eligibleSubmissionIds = eligible.rows.map((row) =>
          toStringValue(row.submissionId),
        );
        if (
          eligibleSubmissionIds.length !== expectedSubmissionIds.length ||
          eligibleSubmissionIds.some(
            (id, index) => id !== expectedSubmissionIds[index],
          ) ||
          newUnitsRequired !== expectedNewUnitsRequired ||
          transcriptsRequired !== expectedTranscriptsRequired
        ) {
          await transaction.rollback();
          return { status: "scope_changed", created: false, batch: null };
        }
        batchId = makeId("aib");
        await transaction.execute({
          sql: `INSERT INTO ai_grading_batches (
            id, teacher_email, assignment_id, idempotency_key,
            assignment_fingerprint, status, eligible_count,
            new_units_required, transcripts_required, enhanced, created_at, updated_at,
            completed_at, saved_at
          ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, NULL, NULL)`,
          args: [
            batchId,
            teacherEmail,
            assignmentId,
            idempotencyKey,
            assignmentFingerprint,
            eligible.rows.length,
            newUnitsRequired,
            transcriptsRequired,
            input.enhanced === true ? 1 : 0,
            now,
            now,
          ],
        });
        for (const [ordinal, row] of eligible.rows.entries()) {
          await transaction.execute({
            sql: `INSERT INTO ai_grading_batch_items (
              id, batch_id, submission_id, ordinal, status, attempt_id,
              draft_grade, draft_rubric_scores, draft_feedback,
              teacher_edited, error_code, error_message, retry_count,
              lease_token, lease_expires_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'queued', NULL, NULL, NULL, '', 0, '', '', 0, '', 0, ?, ?)`,
            args: [
              makeId("aibi"),
              batchId,
              toStringValue(row.submissionId),
              ordinal,
              now,
              now,
            ],
          });
        }
        created = true;
        await transaction.commit();
      }
    }
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    if (isUniqueConstraintError(error)) {
      raced = true;
    } else {
      throw error;
    }
  } finally {
    transaction.close();
  }

  if (raced) {
    const idempotent = await query(
      `SELECT id FROM ai_grading_batches
      WHERE teacher_email = ? AND assignment_id = ?
        AND (idempotency_key = ? OR (
          assignment_fingerprint = ?
          AND status IN ('queued', 'processing', 'review_ready', 'partial_failure')
        ))
      ORDER BY CASE WHEN idempotency_key = ? THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1`,
      [
        teacherEmail,
        assignmentId,
        idempotencyKey,
        assignmentFingerprint,
        idempotencyKey,
      ],
    );
    batchId = toStringValue(idempotent.rows[0]?.id).trim();
    if (!batchId) throw new Error("Concurrent AI grading batch creation did not converge.");
    created = false;
  }
  const batch = await findAiGradingBatchForOwner(batchId, teacherEmail);
  if (!batch) throw new Error("AI grading batch could not be read after creation.");
  return { status: "ready", created, batch };
}

export async function createOrResumeAiGradingBatch(input: {
  assignmentId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
  idempotencyKey: string;
  expectedSubmissionIds: string[];
  newUnitsRequired: number;
  transcriptsRequired: number;
  enhanced?: boolean;
  now?: number;
}): Promise<CreateOrResumeAiGradingBatchResult> {
  const preceding = aiGradingBatchCreateQueue;
  let releaseQueue!: () => void;
  aiGradingBatchCreateQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await preceding;
  try {
    return await createOrResumeAiGradingBatchAtomic(input);
  } finally {
    releaseQueue();
  }
}

export type ClaimNextAiGradingBatchItemResult =
  | { status: "claimed"; item: ClaimedAiGradingBatchItem }
  | { status: "done" | "not_found" | "assignment_changed"; item: null };

export async function claimNextAiGradingBatchItem(input: {
  batchId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
  retryFailed?: boolean;
  now?: number;
}): Promise<ClaimNextAiGradingBatchItemResult> {
  const batchId = requireTrimmedValue("batchId", input.batchId);
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const assignmentFingerprint = requireTrimmedValue(
    "assignmentFingerprint",
    input.assignmentFingerprint,
  );
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await reconcileDeletedAiGradingBatchItems({ batchId, teacherEmail, now });
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const found = await transaction.execute({
      sql: `SELECT b.assignment_fingerprint as assignmentFingerprint,
        b.status as status, b.enhanced as enhanced
      FROM ai_grading_batches b
      JOIN assignments a ON a.id = b.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE b.id = ?
        AND LOWER(b.teacher_email) = LOWER(?)
        AND LOWER(c.owner_email) = LOWER(?)
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM ai_grading_batch_items visible_item
          JOIN submissions visible_submission
            ON visible_submission.id = visible_item.submission_id
          WHERE visible_item.batch_id = b.id
            AND visible_submission.deleted_at IS NULL
        )
      LIMIT 1`,
      args: [batchId, teacherEmail, teacherEmail],
    });
    const batch = found.rows[0];
    if (!batch) {
      await transaction.rollback();
      return { status: "not_found", item: null };
    }
    if (toStringValue(batch.assignmentFingerprint) !== assignmentFingerprint) {
      await transaction.execute({
        sql: `UPDATE ai_grading_batches
        SET status = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?)
        WHERE id = ? AND status NOT IN ('saved', 'cancelled')`,
        args: [now, now, batchId],
      });
      await transaction.commit();
      return { status: "assignment_changed", item: null };
    }
    const status = normalizeAiGradingBatchStatus(batch.status);
    if (status === "saved" || status === "cancelled") {
      await transaction.commit();
      return { status: "done", item: null };
    }
    await transaction.execute({
      sql: `UPDATE ai_grading_batch_items
      SET status = 'queued', lease_token = '', lease_expires_at = 0,
          error_code = 'lease_expired',
          error_message = 'The previous grading request ended before it could confirm a result.',
          updated_at = ?
      WHERE batch_id = ?
        AND status = 'processing'
        AND lease_expires_at <= ?`,
      args: [now, batchId, now],
    });
    let candidate = await transaction.execute({
      sql: `SELECT i.id, i.submission_id as submissionId, i.status
      FROM ai_grading_batch_items i
      JOIN submissions s ON s.id = i.submission_id
      WHERE i.batch_id = ? AND i.status = 'queued' AND s.deleted_at IS NULL
      ORDER BY ordinal ASC
      LIMIT 1`,
      args: [batchId],
    });
    if (!candidate.rows[0] && input.retryFailed) {
      candidate = await transaction.execute({
        sql: `SELECT i.id, i.submission_id as submissionId, i.status
        FROM ai_grading_batch_items i
        JOIN submissions s ON s.id = i.submission_id
        WHERE i.batch_id = ? AND i.status = 'failed' AND s.deleted_at IS NULL
        ORDER BY retry_count ASC, ordinal ASC
        LIMIT 1`,
        args: [batchId],
      });
    }
    const row = candidate.rows[0];
    if (!row) {
      await refreshAiGradingBatchStatusInTransaction(transaction, batchId, now);
      await transaction.commit();
      return { status: "done", item: null };
    }
    const previousStatus = normalizeAiGradingBatchItemStatus(row.status);
    const leaseToken = crypto.randomUUID();
    const claimed = await transaction.execute({
      sql: `UPDATE ai_grading_batch_items
      SET status = 'processing', lease_token = ?, lease_expires_at = ?,
          retry_count = retry_count + ?, error_code = '', error_message = '',
          updated_at = ?
      WHERE id = ? AND batch_id = ? AND status = ?`,
      args: [
        leaseToken,
        now + AI_GRADING_BATCH_ITEM_LEASE_MS,
        previousStatus === "failed" ? 1 : 0,
        now,
        toStringValue(row.id),
        batchId,
        previousStatus,
      ],
    });
    if (toNumber(claimed.rowsAffected) !== 1) {
      await transaction.rollback();
      return { status: "done", item: null };
    }
    await transaction.execute({
      sql: `UPDATE ai_grading_batches
      SET status = 'processing', updated_at = ?, completed_at = NULL
      WHERE id = ? AND status NOT IN ('saved', 'cancelled')`,
      args: [now, batchId],
    });
    await transaction.commit();
    return {
      status: "claimed",
      item: {
        batchId,
        itemId: toStringValue(row.id),
        submissionId: toStringValue(row.submissionId),
        leaseToken,
        enhanced: toNumber(batch.enhanced) === 1,
      },
    };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function markAiGradingBatchItemFailed(input: {
  itemId: string;
  leaseToken: string;
  teacherEmail: string;
  status: "failed" | "skipped" | "conflict";
  errorCode: string;
  errorMessage: string;
  now?: number;
}): Promise<boolean> {
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const updated = await transaction.execute({
      sql: `UPDATE ai_grading_batch_items
      SET status = ?, attempt_id = NULL, error_code = ?, error_message = ?,
          lease_token = '', lease_expires_at = 0, updated_at = ?
      WHERE id = ?
        AND status = 'processing'
        AND lease_token = ?
        AND EXISTS (
          SELECT 1 FROM ai_grading_batches b
          JOIN assignments a ON a.id = b.assignment_id
          JOIN classes c ON c.id = a.class_id
          WHERE b.id = ai_grading_batch_items.batch_id
            AND LOWER(b.teacher_email) = LOWER(?)
            AND LOWER(c.owner_email) = LOWER(?)
            AND a.deleted_at IS NULL
            AND c.deleted_at IS NULL
        )`,
      args: [
        input.status,
        input.errorCode.trim().slice(0, 80),
        input.errorMessage.trim().slice(0, 500),
        now,
        requireTrimmedValue("itemId", input.itemId),
        requireTrimmedValue("leaseToken", input.leaseToken),
        teacherEmail,
        teacherEmail,
      ],
    });
    if (toNumber(updated.rowsAffected) !== 1) {
      await transaction.rollback();
      return false;
    }
    const batch = await transaction.execute({
      sql: `SELECT batch_id as batchId FROM ai_grading_batch_items WHERE id = ? LIMIT 1`,
      args: [input.itemId],
    });
    await refreshAiGradingBatchStatusInTransaction(
      transaction,
      toStringValue(batch.rows[0]?.batchId),
      now,
    );
    await transaction.commit();
    return true;
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export type StageAiGradingAttemptForBatchReviewResult =
  | { status: "staged"; itemStatus: "review_ready" | "skipped" }
  | {
      status: "not_staged";
      reason:
        | "not_found"
        | "attempt_ineligible"
        | "assignment_changed"
        | "submission_changed"
        | "allowance_unavailable";
    };

/**
 * Delivers an AI result into a durable teacher-only batch draft. The AI attempt,
 * processed-recording allowance, durable transcript, and batch item transition
 * share one transaction; the student-visible submission is never updated here.
 */
export async function stageAiGradingAttemptForBatchReview(input: {
  batchItemId: string;
  leaseToken: string;
  attemptId: string;
  ownerEmail: string;
  reviewReservationId?: string;
  allowWithoutReservation: boolean;
}): Promise<StageAiGradingAttemptForBatchReviewResult> {
  const itemId = requireTrimmedValue("batchItemId", input.batchItemId);
  const leaseToken = requireTrimmedValue("leaseToken", input.leaseToken);
  const attemptId = requireTrimmedValue("attemptId", input.attemptId);
  const ownerEmail = normalizeBillingTeacherEmail(input.ownerEmail);
  const reviewReservationId = input.reviewReservationId?.trim() || null;
  const readyStripeScope = reviewReservationId
    ? await getReadyStripeSubscriptionScope()
    : null;
  const now = Date.now();
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  const reject = async (
    reason: Extract<
      StageAiGradingAttemptForBatchReviewResult,
      { status: "not_staged" }
    >["reason"],
  ): Promise<StageAiGradingAttemptForBatchReviewResult> => {
    if (!transaction.closed) await transaction.rollback();
    return { status: "not_staged", reason };
  };
  try {
    const result = await transaction.execute({
      sql: `SELECT
        i.batch_id as batchId,
        i.submission_id as itemSubmissionId,
        i.status as itemStatus,
        i.lease_token as leaseToken,
        b.assignment_fingerprint as batchAssignmentFingerprint,
        b.status as batchStatus,
        ag.submission_id as submissionId,
        ag.status as status,
        ag.delivery_status as deliveryStatus,
        ag.assignment_fingerprint as assignmentFingerprint,
        ag.cache_key as cacheKey,
        ag.suggested_score as suggestedScore,
        ag.rubric_scores as attemptRubricScores,
        ag.feedback as feedback,
        ag.teacher_attention as teacherAttention,
        ag.error_code as errorCode,
        ag.billing_required as billingRequired,
        s.grade as finalGrade,
        COALESCE(s.feedback, '') as finalFeedback,
        s.rubric_scores as finalRubricScores,
        a.id as assignmentId,
        a.title as assignmentTitle,
        COALESCE(a.description, '') as assignmentDescription,
        a.instructions as assignmentInstructions,
        COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as assignmentTargetLanguage,
        COALESCE(a.max_points, 100) as assignmentMaxPoints,
        a.rubric as assignmentRubric,
        EXISTS (
          SELECT 1 FROM ai_review_allowance_reservations_v1 reservation
          WHERE LOWER(reservation.teacher_email) = LOWER(?)
            AND reservation.semantic_key = ag.cache_key
            AND reservation.status = 'consumed'
        ) as alreadyConsumed
      FROM ai_grading_batch_items i
      JOIN ai_grading_batches b ON b.id = i.batch_id
      JOIN ai_grading_attempts ag ON ag.id = ?
      JOIN submissions s ON s.id = i.submission_id
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE i.id = ?
        AND LOWER(b.teacher_email) = LOWER(?)
        AND LOWER(ag.teacher_email) = LOWER(?)
        AND LOWER(c.owner_email) = LOWER(?)
        AND a.id = b.assignment_id
        AND s.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      LIMIT 1`,
      args: [ownerEmail, attemptId, itemId, ownerEmail, ownerEmail, ownerEmail],
    });
    const row = result.rows[0];
    if (!row) return await reject("not_found");
    if (
      toStringValue(row.itemStatus) !== "processing" ||
      toStringValue(row.leaseToken) !== leaseToken ||
      toStringValue(row.itemSubmissionId) !== toStringValue(row.submissionId) ||
      toStringValue(row.status) !== "completed" ||
      toStringValue(row.deliveryStatus) !== "pending" ||
      toStringValue(row.errorCode).trim() ||
      toNumber(row.billingRequired) !== 0 ||
      ["saved", "cancelled"].includes(toStringValue(row.batchStatus))
    ) {
      return await reject("attempt_ineligible");
    }
    const attemptFingerprint = toStringValue(row.assignmentFingerprint).trim();
    if (
      !attemptFingerprint ||
      attemptFingerprint !== toStringValue(row.batchAssignmentFingerprint) ||
      attemptFingerprint !== assignmentFingerprintFromAttemptDeliveryRow(row)
    ) {
      return await reject("assignment_changed");
    }
    if (
      row.finalGrade !== null ||
      toStringValue(row.finalFeedback).trim() ||
      row.finalRubricScores !== null
    ) {
      return await reject("submission_changed");
    }
    if (
      !reviewReservationId &&
      !input.allowWithoutReservation &&
      toNumber(row.alreadyConsumed) !== 1
    ) {
      return await reject("allowance_unavailable");
    }
    const delivery = await transaction.execute({
      sql: `UPDATE ai_grading_attempts
      SET delivery_status = 'not_applicable'
      WHERE id = ?
        AND LOWER(teacher_email) = LOWER(?)
        AND status = 'completed'
        AND delivery_status = 'pending'
        AND billing_required = 0`,
      args: [attemptId, ownerEmail],
    });
    if (toNumber(delivery.rowsAffected) !== 1) {
      return await reject("attempt_ineligible");
    }
    if (reviewReservationId) {
      const consumed = await consumeAiReviewReservationInTransaction({
        transaction,
        reservationId: reviewReservationId,
        teacherEmail: ownerEmail,
        attemptId,
        readyStripeScope,
        now,
      });
      if (!consumed) return await reject("allowance_unavailable");
    }
    const suggestedScore = toNullableNumber(row.suggestedScore);
    const itemStatus: "review_ready" | "skipped" =
      suggestedScore === null ||
      toStringValue(row.teacherAttention) === "unable_to_grade"
        ? "skipped"
        : "review_ready";
    const staged = await transaction.execute({
      sql: `UPDATE ai_grading_batch_items
      SET status = ?, attempt_id = ?, draft_grade = ?,
          draft_rubric_scores = CASE WHEN ? IS NULL THEN NULL ELSE ? END,
          draft_feedback = ?, teacher_edited = 0,
          error_code = CASE WHEN ? = 'skipped' THEN 'unable_to_grade' ELSE '' END,
          error_message = CASE WHEN ? = 'skipped'
            THEN 'AI could not produce a score; grade this submission manually.' ELSE '' END,
          lease_token = '', lease_expires_at = 0, updated_at = ?
      WHERE id = ? AND status = 'processing' AND lease_token = ?`,
      args: [
        itemStatus,
        attemptId,
        suggestedScore,
        row.assignmentRubric,
        row.attemptRubricScores,
        toStringValue(row.feedback),
        itemStatus,
        itemStatus,
        now,
        itemId,
        leaseToken,
      ],
    });
    if (toNumber(staged.rowsAffected) !== 1) {
      return await reject("attempt_ineligible");
    }
    await refreshAiGradingBatchStatusInTransaction(
      transaction,
      toStringValue(row.batchId),
      now,
    );
    await transaction.commit();
    return { status: "staged", itemStatus };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export type SaveAiGradingBatchItemInput = {
  itemId: string;
  grade: number;
  feedback: string;
  rubricScores: RubricScore[] | null;
};

export type SaveAiGradingBatchResult =
  | { status: "saved" | "already_saved"; batchId: string }
  | { status: "not_found" | "assignment_changed"; batchId: string }
  | {
      status: "not_ready" | "invalid";
      batchId: string;
      message: string;
    }
  | {
      status: "submission_changed";
      batchId: string;
      conflictItemIds: string[];
    };

function normalizeBatchSaveItem(
  value: SaveAiGradingBatchItemInput,
  rubric: Rubric | null,
  maxPoints: number,
):
  | { ok: true; grade: number; feedback: string; rubricScores: RubricScore[] | null }
  | { ok: false; message: string } {
  if (!value || typeof value.itemId !== "string" || !value.itemId.trim()) {
    return { ok: false, message: "Every saved suggestion needs an item id." };
  }
  if (
    !Number.isSafeInteger(value.grade) ||
    value.grade < 0 ||
    value.grade > maxPoints
  ) {
    return {
      ok: false,
      message: `Every score must be a whole number from 0 to ${maxPoints}.`,
    };
  }
  if (typeof value.feedback !== "string") {
    return { ok: false, message: "Feedback must be text." };
  }
  const feedback = value.feedback.trim();
  if (feedback.length > LIMITS.feedbackMax) {
    return {
      ok: false,
      message: `Feedback must be ${LIMITS.feedbackMax} characters or fewer.`,
    };
  }
  if (/<[^>]*>|<\/?\s*script\b/i.test(feedback)) {
    return { ok: false, message: "Feedback cannot contain HTML or script content." };
  }

  if (!rubric) {
    if (Array.isArray(value.rubricScores) && value.rubricScores.length > 0) {
      return {
        ok: false,
        message: "This assignment does not use rubric grading.",
      };
    }
    return { ok: true, grade: value.grade, feedback, rubricScores: null };
  }
  if (
    !Array.isArray(value.rubricScores) ||
    value.rubricScores.length !== rubric.criteria.length
  ) {
    return {
      ok: false,
      message: "Rubric scores must include every rubric criterion.",
    };
  }
  const provided = new Map<string, RubricScore>();
  for (const score of value.rubricScores) {
    if (!score || typeof score.criterionId !== "string" || provided.has(score.criterionId)) {
      return { ok: false, message: "Rubric criterion ids must be unique." };
    }
    provided.set(score.criterionId, score);
  }
  const rubricScores: RubricScore[] = [];
  for (const criterion of rubric.criteria) {
    const criterionId = String(criterion.id);
    const score = provided.get(criterionId);
    if (
      !score ||
      !Number.isSafeInteger(score.awarded) ||
      score.awarded < 0 ||
      score.awarded > criterion.maxPoints
    ) {
      return {
        ok: false,
        message: `Rubric score for ${criterion.name} must be a whole number from 0 to ${criterion.maxPoints}.`,
      };
    }
    rubricScores.push({
      criterionId,
      criterionName: criterion.name,
      maxPoints: criterion.maxPoints,
      awarded: score.awarded,
    });
  }
  const rubricTotal = rubricScores.reduce((sum, score) => sum + score.awarded, 0);
  if (rubricTotal !== value.grade) {
    return { ok: false, message: "The total score must match the rubric scores." };
  }
  return { ok: true, grade: rubricTotal, feedback, rubricScores };
}

async function markAiGradingBatchSaveConflicts(input: {
  batchId: string;
  teacherEmail: string;
  itemIds: string[];
  now: number;
}) {
  for (const itemId of new Set(input.itemIds.filter(Boolean))) {
    await query(
      `UPDATE ai_grading_batch_items
      SET status = 'conflict', error_code = 'submission_changed',
          error_message = 'This submission was graded or changed outside this batch. The teacher''s saved work was kept.',
          updated_at = ?
      WHERE id = ? AND batch_id = ? AND status = 'review_ready'
        AND EXISTS (
          SELECT 1 FROM ai_grading_batches b
          JOIN assignments a ON a.id = b.assignment_id
          JOIN classes c ON c.id = a.class_id
          WHERE b.id = ai_grading_batch_items.batch_id
            AND LOWER(b.teacher_email) = LOWER(?)
            AND LOWER(c.owner_email) = LOWER(?)
        )`,
      [input.now, itemId, input.batchId, input.teacherEmail, input.teacherEmail],
    );
  }
  await query(
    `UPDATE ai_grading_batches
    SET status = 'partial_failure', updated_at = ?, completed_at = COALESCE(completed_at, ?)
    WHERE id = ? AND LOWER(teacher_email) = LOWER(?)
      AND status NOT IN ('saved', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM ai_grading_batch_items i
        WHERE i.batch_id = ai_grading_batches.id
          AND i.status IN ('queued', 'processing')
      )`,
    [input.now, input.now, input.batchId, input.teacherEmail],
  );
}

/**
 * Publishes one batch review transactionally. Every currently review-ready
 * item must be present, and every target submission must still be completely
 * ungraded. A conflict rolls the entire save back so teacher edits always win.
 */
export async function saveAiGradingBatch(input: {
  batchId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
  items: SaveAiGradingBatchItemInput[];
  now?: number;
}): Promise<SaveAiGradingBatchResult> {
  const batchId = requireTrimmedValue("batchId", input.batchId);
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const expectedFingerprint = requireTrimmedValue(
    "assignmentFingerprint",
    input.assignmentFingerprint,
  );
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await reconcileDeletedAiGradingBatchItems({ batchId, teacherEmail, now });
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const batchResult = await transaction.execute({
      sql: `SELECT b.status as status,
        b.assignment_fingerprint as assignmentFingerprint,
        a.id as assignmentId,
        a.title as assignmentTitle,
        COALESCE(a.description, '') as assignmentDescription,
        a.instructions as assignmentInstructions,
        COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as assignmentTargetLanguage,
        COALESCE(a.max_points, 100) as assignmentMaxPoints,
        a.rubric as assignmentRubric
      FROM ai_grading_batches b
      JOIN assignments a ON a.id = b.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE b.id = ?
        AND LOWER(b.teacher_email) = LOWER(?)
        AND LOWER(c.owner_email) = LOWER(?)
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      LIMIT 1`,
      args: [batchId, teacherEmail, teacherEmail],
    });
    const batch = batchResult.rows[0];
    if (!batch) {
      await transaction.rollback();
      return { status: "not_found", batchId };
    }
    if (normalizeAiGradingBatchStatus(batch.status) === "saved") {
      await transaction.commit();
      return { status: "already_saved", batchId };
    }
    if (normalizeAiGradingBatchStatus(batch.status) === "cancelled") {
      await transaction.rollback();
      return { status: "assignment_changed", batchId };
    }
    const currentFingerprint = assignmentFingerprintFromAttemptDeliveryRow({
      submissionId: "",
      assignmentId: batch.assignmentId,
      assignmentTitle: batch.assignmentTitle,
      assignmentDescription: batch.assignmentDescription,
      assignmentInstructions: batch.assignmentInstructions,
      assignmentTargetLanguage: batch.assignmentTargetLanguage,
      assignmentMaxPoints: batch.assignmentMaxPoints,
      assignmentRubric: batch.assignmentRubric,
    } as unknown as Row);
    if (
      !currentFingerprint ||
      currentFingerprint !== expectedFingerprint ||
      currentFingerprint !== toStringValue(batch.assignmentFingerprint)
    ) {
      await transaction.execute({
        sql: `UPDATE ai_grading_batches
        SET status = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?)
        WHERE id = ? AND status NOT IN ('saved', 'cancelled')`,
        args: [now, now, batchId],
      });
      await transaction.commit();
      return { status: "assignment_changed", batchId };
    }

    const rowsResult = await transaction.execute({
      sql: `SELECT i.id as itemId, i.submission_id as submissionId,
        i.status as itemStatus, i.attempt_id as attemptId,
        i.draft_grade as draftGrade, i.draft_rubric_scores as draftRubricScores,
        i.draft_feedback as draftFeedback,
        ag.suggested_score as suggestedScore,
        ag.rubric_scores as attemptRubricScores,
        ag.feedback as attemptFeedback,
        ag.assignment_fingerprint as attemptAssignmentFingerprint,
        ag.status as attemptStatus,
        ag.delivery_status as attemptDeliveryStatus,
        s.grade as finalGrade,
        COALESCE(s.feedback, '') as finalFeedback,
        s.rubric_scores as finalRubricScores
      FROM ai_grading_batch_items i
      JOIN submissions s ON s.id = i.submission_id
      LEFT JOIN ai_grading_attempts ag ON ag.id = i.attempt_id
      WHERE i.batch_id = ?
      ORDER BY i.ordinal ASC`,
      args: [batchId],
    });
    const rows = rowsResult.rows;
    if (rows.some((row) => ["queued", "processing"].includes(toStringValue(row.itemStatus)))) {
      await transaction.rollback();
      return {
        status: "not_ready",
        batchId,
        message: "AI suggestions are still being prepared.",
      };
    }
    const readyRows = rows.filter(
      (row) => toStringValue(row.itemStatus) === "review_ready",
    );
    if (readyRows.length === 0) {
      await transaction.rollback();
      return {
        status: "not_ready",
        batchId,
        message: "There are no unsaved AI suggestions in this batch.",
      };
    }
    if (!Array.isArray(input.items) || input.items.length !== readyRows.length) {
      await transaction.rollback();
      return {
        status: "invalid",
        batchId,
        message: "Save every review-ready suggestion together.",
      };
    }
    const payloadById = new Map<string, SaveAiGradingBatchItemInput>();
    for (const value of input.items) {
      const id = typeof value?.itemId === "string" ? value.itemId.trim() : "";
      if (!id || payloadById.has(id)) {
        await transaction.rollback();
        return {
          status: "invalid",
          batchId,
          message: "Each batch item must appear exactly once.",
        };
      }
      payloadById.set(id, value);
    }
    const readyIds = new Set(readyRows.map((row) => toStringValue(row.itemId)));
    if ([...payloadById.keys()].some((id) => !readyIds.has(id))) {
      await transaction.rollback();
      return {
        status: "invalid",
        batchId,
        message: "The save included an item that is not ready for review.",
      };
    }
    const rubric = parseJsonValue<Rubric>(batch.assignmentRubric);
    const maxPoints = toNumber(batch.assignmentMaxPoints);
    const normalized = new Map<
      string,
      { grade: number; feedback: string; rubricScores: RubricScore[] | null }
    >();
    for (const row of readyRows) {
      const itemId = toStringValue(row.itemId);
      const value = payloadById.get(itemId)!;
      const parsed = normalizeBatchSaveItem(value, rubric, maxPoints);
      if (!parsed.ok) {
        await transaction.rollback();
        return { status: "invalid", batchId, message: parsed.message };
      }
      normalized.set(itemId, parsed);
    }

    const conflictItemIds = readyRows
      .filter(
        (row) =>
          row.finalGrade !== null ||
          toStringValue(row.finalFeedback).trim() !== "" ||
          row.finalRubricScores !== null ||
          toStringValue(row.attemptStatus) !== "completed" ||
          toStringValue(row.attemptDeliveryStatus) !== "not_applicable" ||
          toStringValue(row.attemptAssignmentFingerprint) !== currentFingerprint,
      )
      .map((row) => toStringValue(row.itemId));
    if (conflictItemIds.length > 0) {
      await transaction.rollback();
      await markAiGradingBatchSaveConflicts({
        batchId,
        teacherEmail,
        itemIds: conflictItemIds,
        now,
      });
      return { status: "submission_changed", batchId, conflictItemIds };
    }

    for (const row of readyRows) {
      const itemId = toStringValue(row.itemId);
      const value = normalized.get(itemId)!;
      const updated = await transaction.execute({
        sql: `UPDATE submissions
        SET grade = ?, feedback = ?, rubric_scores = ?, grade_source = 'teacher'
        WHERE id = ?
          AND deleted_at IS NULL
          AND grade IS NULL
          AND TRIM(COALESCE(feedback, '')) = ''
          AND rubric_scores IS NULL
          AND EXISTS (
            SELECT 1 FROM assignments a
            JOIN classes c ON c.id = a.class_id
            WHERE a.id = submissions.assignment_id
              AND a.id = ?
              AND a.deleted_at IS NULL
              AND c.deleted_at IS NULL
              AND LOWER(c.owner_email) = LOWER(?)
          )`,
        args: [
          value.grade,
          value.feedback,
          stringifyJsonValue(value.rubricScores),
          toStringValue(row.submissionId),
          toStringValue(batch.assignmentId),
          teacherEmail,
        ],
      });
      if (toNumber(updated.rowsAffected) !== 1) {
        await transaction.rollback();
        await markAiGradingBatchSaveConflicts({
          batchId,
          teacherEmail,
          itemIds: [itemId],
          now,
        });
        return { status: "submission_changed", batchId, conflictItemIds: [itemId] };
      }
      const teacherEdited =
        value.grade !== toNullableNumber(row.suggestedScore) ||
        value.feedback !== toStringValue(row.attemptFeedback).trim() ||
        stringifyJsonValue(value.rubricScores) !==
          stringifyJsonValue(
            rubric
              ? parseJsonValue<RubricScore[]>(row.attemptRubricScores)
              : null,
          );
      const itemUpdated = await transaction.execute({
        sql: `UPDATE ai_grading_batch_items
        SET status = 'saved', draft_grade = ?, draft_rubric_scores = ?,
            draft_feedback = ?, teacher_edited = ?, error_code = '',
            error_message = '', updated_at = ?
        WHERE id = ? AND batch_id = ? AND status = 'review_ready'`,
        args: [
          value.grade,
          stringifyJsonValue(value.rubricScores),
          value.feedback,
          teacherEdited ? 1 : 0,
          now,
          itemId,
          batchId,
        ],
      });
      if (toNumber(itemUpdated.rowsAffected) !== 1) {
        await transaction.rollback();
        await markAiGradingBatchSaveConflicts({
          batchId,
          teacherEmail,
          itemIds: [itemId],
          now,
        });
        return { status: "submission_changed", batchId, conflictItemIds: [itemId] };
      }
    }

    const remaining = await transaction.execute({
      sql: `SELECT COUNT(*) as count
      FROM ai_grading_batch_items
      WHERE batch_id = ? AND status IN ('queued', 'processing', 'review_ready')`,
      args: [batchId],
    });
    if (toNumber(remaining.rows[0]?.count) === 0) {
      await transaction.execute({
        sql: `UPDATE ai_grading_batches
        SET status = 'saved', updated_at = ?, completed_at = COALESCE(completed_at, ?), saved_at = ?
        WHERE id = ? AND status NOT IN ('saved', 'cancelled')`,
        args: [now, now, now, batchId],
      });
    } else {
      await refreshAiGradingBatchStatusInTransaction(transaction, batchId, now);
    }
    await transaction.commit();
    return { status: "saved", batchId };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export type CloseAiGradingBatchResult =
  | { status: "closed" | "already_closed"; batchId: string }
  | {
      status: "not_found" | "not_terminal" | "has_review_ready";
      batchId: string;
    };

/**
 * Closes a terminal exception-only batch so it cannot wedge the assignment's
 * active-batch uniqueness guard. Review-ready paid work cannot be discarded;
 * the teacher must save it (or supersede it with a manual grade) first.
 */
export async function closeAiGradingBatch(input: {
  batchId: string;
  teacherEmail: string;
  now?: number;
}): Promise<CloseAiGradingBatchResult> {
  const batchId = requireTrimmedValue("batchId", input.batchId);
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const now = requireNonNegativeInteger("now", input.now ?? Date.now());
  await reconcileDeletedAiGradingBatchItems({ batchId, teacherEmail, now });
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const result = await transaction.execute({
      sql: `SELECT b.status as status,
        SUM(CASE WHEN i.status IN ('queued', 'processing') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN i.status = 'review_ready' THEN 1 ELSE 0 END) as reviewReady
      FROM ai_grading_batches b
      JOIN assignments a ON a.id = b.assignment_id
      JOIN classes c ON c.id = a.class_id
      JOIN ai_grading_batch_items i ON i.batch_id = b.id
      WHERE b.id = ?
        AND LOWER(b.teacher_email) = LOWER(?)
        AND LOWER(c.owner_email) = LOWER(?)
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      GROUP BY b.id, b.status
      LIMIT 1`,
      args: [batchId, teacherEmail, teacherEmail],
    });
    const row = result.rows[0];
    if (!row) {
      await transaction.rollback();
      return { status: "not_found", batchId };
    }
    const current = normalizeAiGradingBatchStatus(row.status);
    if (current === "saved" || current === "cancelled") {
      await transaction.commit();
      return { status: "already_closed", batchId };
    }
    if (toNumber(row.pending) > 0) {
      await transaction.rollback();
      return { status: "not_terminal", batchId };
    }
    if (toNumber(row.reviewReady) > 0) {
      await transaction.rollback();
      return { status: "has_review_ready", batchId };
    }
    const closed = await transaction.execute({
      sql: `UPDATE ai_grading_batches
      SET status = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?)
      WHERE id = ? AND LOWER(teacher_email) = LOWER(?)
        AND status IN ('review_ready', 'partial_failure')`,
      args: [now, now, batchId, teacherEmail],
    });
    if (toNumber(closed.rowsAffected) !== 1) {
      await transaction.rollback();
      return { status: "not_terminal", batchId };
    }
    await transaction.commit();
    return { status: "closed", batchId };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export type SaveAiGradingBatchDraftResult =
  | { status: "updated"; batchId: string; itemIds: string[] }
  | { status: "not_found" | "assignment_changed" | "not_ready"; batchId: string }
  | { status: "invalid"; batchId: string; message: string };

/**
 * Persists private teacher edits to review-ready batch items. This operation
 * intentionally updates only the three draft columns: it never publishes a
 * submission grade, transitions lifecycle state, or touches AI allowance.
 */
export async function saveAiGradingBatchDraft(input: {
  batchId: string;
  teacherEmail: string;
  assignmentFingerprint: string;
  items: SaveAiGradingBatchItemInput[];
}): Promise<SaveAiGradingBatchDraftResult> {
  const batchId = requireTrimmedValue("batchId", input.batchId);
  const teacherEmail = normalizeBillingTeacherEmail(input.teacherEmail);
  const expectedFingerprint = requireTrimmedValue(
    "assignmentFingerprint",
    input.assignmentFingerprint,
  );
  await ensureInitialized();
  const transaction = await getDbClient().transaction("write");
  try {
    const batchResult = await transaction.execute({
      sql: `SELECT b.status as status,
        b.assignment_fingerprint as assignmentFingerprint,
        a.id as assignmentId,
        a.title as assignmentTitle,
        COALESCE(a.description, '') as assignmentDescription,
        a.instructions as assignmentInstructions,
        COALESCE(NULLIF(TRIM(a.target_language), ''), 'Spanish') as assignmentTargetLanguage,
        COALESCE(a.max_points, 100) as assignmentMaxPoints,
        a.rubric as assignmentRubric
      FROM ai_grading_batches b
      JOIN assignments a ON a.id = b.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE b.id = ?
        AND LOWER(b.teacher_email) = LOWER(?)
        AND LOWER(c.owner_email) = LOWER(?)
        AND a.deleted_at IS NULL
        AND c.deleted_at IS NULL
      LIMIT 1`,
      args: [batchId, teacherEmail, teacherEmail],
    });
    const batch = batchResult.rows[0];
    if (!batch) {
      await transaction.rollback();
      return { status: "not_found", batchId };
    }
    if (!["review_ready", "partial_failure"].includes(
      normalizeAiGradingBatchStatus(batch.status),
    )) {
      await transaction.rollback();
      return { status: "not_ready", batchId };
    }

    const currentFingerprint = assignmentFingerprintFromAttemptDeliveryRow({
      submissionId: "",
      assignmentId: batch.assignmentId,
      assignmentTitle: batch.assignmentTitle,
      assignmentDescription: batch.assignmentDescription,
      assignmentInstructions: batch.assignmentInstructions,
      assignmentTargetLanguage: batch.assignmentTargetLanguage,
      assignmentMaxPoints: batch.assignmentMaxPoints,
      assignmentRubric: batch.assignmentRubric,
    } as unknown as Row);
    if (
      !currentFingerprint ||
      currentFingerprint !== expectedFingerprint ||
      currentFingerprint !== toStringValue(batch.assignmentFingerprint)
    ) {
      await transaction.rollback();
      return { status: "assignment_changed", batchId };
    }

    if (!Array.isArray(input.items) || input.items.length === 0) {
      await transaction.rollback();
      return {
        status: "invalid",
        batchId,
        message: "Include at least one valid review draft.",
      };
    }

    const payloadById = new Map<string, SaveAiGradingBatchItemInput>();
    for (const value of input.items) {
      const itemId = typeof value?.itemId === "string" ? value.itemId.trim() : "";
      if (!itemId || payloadById.has(itemId)) {
        await transaction.rollback();
        return {
          status: "invalid",
          batchId,
          message: "Each review draft must include one unique item id.",
        };
      }
      payloadById.set(itemId, value);
    }

    const itemResult = await transaction.execute({
      sql: `SELECT id, status
      FROM ai_grading_batch_items
      WHERE batch_id = ?`,
      args: [batchId],
    });
    const reviewReadyIds = new Set(
      itemResult.rows
        .filter((row) => toStringValue(row.status) === "review_ready")
        .map((row) => toStringValue(row.id)),
    );
    if ([...payloadById.keys()].some((itemId) => !reviewReadyIds.has(itemId))) {
      await transaction.rollback();
      return {
        status: "not_ready",
        batchId,
      };
    }

    const rubric = parseJsonValue<Rubric>(batch.assignmentRubric);
    const maxPoints = toNumber(batch.assignmentMaxPoints);
    const normalized = new Map<
      string,
      { grade: number; feedback: string; rubricScores: RubricScore[] | null }
    >();
    for (const [itemId, value] of payloadById) {
      const parsed = normalizeBatchSaveItem(value, rubric, maxPoints);
      if (!parsed.ok) {
        await transaction.rollback();
        return { status: "invalid", batchId, message: parsed.message };
      }
      normalized.set(itemId, parsed);
    }

    for (const [itemId, value] of normalized) {
      const updated = await transaction.execute({
        sql: `UPDATE ai_grading_batch_items
        SET draft_grade = ?, draft_rubric_scores = ?, draft_feedback = ?
        WHERE id = ? AND batch_id = ? AND status = 'review_ready'`,
        args: [
          value.grade,
          stringifyJsonValue(value.rubricScores),
          value.feedback,
          itemId,
          batchId,
        ],
      });
      if (toNumber(updated.rowsAffected) !== 1) {
        await transaction.rollback();
        return { status: "not_ready", batchId };
      }
    }

    await transaction.commit();
    return { status: "updated", batchId, itemIds: [...normalized.keys()] };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

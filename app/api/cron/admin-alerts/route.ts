import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getAdminAlertMilestoneAggregate,
  getAdminAlertOperationalAggregate,
  getAdminAlertOutboxHealthForEnvironment,
  getAdminAlertPeriodAggregate,
  type AdminAlertPeriodAggregate,
} from "@/lib/db";
import {
  deliverPendingAdminAlerts,
  enqueueAdminAlerts,
  isAdminAlertDeliveryEnabled,
  MAX_ADMIN_ALERT_DELIVERY_BATCH,
  resolveAdminAlertOperationalConfig,
  resolveAdminAlertsEnvironment,
  type AdminAlertEnqueueInput,
  type AdminAlertEvent,
  type WeeklyAdminAlertAggregate,
} from "@/lib/admin-alerts";
import { buildAdminMilestoneIntents } from "@/lib/admin-alerts/milestones";
import { getDueAdminAlertWindows } from "@/lib/admin-alerts/schedule";
import { getEnv } from "@/lib/env";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

const MAX_ENQUEUE_BATCH = 20;
const AI_BUDGET_ALERT_THRESHOLDS = [50, 75, 90, 100] as const;

export function getDeploymentReleaseIntent(
  source: Readonly<Record<string, string | undefined>> = process.env,
): AdminAlertEnqueueInput | null {
  const fullCommit = source.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase() || "";
  if (!/^[a-f0-9]{40}$/.test(fullCommit)) return null;
  return {
    event: { type: "release.deployed", commitRef: fullCommit.slice(0, 12) },
    dedupeKey: `release:production:${fullCommit}`,
  };
}

function safeEquals(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function isAuthorized(request: Request) {
  const expected = getEnv().cronSecret;
  if (!expected) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const alternateSecret = request.headers.get("x-cron-secret") ?? "";
  return safeEquals(authorization, `Bearer ${expected}`)
    || safeEquals(alternateSecret, expected);
}

function toWeeklyAggregate(
  aggregate: AdminAlertPeriodAggregate,
): WeeklyAdminAlertAggregate {
  return {
    newTeachers: aggregate.newTeachers,
    activatedTeachers: aggregate.activatedTeachers,
    newPaidTeachers: aggregate.newPaidTeachers,
    eligibleFreeTeachers: aggregate.eligibleFreeTeachers,
    convertedEligibleFreeTeachers: aggregate.convertedEligibleFreeTeachers,
    assignmentsPublished: aggregate.assignmentsPublished,
    recordingsReceived: aggregate.recordingsReceived,
    successfulAiReviews: aggregate.successfulAiReviews,
    aiAttempts: aggregate.aiAttempts,
    aiFailures: aggregate.aiFailures,
    retryCount: aggregate.retryCount,
    durationSampleCount: aggregate.durationSampleCount,
    medianDurationSeconds: aggregate.medianDurationSeconds,
    p90DurationSeconds: aggregate.p90DurationSeconds,
    activePaidTeachers: aggregate.activePaidTeachers,
    mrrCents: aggregate.mrrCents,
    recognizedRevenueCents: aggregate.recognizedRevenueCents,
    cancellations: aggregate.cancellations,
    refundsCents: aggregate.refundsCents,
    failedPayments: aggregate.failedPayments,
    estimatedProviderSpendCents: aggregate.estimatedProviderSpendCents,
    estimatedStripeFeesCents: aggregate.estimatedStripeFeesCents,
    estimatedContributionCents: aggregate.estimatedContributionCents,
    freeTrialsExhausted: aggregate.freeTrialsExhausted,
    nearPaidLimitTeachers: aggregate.nearPaidLimitTeachers,
    paidLimitExhaustedTeachers: aggregate.paidLimitExhaustedTeachers,
    schoolLeads: aggregate.schoolLeads,
  };
}

async function enqueueInBatches(
  inputs: readonly AdminAlertEnqueueInput[],
  now: number,
) {
  let inserted = 0;
  for (let index = 0; index < inputs.length; index += MAX_ENQUEUE_BATCH) {
    const batch = inputs.slice(index, index + MAX_ENQUEUE_BATCH);
    const results = await enqueueAdminAlerts(batch, { now });
    inserted += results.reduce(
      (sum, result) => sum + result.rows.filter((row) => row.inserted).length,
      0,
    );
  }
  return { requested: inputs.length, inserted };
}

function dailyEvent(
  date: string,
  aggregate: AdminAlertPeriodAggregate,
): Extract<AdminAlertEvent, { type: "pulse.daily" }> {
  return {
    type: "pulse.daily",
    date,
    newTeachers: aggregate.newTeachers,
    activatedTeachers: aggregate.activatedTeachers,
    newPaidTeachers: aggregate.newPaidTeachers,
    newMrrCents: aggregate.newMrrCents,
    recordingsReceived: aggregate.recordingsReceived,
    successfulAiReviews: aggregate.successfulAiReviews,
    freeTrialsExhausted: aggregate.freeTrialsExhausted,
    schoolLeads: aggregate.schoolLeads,
    estimatedProviderSpendCents: aggregate.estimatedProviderSpendCents,
    aiAttempts: aggregate.aiAttempts,
    aiFailures: aggregate.aiFailures,
  };
}

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    if (!isAuthorized(request)) {
      throw new HttpError(403, "You don't have access to this page.");
    }

    const now = Date.now();
    try {
      const environment = resolveAdminAlertsEnvironment();
      if (environment !== "production") {
        // Preview and Development can share production infrastructure. Never
        // derive automatic business metrics there; only drain events that were
        // explicitly queued into that non-production environment.
        const delivery = await deliverPendingAdminAlerts({
          limit: MAX_ADMIN_ALERT_DELIVERY_BATCH,
          now,
        });
        const outbox = await getAdminAlertOutboxHealthForEnvironment(environment, now);
        return NextResponse.json(
          {
            ok: true,
            scheduled: {
              dailyDue: false,
              weeklyDue: false,
              requested: 0,
              inserted: 0,
            },
            incidents: { requested: 0, inserted: 0 },
            delivery,
            outbox,
          },
          { headers: { "Cache-Control": "private, no-cache, no-store" } },
        );
      }
      const aggregateScope = {
        environment,
        livemode: true,
      } as const;
      const windows = getDueAdminAlertWindows(now);
      const [
        dailyAggregate,
        weeklyCurrent,
        weeklyPrevious,
        milestoneAggregate,
        operationalAggregate,
      ] =
        await Promise.all([
          windows.daily
            ? getAdminAlertPeriodAggregate({
                ...aggregateScope,
                startAt: windows.daily.startAt,
                endAt: windows.daily.endAt,
              })
            : Promise.resolve(null),
          windows.weekly
            ? getAdminAlertPeriodAggregate({
                ...aggregateScope,
                startAt: windows.weekly.currentStartAt,
                endAt: windows.weekly.currentEndAt,
                snapshotAt: windows.weekly.currentEndAt,
              })
            : Promise.resolve(null),
          windows.weekly
            ? getAdminAlertPeriodAggregate({
                ...aggregateScope,
                startAt: windows.weekly.previousStartAt,
                endAt: windows.weekly.previousEndAt,
                snapshotAt: windows.weekly.previousEndAt,
              })
            : Promise.resolve(null),
          getAdminAlertMilestoneAggregate({ ...aggregateScope, now }),
          getAdminAlertOperationalAggregate(now),
        ]);

      const scheduledInputs: AdminAlertEnqueueInput[] = [];
      const releaseIntent = getDeploymentReleaseIntent();
      if (releaseIntent) scheduledInputs.push(releaseIntent);
      if (windows.daily && dailyAggregate) {
        scheduledInputs.push({
          event: dailyEvent(windows.daily.date, dailyAggregate),
          dedupeKey: windows.daily.dedupeKey,
        });
      }
      if (windows.weekly && weeklyCurrent && weeklyPrevious) {
        scheduledInputs.push({
          event: {
            type: "pulse.weekly",
            periodStart: windows.weekly.periodStart,
            periodEnd: windows.weekly.periodEnd,
            current: toWeeklyAggregate(weeklyCurrent),
            previous: toWeeklyAggregate(weeklyPrevious),
          },
          dedupeKey: windows.weekly.dedupeKey,
        });
      }
      scheduledInputs.push(
        ...buildAdminMilestoneIntents(milestoneAggregate).map((intent) => ({
          event: intent.event,
          dedupeKey: intent.dedupeKey,
        })),
      );
      const scheduled = await enqueueInBatches(scheduledInputs, now);

      const operationalHealth = await getAdminAlertOutboxHealthForEnvironment(
        environment,
        now,
        { excludeIncidentEvents: true },
      );
      const incidentInputs: AdminAlertEnqueueInput[] = [];
      const deliveryEnabled = isAdminAlertDeliveryEnabled();
      if (deliveryEnabled) {
        if (operationalHealth.stale > 0) {
          incidentInputs.push({
            event: {
              type: "incident",
              code: "admin_alert_outbox_stale",
              summary: `The admin alert outbox has ${operationalHealth.stale} non-incident messages pending for more than ten minutes.`,
            },
            dedupeKey: `incident:admin-alert-outbox-stale:${operationalHealth.oldestPendingAt ?? 0}`,
          });
        }
        if (operationalHealth.dead > 0) {
          incidentInputs.push({
            event: {
              type: "incident",
              code: "admin_alert_outbox_dead",
              summary: `The admin alert outbox contains ${operationalHealth.dead} permanently failed non-incident messages.`,
            },
            dedupeKey: `incident:admin-alert-outbox-dead:${operationalHealth.dead}`,
          });
        }

        const operationalConfig = resolveAdminAlertOperationalConfig();
        const monthlyBudgetMicrousd = operationalConfig.monthlyBudgetUsd * 1_000_000;
        const providerSpendUsd = operationalAggregate.providerSpendMicrousd / 1_000_000;
        for (const threshold of AI_BUDGET_ALERT_THRESHOLDS) {
          if (
            operationalAggregate.providerSpendMicrousd * 100
            < monthlyBudgetMicrousd * threshold
          ) {
            continue;
          }
          incidentInputs.push({
            event: {
              type: "incident",
              code: `ai_monthly_budget_${threshold}`,
              summary: `AI provider spend is $${providerSpendUsd.toFixed(2)} of $${operationalConfig.monthlyBudgetUsd.toFixed(2)} for ${operationalAggregate.budgetPeriod} (${threshold}% threshold crossed).`,
            },
            dedupeKey: `incident:ai-monthly-budget:${operationalAggregate.budgetPeriod}:${threshold}`,
          });
        }
        const utcDate = new Date(now).toISOString().slice(0, 10);
        if (
          operationalAggregate.completedAttempts >= 20
          && operationalAggregate.usableAttempts * 100
            < operationalAggregate.completedAttempts * 95
        ) {
          const successPercent = (
            operationalAggregate.usableAttempts
            / operationalAggregate.completedAttempts
            * 100
          ).toFixed(1);
          incidentInputs.push({
            event: {
              type: "incident",
              code: "ai_delivery_success_below_95",
              summary: `Rolling 24-hour AI delivery: ${operationalAggregate.usableAttempts}/${operationalAggregate.completedAttempts} usable (${successPercent}%); alert threshold is 95%.`,
            },
            dedupeKey: `incident:ai-delivery-success:${utcDate}`,
          });
        }
        if (
          operationalAggregate.latencySampleCount >= 20
          && operationalAggregate.p95LatencyMs > operationalConfig.p95LatencyTargetMs
        ) {
          incidentInputs.push({
            event: {
              type: "incident",
              code: "ai_grading_p95_above_target",
              summary: `Rolling 24-hour AI grading p95 is ${operationalAggregate.p95LatencyMs} ms across ${operationalAggregate.latencySampleCount} samples; target is ${operationalConfig.p95LatencyTargetMs} ms.`,
            },
            dedupeKey: `incident:ai-grading-p95:${utcDate}:${operationalConfig.p95LatencyTargetMs}`,
          });
        }
      }
      const incidents = await enqueueInBatches(incidentInputs, now);
      // Delivery is sequential; the core caps each lease to eight rows so the
      // entire batch remains covered by its conservative three-minute lease.
      const delivery = await deliverPendingAdminAlerts({
        limit: MAX_ADMIN_ALERT_DELIVERY_BATCH,
        now,
      });
      const outbox = await getAdminAlertOutboxHealthForEnvironment(environment, now);

      return NextResponse.json(
        {
          ok: true,
          scheduled: {
            dailyDue: windows.daily !== null,
            weeklyDue: windows.weekly !== null,
            ...scheduled,
          },
          incidents,
          delivery,
          outbox,
        },
        { headers: { "Cache-Control": "private, no-cache, no-store" } },
      );
    } catch {
      console.error("Admin alert cron failed", { code: "admin_alert_cron_failed" });
      return NextResponse.json(
        {
          ok: false,
          error: "Admin alert scheduling or delivery could not be completed.",
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "private, no-cache, no-store",
            "Retry-After": "300",
          },
        },
      );
    }
  });
}

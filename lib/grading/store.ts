import "server-only";
import {
  findValidGradingResultCache,
  getTeacherGradingUsageForUtcMonth,
  getTeacherGradingUsageSince,
  recordGradingProviderRequest,
  upsertGradingResultCache,
} from "@/lib/db";
import type { GradingPipelineStore } from "@/lib/grading/pipeline";

const DAY_MS = 86_400_000;

export class GradingUsageLimitError extends Error {
  readonly code: "daily_request_limit" | "monthly_request_limit" | "monthly_cost_limit";

  constructor(code: GradingUsageLimitError["code"], message: string) {
    super(message);
    this.name = "GradingUsageLimitError";
    this.code = code;
  }
}

/** Database adapter kept outside the pure pipeline so CLI benchmarks stay portable. */
export function createDatabaseGradingStore(input: { attemptId?: string } = {}): GradingPipelineStore {
  return {
    async findCached({ cacheKey, teacherEmail, now }) {
      const cached = await findValidGradingResultCache(cacheKey, teacherEmail, now);
      if (!cached) return null;
      try {
        return {
          result: JSON.parse(cached.resultJson) as unknown,
          provider: cached.provider,
          model: cached.model,
        };
      } catch {
        return null;
      }
    },

    async saveCached(entry) {
      await upsertGradingResultCache({
        cacheKey: entry.cacheKey,
        submissionId: entry.submissionId,
        teacherEmail: entry.teacherEmail,
        resultJson: JSON.stringify(entry.result),
        provider: entry.provider,
        model: entry.model,
        promptVersion: entry.promptVersion,
        expiresAt: entry.expiresAt,
        now: entry.now,
      });
    },

    async recordRequest(record) {
      if (!record.submissionId || !record.teacherEmail) return;
      await recordGradingProviderRequest({
        attemptId: input.attemptId,
        submissionId: record.submissionId,
        teacherEmail: record.teacherEmail,
        requestStage: record.stage,
        provider: record.provider,
        model: record.model,
        providerRequestId: record.providerRequestId,
        status: record.status,
        inputTokens: record.usage.inputTokens,
        cachedInputTokens: record.usage.cachedInputTokens,
        outputTokens: record.usage.outputTokens,
        latencyMs: record.latencyMs,
        retries: record.retries,
        escalated: record.escalated,
        escalationReason: record.escalationReason,
        estimatedCostMicrousd: record.estimatedCostMicrousd,
        promptVersion: record.promptVersion,
        errorCode: record.errorCode,
      });
    },

    async assertProviderCallAllowed({ teacherEmail, config, now }) {
      const [daily, monthly] = await Promise.all([
        getTeacherGradingUsageSince(teacherEmail, now - DAY_MS),
        getTeacherGradingUsageForUtcMonth(teacherEmail, now),
      ]);
      if (daily.requestCount >= config.dailyTeacherRequestLimit) {
        throw new GradingUsageLimitError(
          "daily_request_limit",
          "The daily grading-provider request limit has been reached."
        );
      }
      if (monthly.requestCount >= config.monthlyTeacherRequestLimit) {
        throw new GradingUsageLimitError(
          "monthly_request_limit",
          "The monthly grading-provider request limit has been reached."
        );
      }
      if (monthly.estimatedCostMicrousd >= Math.ceil(config.monthlyTeacherCostLimitUsd * 1_000_000)) {
        throw new GradingUsageLimitError(
          "monthly_cost_limit",
          "The monthly per-teacher grading cost limit has been reached."
        );
      }
    },

    async canEscalate({ teacherEmail, config, now }) {
      if (config.escalationRateLimit <= 0) return false;
      const usage = await getTeacherGradingUsageForUtcMonth(teacherEmail, now);
      const projectedRequests = usage.requestCount + 1;
      const projectedEscalations = usage.escalations + 1;
      const allowance = Math.max(1, Math.ceil(projectedRequests * config.escalationRateLimit));
      return projectedEscalations <= allowance;
    },
  };
}

import "server-only";
import { reserveAiBudget } from "@/lib/db";
import type { AiConfig } from "@/lib/ai/config";

export function currentUtcMonthStart(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export async function reserveGenerationBudget(input: {
  config: AiConfig;
  generationCount?: number;
}) {
  return reserveAiBudget({
    generationCount: input.generationCount ?? 1,
    periodStart: currentUtcMonthStart(),
    monthlyBudgetUsd: input.config.monthlyBudgetUsd,
    reservedCostUsdPerGeneration: input.config.reservedCostUsdPerGeneration,
  });
}

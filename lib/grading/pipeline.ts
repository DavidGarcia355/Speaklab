import { z } from "zod";
import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import type { GradingConfig, GradingModelConfig } from "@/lib/grading/config";
import { getGradingConfig } from "@/lib/grading/config";
import type {
  GradingInput,
  GradingProvider,
  GradingResult,
  ProviderGradeRequest,
  ProviderGradeResponse,
  TokenUsage,
} from "@/lib/grading/contracts";
import { gradeDeterministically } from "@/lib/grading/deterministic";
import { createGradingCacheHash } from "@/lib/grading/hash";
import { normalizeSubmission } from "@/lib/grading/normalize";
import {
  estimateTokenCostMicrousd,
  modelPricingTableFromConfig,
  pricingKey,
  resolveModelPricing,
  usdToMicrousd,
  type ModelPricingTable,
} from "@/lib/grading/pricing";
import {
  createGradingProviderRegistry,
  getGradingProvider,
  type GradingProviderRegistry,
} from "@/lib/grading/providers";
import { routeTextGrading } from "@/lib/grading/routing";
import { validateGradingResult } from "@/lib/grading/schema";

const EMPTY_USAGE: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

export type PipelineSource =
  | "cache"
  | "deterministic"
  | "cheap_ai"
  | "escalation"
  | "teacher_review";

export type GradingRequestStage =
  | "transcription"
  | "cheap"
  | "format_retry"
  | "escalation"
  | "verification";

export type GradingRequestRecord = {
  submissionId?: string;
  teacherEmail?: string;
  stage: GradingRequestStage;
  provider: string;
  model: string;
  providerRequestId?: string;
  status: "completed" | "failed";
  usage: TokenUsage;
  latencyMs: number;
  retries: number;
  escalated: boolean;
  escalationReason: string;
  estimatedCostMicrousd: number;
  costKnown: boolean;
  promptVersion: string;
  errorCode?: string;
};

export type GradingPipelineStore = {
  findCached(input: {
    cacheKey: string;
    teacherEmail: string;
    now: number;
  }): Promise<{ result: unknown; provider: string; model: string } | null>;
  saveCached(input: {
    cacheKey: string;
    submissionId: string;
    teacherEmail: string;
    result: unknown;
    provider: string;
    model: string;
    promptVersion: string;
    expiresAt: number;
    now: number;
  }): Promise<void>;
  recordRequest(record: GradingRequestRecord): Promise<void>;
  assertProviderCallAllowed?(input: {
    teacherEmail: string;
    stage: GradingRequestRecord["stage"];
    config: GradingConfig;
    now: number;
  }): Promise<void>;
  canEscalate?(input: {
    teacherEmail: string;
    config: GradingConfig;
    now: number;
  }): Promise<boolean>;
};

export type GradingPipelineOptions = {
  config?: GradingConfig;
  providers?: GradingProviderRegistry;
  store?: GradingPipelineStore;
  bypassPersistence?: boolean;
  forceAi?: boolean;
  enhanced?: boolean;
  mode?: "production" | "evaluation";
  now?: number;
  providerConfig?: GradingModelConfig;
  providerOverride?:
    | GradingModelConfig
    | { defaultModel?: GradingModelConfig; escalationModel?: GradingModelConfig };
};

export type GradingPipelineResult = {
  result: GradingResult;
  source: PipelineSource;
  provider: string;
  model: string;
  /** Usage from the final schema-valid provider call selected for the result. */
  billableUsage: TokenUsage;
  /** Aggregate provider usage across retries and escalation attempts. */
  usage: TokenUsage;
  estimatedCostMicrousd: number;
  costKnown: boolean;
  latencyMs: number;
  retries: number;
  escalated: boolean;
  escalationReason: string;
  schemaFailures: number;
  cacheHit: boolean;
  cacheKey: string;
  promptVersion: string;
  calls: GradingRequestRecord[];
  failureCode?: string;
};

type ValidCall = {
  ok: true;
  result: GradingResult;
  record: GradingRequestRecord;
};

type InvalidCall = {
  ok: false;
  formattingFailure: boolean;
  record: GradingRequestRecord;
};

type CallOutcome = ValidCall | InvalidCall;

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

function mergePricing(config: GradingConfig): ModelPricingTable {
  return modelPricingTableFromConfig(config.pricingJson);
}

function resolvedModels(config: GradingConfig, options: GradingPipelineOptions) {
  let defaultModel = options.providerConfig ?? config.defaultModel;
  let escalationModel = config.escalationModel;
  if (options.providerOverride) {
    if ("provider" in options.providerOverride) {
      defaultModel = options.providerOverride;
    } else {
      defaultModel = options.providerOverride.defaultModel ?? defaultModel;
      escalationModel = options.providerOverride.escalationModel ?? escalationModel;
    }
  }
  return { defaultModel, escalationModel };
}

export function validateResultForAssignment(result: GradingResult, input: GradingInput) {
  if (Math.abs(result.maximum_score - input.assignment.maximumScore) > 1e-9) {
    throw new Error("The provider maximum score does not match the assignment.");
  }
  const rubric = input.assignment.rubric;
  const expected = rubric?.criteria.length
    ? rubric.criteria.map((criterion) => ({
        id: criterion.id,
        points: criterion.pointsPossible,
      }))
    : [{ id: "overall", points: input.assignment.maximumScore }];
  if (result.rubric_results.length !== expected.length) {
    throw new Error("The provider did not return exactly one result per rubric criterion.");
  }
  const actual = new Map(result.rubric_results.map((criterion) => [criterion.criterion_id, criterion]));
  for (const criterion of expected) {
    const match = actual.get(criterion.id);
    if (!match || Math.abs(match.points_possible - criterion.points) > 1e-9) {
      throw new Error(`The provider result does not match rubric criterion ${criterion.id}.`);
    }
  }
  return result;
}

function terminalReviewResult(input: GradingInput, reason: string): GradingResult {
  const criteria = input.assignment.rubric?.criteria.length
    ? input.assignment.rubric.criteria.map((criterion) => ({
        criterion_id: criterion.id,
        points_awarded: 0,
        points_possible: criterion.pointsPossible,
        evidence: "",
        reason: "No validated model result is available; the teacher must grade this criterion.",
      }))
    : [
        {
          criterion_id: "overall",
          points_awarded: 0,
          points_possible: input.assignment.maximumScore,
          evidence: "",
          reason: "No validated model result is available; the teacher must grade this response.",
        },
      ];
  return validateGradingResult(
    {
      score: 0,
      maximum_score: input.assignment.maximumScore,
      confidence: 0,
      rubric_results: criteria,
      feedback: "AI could not produce a reliable suggestion. Please review this response manually.",
      requires_teacher_review: true,
      review_reason: reason.slice(0, 300),
    },
    input.studentAnswer
  );
}

function withRequiredReview(result: GradingResult, reason: string): GradingResult {
  return {
    ...result,
    requires_teacher_review: true,
    review_reason: [result.review_reason, reason].filter(Boolean).join(" ").slice(0, 300),
  };
}

function costForResponse(
  response: ProviderGradeResponse,
  model: GradingModelConfig,
  pricing: ModelPricingTable
) {
  const providerReportedCostUsd = (response as ProviderGradeResponse & {
    providerReportedCostUsd?: number;
  }).providerReportedCostUsd;
  if (
    typeof providerReportedCostUsd === "number" &&
    Number.isFinite(providerReportedCostUsd) &&
    providerReportedCostUsd >= 0
  ) {
    return { microusd: usdToMicrousd(providerReportedCostUsd), known: true };
  }
  const rate = resolveModelPricing(pricing, model);
  if (!rate) return { microusd: 0, known: false };
  return { microusd: estimateTokenCostMicrousd(response.usage, rate).totalMicrousd, known: true };
}

function safeUsage(response: ProviderGradeResponse | undefined) {
  return response?.usage ?? EMPTY_USAGE;
}

function structuredOutputFailureResponse(
  error: unknown,
  latencyMs: number
): ProviderGradeResponse | undefined {
  if (!NoObjectGeneratedError.isInstance(error)) return undefined;
  return {
    output: error.text ?? "",
    usage: {
      inputTokens: error.usage?.inputTokens ?? 0,
      cachedInputTokens: error.usage?.inputTokenDetails.cacheReadTokens ?? 0,
      outputTokens: error.usage?.outputTokens ?? 0,
    },
    latencyMs,
    providerRequestId: error.response?.id,
  };
}

function isFormattingFailure(error: unknown, response: ProviderGradeResponse | undefined) {
  return (
    Boolean(response) ||
    error instanceof z.ZodError ||
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error)
  );
}

function providerFailureDiagnostic(error: unknown) {
  if (NoObjectGeneratedError.isInstance(error)) {
    return {
      errorName: error.name,
      finishReason: error.finishReason,
      causeName: error.cause instanceof Error ? error.cause.name : undefined,
    };
  }
  if (NoOutputGeneratedError.isInstance(error)) {
    return { errorName: error.name };
  }
  if (error instanceof z.ZodError) {
    return {
      errorName: error.name,
      issues: error.issues.slice(0, 6).map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    };
  }
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message.slice(0, 300) : undefined,
  };
}

async function invokeProvider(input: {
  provider: GradingProvider;
  model: GradingModelConfig;
  assignment: GradingInput["assignment"];
  studentAnswer: string;
  promptVersion: string;
  stage: Exclude<GradingRequestStage, "transcription">;
  retries: number;
  escalated: boolean;
  escalationReason: string;
  pricing: ModelPricingTable;
  sourceInput: GradingInput;
  store?: GradingPipelineStore;
  config: GradingConfig;
  now: number;
}): Promise<CallOutcome> {
  if (input.store && input.sourceInput.teacherEmail) {
    await input.store.assertProviderCallAllowed?.({
      teacherEmail: input.sourceInput.teacherEmail,
      stage: input.stage,
      config: input.config,
      now: input.now,
    });
  }
  const request: ProviderGradeRequest = {
    assignment: {
      id: input.assignment.id,
      type: input.assignment.type,
      question: input.assignment.question,
      instructions: input.assignment.instructions,
      maximumScore: input.assignment.maximumScore,
      version: input.assignment.version,
      rubric: input.assignment.rubric,
    },
    studentAnswer: input.studentAnswer,
    promptVersion: input.promptVersion,
    model: {
      ...input.model,
      maxOutputTokens: input.config.maxOutputTokens,
      parameters: { timeoutMs: input.config.providerTimeoutMs },
    },
    attempt: input.stage,
  };

  let response: ProviderGradeResponse | undefined;
  let result: GradingResult | undefined;
  let formattingFailure = false;
  let errorCode: string | undefined;
  const startedAt = Date.now();
  try {
    response = await input.provider.grade(request);
    result = validateResultForAssignment(
      validateGradingResult(response.output, input.studentAnswer),
      input.sourceInput
    );
  } catch (error) {
    response ??= structuredOutputFailureResponse(error, Date.now() - startedAt);
    formattingFailure = isFormattingFailure(error, response);
    errorCode = formattingFailure ? "invalid_provider_output" : "provider_error";
    console.warn("AI grading provider result rejected", {
      stage: input.stage,
      provider: input.model.provider,
      model: input.model.model,
      formattingFailure,
      ...providerFailureDiagnostic(error),
    });
  }

  const usage = safeUsage(response);
  const cost = response
    ? costForResponse(response, input.model, input.pricing)
    : { microusd: 0, known: resolveModelPricing(input.pricing, input.model) !== null };
  const record: GradingRequestRecord = {
    submissionId: input.sourceInput.submissionId,
    teacherEmail: input.sourceInput.teacherEmail,
    stage: input.stage,
    provider: input.model.provider,
    model: input.model.model,
    providerRequestId: response?.providerRequestId,
    status: result ? "completed" : "failed",
    usage,
    latencyMs: response?.latencyMs ?? Date.now() - startedAt,
    retries: input.retries,
    escalated: input.escalated,
    escalationReason: input.escalationReason,
    estimatedCostMicrousd: cost.microusd,
    costKnown: cost.known,
    promptVersion: input.promptVersion,
    errorCode,
  };
  await input.store?.recordRequest(record);
  return result ? { ok: true, result, record } : { ok: false, formattingFailure, record };
}

function escalationReasons(result: GradingResult, threshold: number) {
  const reasons: string[] = [];
  if (result.confidence < threshold) reasons.push("low_confidence");
  if (result.requires_teacher_review) reasons.push("model_requested_teacher_review");
  return reasons;
}

function resultSummary(input: {
  result: GradingResult;
  source: PipelineSource;
  provider: string;
  model: string;
  billableUsage: TokenUsage;
  calls: GradingRequestRecord[];
  cacheHit: boolean;
  cacheKey: string;
  promptVersion: string;
  retries: number;
  escalated: boolean;
  escalationReason: string;
  schemaFailures: number;
  failureCode?: string;
}): GradingPipelineResult {
  const usage = input.calls.reduce((total, call) => addUsage(total, call.usage), EMPTY_USAGE);
  return {
    result: input.result,
    source: input.source,
    provider: input.provider,
    model: input.model,
    billableUsage: input.billableUsage,
    usage,
    estimatedCostMicrousd: input.calls.reduce(
      (total, call) => total + call.estimatedCostMicrousd,
      0
    ),
    costKnown: input.calls.every((call) => call.costKnown),
    latencyMs: input.calls.reduce((total, call) => total + call.latencyMs, 0),
    retries: input.retries,
    escalated: input.escalated,
    escalationReason: input.escalationReason,
    schemaFailures: input.schemaFailures,
    cacheHit: input.cacheHit,
    cacheKey: input.cacheKey,
    promptVersion: input.promptVersion,
    calls: input.calls,
    failureCode: input.failureCode,
  };
}

/** Runs deterministic, cheap-model, bounded retry, escalation, and review stages. */
export async function runGradingPipeline(
  input: GradingInput,
  options: GradingPipelineOptions = {}
): Promise<GradingPipelineResult> {
  const baseConfig = options.config ?? getGradingConfig();
  const models = resolvedModels(baseConfig, options);
  const config = { ...baseConfig, ...models };
  const promptVersion = input.promptVersion || config.promptVersion;
  const now = options.now ?? Date.now();
  const store = options.bypassPersistence ? undefined : options.store;
  const providers = options.providers ?? createGradingProviderRegistry();
  const pricing = mergePricing(config);
  const cacheKey = createGradingCacheHash({
    studentAnswer: input.studentAnswer,
    assignmentVersion: input.assignment.version,
    rubricVersion: input.assignment.rubric?.version ?? "none",
    promptVersion,
    modelConfig: {
      default: config.defaultModel,
      escalation: config.escalationModel,
    },
  });

  if (store && input.submissionId && input.teacherEmail) {
    const cached = await store.findCached({ cacheKey, teacherEmail: input.teacherEmail, now });
    if (cached) {
      try {
        const result = validateResultForAssignment(
          validateGradingResult(cached.result, normalizeSubmission(input.studentAnswer).text),
          input
        );
        return resultSummary({
          result,
          source: "cache",
          provider: cached.provider,
          model: cached.model,
          billableUsage: EMPTY_USAGE,
          calls: [],
          cacheHit: true,
          cacheKey,
          promptVersion,
          retries: 0,
          escalated: false,
          escalationReason: "",
          schemaFailures: 0,
        });
      } catch {
        // Invalid/stale cache payloads fail closed and are recomputed.
      }
    }
  }

  if (!options.forceAi) {
    const deterministic = gradeDeterministically({ ...input, promptVersion });
    if (deterministic.kind === "graded") {
      const output = resultSummary({
        result: deterministic.result,
        source: "deterministic",
        provider: "deterministic",
        model: "rules-v1",
        billableUsage: EMPTY_USAGE,
        calls: [],
        cacheHit: false,
        cacheKey,
        promptVersion,
        retries: 0,
        escalated: false,
        escalationReason: "",
        schemaFailures: 0,
      });
      if (store && input.submissionId && input.teacherEmail) {
        await store.saveCached({
          cacheKey,
          submissionId: input.submissionId,
          teacherEmail: input.teacherEmail,
          result: output.result,
          provider: output.provider,
          model: output.model,
          promptVersion,
          now,
          expiresAt: now + config.cacheTtlDays * 86_400_000,
        });
      }
      return output;
    }
  }

  const normalized = normalizeSubmission(input.studentAnswer);
  const initialRoute = routeTextGrading({
    config,
    assignment: input.assignment,
    answerCharacters: normalized.text.length,
    enhanced: options.enhanced ?? input.enhanced,
    promptInjectionDetected: normalized.promptInjection.detected,
  });
  const calls: GradingRequestRecord[] = [];
  let retries = 0;
  let schemaFailures = 0;
  let escalated = initialRoute.forceEscalation;
  let escalationReason = initialRoute.reasons.join(",");
  let cheapResult: GradingResult | undefined;
  let selectedCall: GradingRequestRecord | undefined;
  let chosenModel = initialRoute.model;
  let chosenSource: PipelineSource = initialRoute.forceEscalation ? "escalation" : "cheap_ai";

  const run = async (
    model: GradingModelConfig,
    stage: Exclude<GradingRequestStage, "transcription">,
    retryCount: number,
    isEscalated: boolean,
    reason: string
  ) => {
    const outcome = await invokeProvider({
      provider: getGradingProvider(model.provider, providers),
      model,
      assignment: input.assignment,
      studentAnswer: normalized.text,
      promptVersion,
      stage,
      retries: retryCount,
      escalated: isEscalated,
      escalationReason: reason,
      pricing,
      sourceInput: input,
      store,
      config,
      now,
    });
    calls.push(outcome.record);
    if (!outcome.ok && outcome.formattingFailure) schemaFailures += 1;
    return outcome;
  };

  let first = await run(
    initialRoute.model,
    initialRoute.forceEscalation ? "escalation" : "cheap",
    0,
    initialRoute.forceEscalation,
    escalationReason
  );

  if (!first.ok && first.formattingFailure && !initialRoute.forceEscalation && config.formattingRetries > 0) {
    retries = 1;
    first = await run(config.defaultModel, "format_retry", 1, false, "invalid_provider_output");
  }

  if (first.ok) {
    cheapResult = first.result;
    selectedCall = first.record;
  }
  const needEscalation = !initialRoute.forceEscalation && (
    !first.ok || escalationReasons(first.result, config.confidenceThreshold).length > 0 ||
    normalized.promptInjection.detected
  );

  let finalResult = first.ok ? first.result : undefined;
  if (needEscalation) {
    const reasons = [
      ...(first.ok ? escalationReasons(first.result, config.confidenceThreshold) : ["cheap_model_failed"]),
      ...(normalized.promptInjection.detected ? ["prompt_injection_detected"] : []),
    ];
    escalationReason = [...new Set(reasons)].join(",");
    let allowed = true;
    // Provider failures are reliability incidents, not optional quality sampling.
    // Always try the configured fallback; usage and cost ceilings are still
    // enforced by assertProviderCallAllowed before the call is made.
    if (first.ok && store && input.teacherEmail) {
      allowed = (await store.canEscalate?.({
        teacherEmail: input.teacherEmail,
        config,
        now,
      })) ?? true;
    }
    if (allowed) {
      escalated = true;
      chosenModel = config.escalationModel;
      chosenSource = "escalation";
      const second = await run(config.escalationModel, "escalation", 0, true, escalationReason);
      if (second.ok) {
        finalResult = second.result;
        selectedCall = second.record;
      } else {
        finalResult = undefined;
        selectedCall = undefined;
      }
    } else {
      finalResult = first.ok
        ? withRequiredReview(first.result, "Escalation budget/rate limit reached; teacher review is required.")
        : undefined;
      chosenSource = "teacher_review";
      escalationReason = `${escalationReason},escalation_rate_limit`.replace(/^,/, "");
    }
  }

  let failureCode: string | undefined;
  if (!finalResult) {
    failureCode = "no_valid_provider_result";
    finalResult = terminalReviewResult(input, "No provider returned a schema-valid, traceable result.");
    chosenSource = "teacher_review";
    selectedCall = undefined;
  }

  if (cheapResult && escalated && chosenSource === "escalation") {
    const disagreement = Math.abs(cheapResult.score - finalResult.score);
    if (disagreement > config.scoreDisagreementThreshold) {
      finalResult = withRequiredReview(
        finalResult,
        `Models disagreed by ${disagreement.toFixed(2)} points.`
      );
      chosenSource = "teacher_review";
      escalationReason = `${escalationReason},model_disagreement`.replace(/^,/, "");
    }
  }
  if (finalResult.confidence < config.confidenceThreshold) {
    finalResult = withRequiredReview(finalResult, "Confidence remains below the configured threshold.");
    chosenSource = "teacher_review";
  }
  if (normalized.promptInjection.detected) {
    finalResult = withRequiredReview(
      finalResult,
      `Possible prompt injection detected (${normalized.promptInjection.signals.join(", ")}).`
    );
    chosenSource = "teacher_review";
  }

  const output = resultSummary({
    result: finalResult,
    source: chosenSource,
    provider: chosenModel.provider,
    model: chosenModel.model,
    billableUsage: selectedCall?.usage ?? EMPTY_USAGE,
    calls,
    cacheHit: false,
    cacheKey,
    promptVersion,
    retries,
    escalated,
    escalationReason,
    schemaFailures,
    failureCode,
  });

  if (store && input.submissionId && input.teacherEmail && !failureCode) {
    await store.saveCached({
      cacheKey,
      submissionId: input.submissionId,
      teacherEmail: input.teacherEmail,
      result: output.result,
      provider: output.provider,
      model: output.model,
      promptVersion,
      now,
      expiresAt: now + config.cacheTtlDays * 86_400_000,
    });
  }
  return output;
}

export function modelPriceIdentity(model: GradingModelConfig) {
  return pricingKey(model);
}

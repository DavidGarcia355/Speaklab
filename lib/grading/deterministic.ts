import type {
  DeterministicRule,
  FormattingRequirement,
  GradingInput,
  GradingResult,
} from "@/lib/grading/contracts";
import { detectPromptInjection, normalizeText, stripHtml } from "@/lib/grading/normalize";
import { validateGradingResult } from "@/lib/grading/schema";

export type DeterministicRuleEvaluation = {
  ruleId: string;
  passed: boolean;
  pointsAwarded: number;
  pointsPossible: number;
  reason: string;
};

export type DeterministicGradeOutcome =
  | {
      kind: "graded";
      result: GradingResult;
      normalizedAnswer: string;
      ruleEvaluations: DeterministicRuleEvaluation[];
      injectionSignals: string[];
    }
  | { kind: "unsupported"; reason: string };

const MAX_REGEX_PATTERN_LENGTH = 256;
const MAX_REGEX_ANSWER_LENGTH = 20_000;

/** Returns a complete deterministic grade, or explains why an AI/manual path is still needed. */
export function gradeDeterministically(input: GradingInput): DeterministicGradeOutcome {
  const maximumScore = input.assignment.maximumScore;
  if (!Number.isFinite(maximumScore) || maximumScore <= 0) {
    return { kind: "unsupported", reason: "invalid_maximum_score" };
  }

  const normalizedAnswer = normalizeText(input.studentAnswer);
  const injection = detectPromptInjection(normalizedAnswer);
  const ruleSet = input.assignment.gradingRules;

  // Empty and missing answers never need a paid model call.
  if (!normalizedAnswer) {
    const configuredScore = ruleSet?.emptyAnswer?.score ?? 0;
    if (!isScoreInRange(configuredScore, maximumScore)) {
      return { kind: "unsupported", reason: "invalid_empty_answer_score" };
    }
    const result = validateGradingResult(
      {
        score: configuredScore,
        maximum_score: maximumScore,
        confidence: 1,
        rubric_results: [
          {
            criterion_id: "empty-answer",
            points_awarded: configuredScore,
            points_possible: maximumScore,
            evidence: "",
            reason: "No student answer was provided.",
          },
        ],
        feedback: concise(ruleSet?.emptyAnswer?.feedback || "No answer was provided."),
        requires_teacher_review: false,
        review_reason: null,
      },
      normalizedAnswer
    );
    return {
      kind: "graded",
      result,
      normalizedAnswer,
      ruleEvaluations: [],
      injectionSignals: [],
    };
  }

  if (!ruleSet || ruleSet.rules.length === 0) {
    return { kind: "unsupported", reason: "no_deterministic_rules" };
  }

  const configurationProblem = validateRuleConfiguration(input);
  if (configurationProblem) return { kind: "unsupported", reason: configurationProblem };

  const evaluations = ruleSet.rules.map((rule) =>
    evaluateRule(rule, normalizedAnswer, input.studentAnswer)
  );
  const score = evaluations.reduce((total, evaluation) => total + evaluation.pointsAwarded, 0);
  const passedCount = evaluations.filter((evaluation) => evaluation.passed).length;
  const feedbackParts = ruleSet.rules.map((rule, index) => {
    const evaluation = evaluations[index]!;
    return evaluation.passed ? rule.passFeedback : rule.failFeedback;
  });
  const explicitFeedback = feedbackParts.filter((value): value is string => Boolean(value)).join(" ");
  const requiresReview = injection.detected;
  const evidence = normalizedAnswer.slice(0, 240);
  const result = validateGradingResult(
    {
      score,
      maximum_score: maximumScore,
      confidence: requiresReview ? 0.5 : 1,
      rubric_results: evaluations.map((evaluation) => ({
        criterion_id: evaluation.ruleId,
        points_awarded: evaluation.pointsAwarded,
        points_possible: evaluation.pointsPossible,
        evidence,
        reason: evaluation.reason,
      })),
      feedback: concise(
        explicitFeedback ||
          `Deterministic checks passed ${passedCount} of ${evaluations.length} scoring rules.`
      ),
      requires_teacher_review: requiresReview,
      review_reason: requiresReview
        ? `Suspected prompt injection (${injection.signals.join(", ")}).`
        : null,
    },
    normalizedAnswer
  );

  return {
    kind: "graded",
    result,
    normalizedAnswer,
    ruleEvaluations: evaluations,
    injectionSignals: injection.signals,
  };
}

/** Compatibility alias for callers that prefer noun-first naming. */
export const deterministicGrade = gradeDeterministically;

function validateRuleConfiguration(input: GradingInput) {
  const rules = input.assignment.gradingRules?.rules ?? [];
  const ids = rules.map((rule) => rule.id.trim());
  if (ids.some((id) => !id)) return "deterministic_rule_id_missing";
  if (new Set(ids).size !== ids.length) return "duplicate_deterministic_rule_id";
  if (rules.some((rule) => !Number.isFinite(rule.pointsPossible) || rule.pointsPossible <= 0)) {
    return "invalid_deterministic_rule_points";
  }

  const possible = rules.reduce((total, rule) => total + rule.pointsPossible, 0);
  if (!nearlyEqual(possible, input.assignment.maximumScore)) {
    return "deterministic_rules_do_not_cover_maximum_score";
  }

  const rubric = input.assignment.rubric;
  if (rubric) {
    const rubricById = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion]));
    if (
      rubric.criteria.length !== rules.length ||
      rules.some((rule) => {
        const criterion = rubricById.get(rule.id);
        return !criterion || !nearlyEqual(criterion.pointsPossible, rule.pointsPossible);
      })
    ) {
      return "deterministic_rules_do_not_match_rubric";
    }
  }

  for (const rule of rules) {
    if (
      (rule.type === "multiple_choice" && rule.acceptedChoices.length === 0) ||
      (rule.type === "accepted_answers" && rule.accepted.length === 0) ||
      (rule.type === "required_keywords" && rule.keywords.length === 0) ||
      (rule.type === "formatting" && rule.requirements.length === 0)
    ) {
      return `empty_deterministic_rule_configuration:${rule.id}`;
    }
    if (
      (rule.type === "min_length" && (!Number.isInteger(rule.minimum) || rule.minimum < 0)) ||
      (rule.type === "max_length" && (!Number.isInteger(rule.maximum) || rule.maximum < 0))
    ) {
      return `invalid_length_rule:${rule.id}`;
    }
    if (rule.type === "numeric" && (!Number.isFinite(rule.expected) || !Number.isFinite(rule.tolerance) || rule.tolerance < 0)) {
      return `invalid_numeric_rule:${rule.id}`;
    }
    if (rule.type === "regex") {
      if (!isSafeRegexConfiguration(rule.pattern, rule.flags)) {
        return `invalid_or_unsafe_regex_rule:${rule.id}`;
      }
    }
  }
  return null;
}

function evaluateRule(
  rule: DeterministicRule,
  answer: string,
  rawAnswer: string
): DeterministicRuleEvaluation {
  let passed = false;
  let reason = "The deterministic requirement was not met.";

  switch (rule.type) {
    case "multiple_choice": {
      passed = rule.acceptedChoices.some((choice) => textEquals(answer, choice, rule.caseSensitive));
      reason = passed ? "The selected choice is accepted." : "The selected choice is not accepted.";
      break;
    }
    case "true_false": {
      const parsed = parseBooleanAnswer(answer);
      passed = parsed !== null && parsed === rule.expected;
      reason = parsed === null
        ? "The response is not a recognized true/false value."
        : passed
          ? "The true/false response is correct."
          : "The true/false response is incorrect.";
      break;
    }
    case "exact_match": {
      passed = textEquals(answer, rule.expected, rule.caseSensitive);
      reason = passed ? "The response exactly matches the expected answer." : "The response does not exactly match the expected answer.";
      break;
    }
    case "accepted_answers": {
      passed = rule.accepted.some((accepted) => textEquals(answer, accepted, rule.caseSensitive));
      reason = passed ? "The response matches an accepted answer." : "The response does not match an accepted answer.";
      break;
    }
    case "numeric": {
      const parsed = parseNumericAnswer(answer);
      const allowedDifference = rule.toleranceType === "relative"
        ? Math.abs(rule.expected) * rule.tolerance
        : rule.tolerance;
      passed = parsed !== null && Math.abs(parsed - rule.expected) <= allowedDifference;
      reason = parsed === null
        ? "The response is not a valid number."
        : passed
          ? "The numeric response is within the configured tolerance."
          : "The numeric response is outside the configured tolerance.";
      break;
    }
    case "regex": {
      passed = answer.length <= MAX_REGEX_ANSWER_LENGTH && new RegExp(rule.pattern, rule.flags).test(answer);
      reason = passed ? "The response matches the required pattern." : "The response does not match the required pattern.";
      break;
    }
    case "min_length": {
      const length = measuredLength(answer, rule.unit);
      passed = length >= rule.minimum;
      reason = passed
        ? `The response meets the minimum ${rule.unit ?? "characters"} requirement.`
        : `The response is shorter than the minimum ${rule.unit ?? "characters"} requirement.`;
      break;
    }
    case "max_length": {
      const length = measuredLength(answer, rule.unit);
      passed = length <= rule.maximum;
      reason = passed
        ? `The response meets the maximum ${rule.unit ?? "characters"} requirement.`
        : `The response exceeds the maximum ${rule.unit ?? "characters"} requirement.`;
      break;
    }
    case "required_keywords": {
      const haystack = rule.caseSensitive ? answer : answer.toLocaleLowerCase("en-US");
      const matches = rule.keywords.map((keyword) => {
        const needle = normalizeText(keyword);
        return haystack.includes(rule.caseSensitive ? needle : needle.toLocaleLowerCase("en-US"));
      });
      passed = (rule.match ?? "all") === "any" ? matches.some(Boolean) : matches.every(Boolean);
      reason = passed ? "The response includes the required keywords." : "The response is missing required keywords.";
      break;
    }
    case "formatting": {
      const failed = rule.requirements.filter(
        (requirement) => !meetsFormattingRequirement(requirement, answer, rawAnswer)
      );
      passed = failed.length === 0;
      reason = passed
        ? "The response meets the required format."
        : `The response does not meet these formats: ${failed.join(", ")}.`;
      break;
    }
  }

  return {
    ruleId: rule.id,
    passed,
    pointsAwarded: passed ? rule.pointsPossible : 0,
    pointsPossible: rule.pointsPossible,
    reason,
  };
}

function textEquals(left: string, right: string, caseSensitive = false) {
  const normalizedRight = normalizeText(right);
  return caseSensitive
    ? left === normalizedRight
    : left.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US");
}

function parseBooleanAnswer(answer: string): boolean | null {
  const value = answer.toLocaleLowerCase("en-US");
  if (["true", "t", "yes", "y", "1"].includes(value)) return true;
  if (["false", "f", "no", "n", "0"].includes(value)) return false;
  return null;
}

function parseNumericAnswer(answer: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(answer)) return null;
  const value = Number(answer);
  return Number.isFinite(value) ? value : null;
}

function measuredLength(answer: string, unit: "characters" | "words" = "characters") {
  if (unit === "characters") return [...answer].length;
  return answer ? answer.split(/\s+/u).length : 0;
}

function meetsFormattingRequirement(
  requirement: FormattingRequirement,
  answer: string,
  rawAnswer: string
) {
  switch (requirement) {
    case "email":
      return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(answer);
    case "url":
      try {
        return ["http:", "https:"].includes(new URL(answer).protocol);
      } catch {
        return false;
      }
    case "json":
      try {
        JSON.parse(rawAnswer.trim());
        return true;
      } catch {
        return false;
      }
    case "integer":
      return /^[+-]?\d+$/.test(answer);
    case "number":
      return parseNumericAnswer(answer) !== null;
    case "iso_date":
      return isIsoDate(answer);
    case "uppercase":
      return /\p{L}/u.test(answer) && answer === answer.toLocaleUpperCase();
    case "lowercase":
      return /\p{L}/u.test(answer) && answer === answer.toLocaleLowerCase();
    case "single_line":
      return !/[\r\n]/.test(stripHtml(rawAnswer));
  }
}

function isIsoDate(answer: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(answer);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isSafeRegexConfiguration(pattern: string, flags = "") {
  if (!pattern || pattern.length > MAX_REGEX_PATTERN_LENGTH) return false;
  if (!/^[imsu]*$/.test(flags) || new Set(flags).size !== flags.length) return false;
  // Reject the most common catastrophic nested-quantifier forms. This is a
  // guardrail, not a substitute for reviewing teacher-authored regexes.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
}

function isScoreInRange(score: number, maximumScore: number) {
  return Number.isFinite(score) && score >= 0 && score <= maximumScore;
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= 1e-9;
}

function concise(input: string) {
  const normalized = normalizeText(input);
  return (normalized || "Deterministic grading completed.").slice(0, 600);
}

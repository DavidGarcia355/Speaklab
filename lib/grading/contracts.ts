export type GradingRubricCriterion = {
  id: string;
  description: string;
  pointsPossible: number;
};

export type GradingRubric = {
  version: string;
  criteria: GradingRubricCriterion[];
};

type DeterministicRuleBase = {
  /** Stable rule ID. When a rubric exists, this should match its criterion ID. */
  id: string;
  pointsPossible: number;
  passFeedback?: string;
  failFeedback?: string;
};

type TextMatchOptions = {
  caseSensitive?: boolean;
};

export type MultipleChoiceRule = DeterministicRuleBase &
  TextMatchOptions & {
    type: "multiple_choice";
    acceptedChoices: string[];
  };

export type TrueFalseRule = DeterministicRuleBase & {
  type: "true_false";
  expected: boolean;
};

export type ExactMatchRule = DeterministicRuleBase &
  TextMatchOptions & {
    type: "exact_match";
    expected: string;
  };

export type AcceptedAnswersRule = DeterministicRuleBase &
  TextMatchOptions & {
    type: "accepted_answers";
    accepted: string[];
  };

export type NumericRule = DeterministicRuleBase & {
  type: "numeric";
  expected: number;
  tolerance: number;
  toleranceType?: "absolute" | "relative";
};

export type RegexRule = DeterministicRuleBase & {
  type: "regex";
  pattern: string;
  flags?: string;
};

export type LengthUnit = "characters" | "words";

export type MinimumLengthRule = DeterministicRuleBase & {
  type: "min_length";
  minimum: number;
  unit?: LengthUnit;
};

export type MaximumLengthRule = DeterministicRuleBase & {
  type: "max_length";
  maximum: number;
  unit?: LengthUnit;
};

export type RequiredKeywordsRule = DeterministicRuleBase &
  TextMatchOptions & {
    type: "required_keywords";
    keywords: string[];
    match?: "all" | "any";
  };

export type FormattingRequirement =
  | "email"
  | "url"
  | "json"
  | "integer"
  | "number"
  | "iso_date"
  | "uppercase"
  | "lowercase"
  | "single_line";

export type FormattingRule = DeterministicRuleBase & {
  type: "formatting";
  requirements: FormattingRequirement[];
};

export type DeterministicRule =
  | MultipleChoiceRule
  | TrueFalseRule
  | ExactMatchRule
  | AcceptedAnswersRule
  | NumericRule
  | RegexRule
  | MinimumLengthRule
  | MaximumLengthRule
  | RequiredKeywordsRule
  | FormattingRule;

export type DeterministicRuleSet = {
  emptyAnswer?: {
    score?: number;
    feedback?: string;
  };
  rules: DeterministicRule[];
};

export type GradingAssignment = {
  id?: string;
  type: string;
  question: string;
  instructions: string;
  targetLanguage?: string;
  maximumScore: number;
  version: string;
  rubric: GradingRubric | null;
  gradingRules?: DeterministicRuleSet | null;
};

export type GradingInput = {
  submissionId?: string;
  teacherEmail?: string;
  assignment: GradingAssignment;
  studentAnswer: string;
  promptVersion?: string;
  enhanced?: boolean;
  attachments?: Array<{ contentType: string }>;
};

export type RubricResult = {
  criterion_id: string;
  points_awarded: number;
  points_possible: number;
  /** An exact excerpt from the normalized student answer, never a paraphrase. */
  evidence: string;
  reason: string;
};

export type GradingResult = {
  score: number;
  maximum_score: number;
  confidence: number;
  rubric_results: RubricResult[];
  feedback: string;
  requires_teacher_review: boolean;
  review_reason: string | null;
};

export type ProviderModelConfig = {
  provider: string;
  model: string;
  modelVersion?: string;
  maxOutputTokens?: number;
  parameters?: Record<string, string | number | boolean | null>;
};

export type TokenUsage = {
  /** Total input tokens, including cached input tokens. */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type ProviderGradeRequest = {
  assignment: Omit<GradingAssignment, "gradingRules">;
  studentAnswer: string;
  promptVersion: string;
  model: ProviderModelConfig;
  attempt: "cheap" | "format_retry" | "escalation" | "verification";
};

export type ProviderGradeResponse = {
  /** Provider output is untrusted until schema and evidence validation succeeds. */
  output: unknown;
  usage: TokenUsage;
  latencyMs: number;
  providerRequestId?: string;
  /** Exact provider-reported request cost when the provider supplies it. */
  providerReportedCostUsd?: number;
};

export interface GradingProvider {
  readonly id: string;
  grade(request: ProviderGradeRequest): Promise<ProviderGradeResponse>;
}

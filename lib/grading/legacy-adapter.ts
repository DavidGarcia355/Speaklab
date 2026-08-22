import { createHash } from "node:crypto";
import type { SubmissionForAiGradeRow } from "@/lib/db";
import type { GradingAssignment, GradingInput, GradingResult } from "@/lib/grading/contracts";
import { canonicalStringify } from "@/lib/grading/hash";
import type { GradingPipelineResult } from "@/lib/grading/pipeline";

function versionOf(value: unknown) {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex").slice(0, 16);
}

export function legacyAssignmentToGradingAssignment(
  data: SubmissionForAiGradeRow
): GradingAssignment {
  const rubric = data.rubric
    ? {
        version: versionOf(data.rubric),
        criteria: data.rubric.criteria.map((criterion, index) => ({
          id: String(criterion.id ?? `criterion-${index + 1}`),
          description: [criterion.name, criterion.description].filter(Boolean).join(": "),
          pointsPossible: criterion.maxPoints,
        })),
      }
    : null;
  return {
    id: data.assignmentId,
    type: "audio_response",
    question: data.description || data.assignmentTitle,
    instructions: data.instructions,
    targetLanguage: data.targetLanguage || "Spanish",
    maximumScore: data.maxPoints,
    version: versionOf({
      assignmentId: data.assignmentId,
      title: data.assignmentTitle,
      description: data.description,
      instructions: data.instructions,
      targetLanguage: data.targetLanguage || "Spanish",
      maxPoints: data.maxPoints,
    }),
    rubric,
  };
}

export function transcriptGradingInput(input: {
  data: SubmissionForAiGradeRow;
  teacherEmail: string;
  transcript: string;
  enhanced?: boolean;
}): GradingInput {
  return {
    submissionId: input.data.submissionId,
    teacherEmail: input.teacherEmail,
    assignment: legacyAssignmentToGradingAssignment(input.data),
    studentAnswer: input.transcript,
    enhanced: input.enhanced,
  };
}

export function categoricalConfidence(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

export function gradingResultToLegacySuggestion(input: {
  result: GradingResult;
  data: SubmissionForAiGradeRow;
  source: GradingPipelineResult["source"] | "direct_audio";
  failureCode?: string;
  forceTeacherReviewReason?: string;
}) {
  const rubricNames = new Map(
    input.data.rubric?.criteria.map((criterion) => [criterion.id, criterion.name]) ?? []
  );
  const forceReview = Boolean(input.forceTeacherReviewReason);
  const confidence = categoricalConfidence(input.result.confidence);
  const lowConfidence = confidence !== "high";
  const requiresReview =
    input.result.requires_teacher_review ||
    input.source === "teacher_review" ||
    forceReview ||
    lowConfidence;
  const unableToGrade = Boolean(input.failureCode);
  const rubricScores = input.result.rubric_results.map((criterion) => ({
    criterionId: criterion.criterion_id,
    criterionName: rubricNames.get(criterion.criterion_id) ?? "Overall",
    maxPoints: criterion.points_possible,
    awarded: Math.max(
      0,
      Math.min(criterion.points_possible, Math.round(criterion.points_awarded)),
    ),
  }));
  const wholeNumberScore = input.data.rubric && rubricScores.length > 0
    ? rubricScores.reduce((total, criterion) => total + criterion.awarded, 0)
    : Math.max(0, Math.min(input.data.maxPoints, Math.round(input.result.score)));
  const scoreWasRounded =
    Math.abs(wholeNumberScore - input.result.score) > 1e-9 ||
    rubricScores.some((criterion, index) =>
      Math.abs(criterion.awarded - input.result.rubric_results[index].points_awarded) > 1e-9
    );
  const warnings = [
    input.result.review_reason,
    input.forceTeacherReviewReason,
    input.failureCode ? `AI pipeline failure: ${input.failureCode}` : null,
    lowConfidence ? "AI confidence is below the automatic-grading threshold." : null,
    scoreWasRounded ? "AI score was rounded to the whole-point grading scale." : null,
  ].filter((value): value is string => Boolean(value));

  return {
    suggestedScore: unableToGrade ? null : wholeNumberScore,
    rubricScores,
    feedback: input.result.feedback,
    strengths: input.result.rubric_results
      .filter((criterion) => criterion.points_awarded >= criterion.points_possible * 0.7)
      .map((criterion) => criterion.reason)
      .slice(0, 3),
    improvements: input.result.rubric_results
      .filter((criterion) => criterion.points_awarded < criterion.points_possible * 0.7)
      .map((criterion) => criterion.reason)
      .slice(0, 3),
    evidence: input.result.rubric_results.map((criterion) => criterion.evidence).filter(Boolean),
    confidence,
    warnings,
    /** Only clean, high-confidence results may mutate the student-visible grade. */
    autoApplicable: !unableToGrade && !requiresReview,
    teacherAttention: unableToGrade
      ? "unable_to_grade"
      : input.result.requires_teacher_review || input.source === "teacher_review" || forceReview
        ? "review"
        : lowConfidence
          ? "caution"
          : "review",
  } as const;
}

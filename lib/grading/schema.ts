import { z } from "zod";
import type { GradingResult } from "@/lib/grading/contracts";
import { normalizeText } from "@/lib/grading/normalize";

const rubricResultSchema = z
  .object({
    criterion_id: z.string().trim().min(1).max(200),
    points_awarded: z.number().finite().min(0),
    points_possible: z.number().finite().positive(),
    evidence: z.string().max(500),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.points_awarded > value.points_possible) {
      context.addIssue({
        code: "custom",
        path: ["points_awarded"],
        message: "Points awarded cannot exceed points possible.",
      });
    }
  });

export const gradingResultSchema = z
  .object({
    score: z.number().finite().min(0),
    maximum_score: z.number().finite().positive(),
    confidence: z.number().finite().min(0).max(1),
    rubric_results: z.array(rubricResultSchema).min(1).max(100),
    feedback: z.string().trim().min(1).max(600),
    requires_teacher_review: z.boolean(),
    review_reason: z.string().trim().min(1).max(300).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.score > value.maximum_score) {
      context.addIssue({
        code: "custom",
        path: ["score"],
        message: "Score cannot exceed maximum score.",
      });
    }

    const criterionIds = value.rubric_results.map((result) => result.criterion_id);
    if (new Set(criterionIds).size !== criterionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["rubric_results"],
        message: "Rubric criterion IDs must be unique.",
      });
    }

    const awardedTotal = value.rubric_results.reduce(
      (total, result) => total + result.points_awarded,
      0
    );
    const possibleTotal = value.rubric_results.reduce(
      (total, result) => total + result.points_possible,
      0
    );
    if (!nearlyEqual(awardedTotal, value.score)) {
      context.addIssue({
        code: "custom",
        path: ["rubric_results"],
        message: "Rubric points awarded must add up to the score.",
      });
    }
    if (!nearlyEqual(possibleTotal, value.maximum_score)) {
      context.addIssue({
        code: "custom",
        path: ["rubric_results"],
        message: "Rubric points possible must add up to the maximum score.",
      });
    }

    if (value.requires_teacher_review && value.review_reason === null) {
      context.addIssue({
        code: "custom",
        path: ["review_reason"],
        message: "A review reason is required when teacher review is required.",
      });
    }
    if (!value.requires_teacher_review && value.review_reason !== null) {
      context.addIssue({
        code: "custom",
        path: ["review_reason"],
        message: "Review reason must be null when teacher review is not required.",
      });
    }
  });

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= 1e-9;
}

/**
 * Performs structural validation plus submission-aware evidence validation.
 * Evidence must be an exact excerpt of the normalized answer; paraphrases are
 * intentionally rejected. A blank excerpt is valid only for an empty answer or
 * a result explicitly routed to teacher review.
 */
export function validateGradingResult(input: unknown, studentAnswer: string): GradingResult {
  const normalizedAnswer = normalizeText(studentAnswer);
  const traceableSchema = gradingResultSchema.superRefine((value, context) => {
    for (const [index, result] of value.rubric_results.entries()) {
      if (!result.evidence) {
        if (normalizedAnswer && !value.requires_teacher_review) {
          context.addIssue({
            code: "custom",
            path: ["rubric_results", index, "evidence"],
            message: "Evidence is required unless the result is flagged for teacher review.",
          });
        }
        continue;
      }
      if (!normalizedAnswer.includes(result.evidence)) {
        context.addIssue({
          code: "custom",
          path: ["rubric_results", index, "evidence"],
          message: "Evidence must be an exact excerpt from the normalized student answer.",
        });
      }
    }
  });

  return traceableSchema.parse(input) as GradingResult;
}

const generatedJsonSchema = z.toJSONSchema(gradingResultSchema, { target: "draft-07" });
const { $schema: _jsonSchemaDialect, ...providerJsonSchema } = generatedJsonSchema;
void _jsonSchemaDialect;

/** Strict provider schema derived from the authoritative Zod contract. */
export const gradingResultJsonSchema = providerJsonSchema;

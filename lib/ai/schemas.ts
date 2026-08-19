import { z } from "zod";
import type { Rubric, RubricScore } from "@/lib/validation";

export const aiConfidenceSchema = z.enum(["high", "medium", "low"]);
export const aiTeacherAttentionSchema = z.enum(["review", "caution", "unable_to_grade"]);

export const aiGradingSuggestionSchema = z.object({
  suggestedScore: z.number().int().min(0).nullable(),
  rubricScores: z
    .array(
      z.object({
        criterionId: z.string().min(1).max(200),
        criterionName: z.string().min(1).max(200),
        maxPoints: z.number().int().min(1),
        awarded: z.number().int().min(0),
      }).strict()
    )
    .max(50),
  feedback: z.string().min(1).max(1000),
  strengths: z.array(z.string().min(1).max(500)).max(10),
  improvements: z.array(z.string().min(1).max(500)).max(10),
  evidence: z.array(z.string().min(1).max(500)).max(10),
  confidence: aiConfidenceSchema,
  warnings: z.array(z.string().min(1).max(500)).max(10),
  teacherAttention: aiTeacherAttentionSchema,
}).strict();

export type AiGradingSuggestion = z.infer<typeof aiGradingSuggestionSchema>;

export function normalizeAiSuggestion(input: unknown, rubric: Rubric | null, maxPoints: number) {
  const parsed = aiGradingSuggestionSchema.parse(input);
  const warnings = [...parsed.warnings];
  let rubricScores: RubricScore[] = [];
  let suggestedScore = parsed.suggestedScore;

  if (parsed.teacherAttention === "unable_to_grade") {
    return {
      ...parsed,
      suggestedScore: null,
      rubricScores: [],
      warnings,
    };
  }

  if (rubric) {
    const expectedIds = rubric.criteria.map((criterion) => String(criterion.id));
    const returnedIds = parsed.rubricScores.map((score) => score.criterionId);
    const uniqueReturnedIds = new Set(returnedIds);
    const exactRubricMatch =
      returnedIds.length === expectedIds.length &&
      uniqueReturnedIds.size === returnedIds.length &&
      expectedIds.every((criterionId) => uniqueReturnedIds.has(criterionId));

    if (!exactRubricMatch) {
      throw new Error("AI output did not match the assignment rubric. Please try again or grade manually.");
    }

    rubricScores = rubric.criteria.map((criterion) => {
      const criterionId = String(criterion.id);
      const raw = parsed.rubricScores.find((score) => score.criterionId === criterionId)!;
      const awarded = Math.max(0, Math.min(criterion.maxPoints, Math.round(raw.awarded)));
      return {
        criterionId,
        criterionName: String(criterion.name),
        maxPoints: criterion.maxPoints,
        awarded,
      };
    });
    suggestedScore = rubricScores.reduce((sum, score) => sum + score.awarded, 0);
  } else if (suggestedScore !== null) {
    suggestedScore = Math.max(0, Math.min(maxPoints, Math.round(suggestedScore)));
  }

  return {
    ...parsed,
    suggestedScore,
    rubricScores,
    warnings,
  };
}

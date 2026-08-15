import { z } from "zod";
import type { Rubric, RubricScore } from "@/lib/validation";

export const aiConfidenceSchema = z.enum(["high", "medium", "low"]);
export const aiTeacherAttentionSchema = z.enum(["review", "caution", "unable_to_grade"]);

export const aiGradingSuggestionSchema = z.object({
  suggestedScore: z.number().int().min(0).nullable(),
  rubricScores: z
    .array(
      z.object({
        criterionId: z.string().min(1),
        criterionName: z.string().min(1),
        maxPoints: z.number().int().min(1),
        awarded: z.number().int().min(0),
      })
    )
    .default([]),
  feedback: z.string().min(1).max(1000),
  strengths: z.array(z.string().min(1)).default([]),
  improvements: z.array(z.string().min(1)).default([]),
  evidence: z.array(z.string().min(1)).default([]),
  confidence: aiConfidenceSchema,
  warnings: z.array(z.string().min(1)).default([]),
  teacherAttention: aiTeacherAttentionSchema,
});

export type AiGradingSuggestion = z.infer<typeof aiGradingSuggestionSchema>;

export function normalizeAiSuggestion(input: unknown, rubric: Rubric | null, maxPoints: number) {
  const parsed = aiGradingSuggestionSchema.parse(input);
  const warnings = [...parsed.warnings];
  let rubricScores: RubricScore[] = [];
  let suggestedScore = parsed.suggestedScore;

  if (rubric) {
    rubricScores = rubric.criteria.map((criterion) => {
      const raw = parsed.rubricScores.find((score) => score.criterionId === criterion.id);
      const awarded = Math.max(0, Math.min(criterion.maxPoints, Math.round(Number(raw?.awarded ?? 0))));
      return {
        criterionId: criterion.id,
        criterionName: criterion.name,
        maxPoints: criterion.maxPoints,
        awarded,
      };
    });
    suggestedScore = rubricScores.reduce((sum, score) => sum + score.awarded, 0);
    if (parsed.rubricScores.length !== rubric.criteria.length) {
      warnings.push("Provider rubric scores were normalized to match the assignment rubric.");
    }
  } else if (suggestedScore !== null) {
    suggestedScore = Math.max(0, Math.min(maxPoints, Math.round(suggestedScore)));
  }

  if (parsed.teacherAttention === "unable_to_grade") {
    suggestedScore = null;
    rubricScores = [];
  }

  return {
    ...parsed,
    suggestedScore,
    rubricScores,
    warnings,
  };
}

import { describe, expect, it } from "vitest";
import type { GradingResult } from "@/lib/grading/contracts";
import {
  gradingResultJsonSchema,
  gradingResultSchema,
  validateGradingResult,
} from "@/lib/grading/schema";

function validResult(): GradingResult {
  return {
    score: 8,
    maximum_score: 10,
    confidence: 0.91,
    rubric_results: [
      {
        criterion_id: "content",
        points_awarded: 4,
        points_possible: 5,
        evidence: "plants use sunlight",
        reason: "The response identifies the energy source.",
      },
      {
        criterion_id: "process",
        points_awarded: 4,
        points_possible: 5,
        evidence: "carbon dioxide",
        reason: "The response names a required input.",
      },
    ],
    feedback: "Explain how glucose is produced to make the process complete.",
    requires_teacher_review: false,
    review_reason: null,
  };
}

describe("grading result schema", () => {
  it("accepts a strict, internally consistent result with exact evidence", () => {
    const answer = "The plants use sunlight and carbon dioxide to grow.";
    expect(validateGradingResult(validResult(), answer)).toMatchObject({
      score: 8,
      confidence: 0.91,
    });
  });

  it("rejects invented evidence, extra keys, invalid totals, and invalid review state", () => {
    expect(() => validateGradingResult(validResult(), "The response says something else.")).toThrow(
      /exact excerpt/i
    );
    expect(() => gradingResultSchema.parse({ ...validResult(), hidden_reasoning: "secret" })).toThrow();
    expect(() => gradingResultSchema.parse({ ...validResult(), score: 11 })).toThrow(/maximum score/i);
    expect(() =>
      gradingResultSchema.parse({ ...validResult(), requires_teacher_review: true })
    ).toThrow(/review reason/i);
  });

  it("allows missing evidence only when the result is explicitly routed to review", () => {
    const result = validResult();
    result.rubric_results[0]!.evidence = "";
    result.requires_teacher_review = true;
    result.review_reason = "The response does not contain criterion-level evidence.";

    expect(validateGradingResult(result, "carbon dioxide is mentioned").requires_teacher_review).toBe(true);
  });

  it("exports a provider JSON schema derived from the strict Zod contract", () => {
    expect(gradingResultJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect((gradingResultJsonSchema as { required?: string[] }).required).toContain("confidence");
  });
});

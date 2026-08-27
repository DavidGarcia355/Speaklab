import { describe, expect, it } from "vitest";
import type { ProviderGradeRequest } from "@/lib/grading/contracts";
import { buildGradingPrompt } from "@/lib/grading/providers";

function requestWithRubric(
  rubric: ProviderGradeRequest["assignment"]["rubric"],
): ProviderGradeRequest {
  return {
    assignment: {
      id: "assignment-1",
      type: "audio_response",
      question: "Describe your weekend.",
      instructions: "Answer in Spanish.",
      targetLanguage: "Spanish",
      maximumScore: 10,
      version: "assignment-v1",
      rubric,
    },
    studentAnswer: "Fui al parque con mi familia.",
    promptVersion: "grading-v1",
    model: { provider: "openai", model: "gpt-5-nano" },
    attempt: "cheap",
  };
}

describe("grading prompt rubric contract", () => {
  it("requires one exact overall result when the assignment has no rubric", () => {
    const prompt = buildGradingPrompt(requestWithRubric(null));

    expect(prompt).toContain(
      'Return exactly 1 rubric_results entry, in this exact order, with these exact criterion_id values: ["overall"].',
    );
    expect(prompt).toContain("Do not add, omit, merge, rename, or reorder rubric criteria.");
  });

  it("requires every rubric criterion in the exact configured order", () => {
    const prompt = buildGradingPrompt(
      requestWithRubric({
        version: "rubric-v1",
        criteria: [
          { id: "content", description: "Addresses the prompt", pointsPossible: 4 },
          { id: "accuracy", description: "Uses accurate language", pointsPossible: 3 },
          { id: "fluency", description: "Responds fluently", pointsPossible: 3 },
        ],
      }),
    );

    expect(prompt).toContain(
      'Return exactly 3 rubric_results entries, in this exact order, with these exact criterion_id values: ["content","accuracy","fluency"].',
    );
    expect(prompt).toContain("Do not add, omit, merge, rename, or reorder rubric criteria.");
  });
});

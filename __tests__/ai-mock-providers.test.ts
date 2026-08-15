import { describe, expect, it } from "vitest";
import { getAiConfig } from "@/lib/ai/config";
import { mockGrade, mockTranscribe } from "@/lib/ai/mock";
import { normalizeAiSuggestion } from "@/lib/ai/schemas";
import type { Rubric } from "@/lib/validation";

describe("local AI mock providers", () => {
  it("returns a deterministic valid transcript", () => {
    process.env.AI_TRANSCRIPTION_PROVIDER = "mock";
    process.env.AI_GRADING_PROVIDER = "mock";
    process.env.AI_LOCAL_FAILURE_MODE = "";

    const result = mockTranscribe(getAiConfig());

    expect(result.transcript).toContain("Hola");
    expect(result.detectedLanguage).toBe("Spanish");
    expect(result.quality).toBe("good");
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  it("returns one normalized rubric score per criterion", () => {
    process.env.AI_TRANSCRIPTION_PROVIDER = "mock";
    process.env.AI_GRADING_PROVIDER = "mock";
    process.env.AI_LOCAL_FAILURE_MODE = "";
    const rubric: Rubric = {
      title: "Speaking",
      criteria: [
        { id: "content", name: "Content", description: "", maxPoints: 5 },
        { id: "language", name: "Language", description: "", maxPoints: 5 },
      ],
    };

    const raw = mockGrade({
      config: getAiConfig(),
      rubric,
      maxPoints: 10,
      transcript: "Hola. Tengo clase de espanol.",
    });
    const normalized = normalizeAiSuggestion(raw, rubric, 10);

    expect(normalized.rubricScores).toHaveLength(2);
    expect(normalized.rubricScores.map((score) => score.criterionId)).toEqual(["content", "language"]);
    expect(normalized.suggestedScore).toBe(
      normalized.rubricScores.reduce((sum, score) => sum + score.awarded, 0)
    );
  });
});

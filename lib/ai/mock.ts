import "server-only";
import type { Rubric } from "@/lib/validation";
import type { AiConfig } from "@/lib/ai/config";
import type { AiGradingSuggestion } from "@/lib/ai/schemas";

export type MockTranscript = {
  transcript: string;
  detectedLanguage: string;
  quality: "good" | "low";
  durationSeconds: number;
};

export function mockTranscribe(config: AiConfig): MockTranscript {
  if (config.failureMode === "transcription_failure") {
    throw new Error("Mock transcription failure requested.");
  }
  if (config.failureMode === "provider_timeout") {
    throw new Error("Mock provider timeout requested.");
  }
  const lowQuality = config.failureMode === "low_quality_transcript";
  const mismatch = config.failureMode === "target_language_mismatch";
  return {
    transcript: lowQuality
      ? "Audio is faint. I can hear a greeting and a few classroom vocabulary words."
      : "Hola, me llamo Alex. Para mi presentacion, describo mi escuela y mi rutina. Primero tengo clase de espanol. Despues estudio matematicas y hablo con mis amigos. Necesito practicar la pronunciacion, pero puedo explicar mis ideas con detalles.",
    detectedLanguage: mismatch ? "English" : "Spanish",
    quality: lowQuality ? "low" : "good",
    durationSeconds: 42,
  };
}

export function mockGrade(input: {
  config: AiConfig;
  rubric: Rubric | null;
  maxPoints: number;
  transcript: string;
}): AiGradingSuggestion {
  const { config, rubric, maxPoints, transcript } = input;
  if (config.failureMode === "grading_failure") {
    throw new Error("Mock grading failure requested.");
  }
  if (config.failureMode === "malformed_provider_output") {
    return { feedback: "" } as AiGradingSuggestion;
  }
  if (config.failureMode === "unable_to_grade") {
    return {
      suggestedScore: null,
      rubricScores: [],
      feedback: "The transcript is not clear enough to suggest a grade. Please review the recording manually.",
      strengths: [],
      improvements: ["Review the audio directly before scoring."],
      evidence: [],
      confidence: "low",
      warnings: ["Mock unable-to-grade state requested."],
      teacherAttention: "unable_to_grade",
    };
  }

  const warnings = config.failureMode === "target_language_mismatch"
    ? ["Detected language may not match the assignment target language."]
    : [];
  if (config.failureMode === "low_quality_transcript") warnings.push("Transcript quality is low.");

  const rubricScores = rubric
    ? rubric.criteria.map((criterion, index) => ({
        criterionId: String(criterion.id),
        criterionName: String(criterion.name),
        maxPoints: criterion.maxPoints,
        awarded: Math.max(0, Math.min(criterion.maxPoints, criterion.maxPoints - (index % 2))),
      }))
    : [];

  const suggestedScore = rubric
    ? rubricScores.reduce((sum, score) => sum + score.awarded, 0)
    : Math.max(0, Math.min(maxPoints, Math.round(maxPoints * 0.82)));

  return {
    suggestedScore,
    rubricScores,
    feedback:
      "Mock suggestion: The response addresses the prompt with understandable details and some developing accuracy. Review pronunciation and completeness before saving a final grade.",
    strengths: ["Includes relevant personal details.", "Uses connected sentences."],
    improvements: ["Add more precise vocabulary.", "Review pronunciation before final scoring."],
    evidence: [transcript.slice(0, 140)],
    confidence: config.failureMode === "low_quality_transcript" ? "low" : "medium",
    warnings,
    teacherAttention: warnings.length > 0 ? "caution" : "review",
  };
}

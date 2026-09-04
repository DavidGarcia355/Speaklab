import { describe, expect, it } from "vitest";
import {
  STUDENT_AI_GRADING_DISCLOSURE,
  studentGradeProvenance,
} from "@/lib/ai/student-provenance";

describe("student-visible AI grade provenance", () => {
  it("labels teacher-approved AI-assisted output without attributing it to the teacher", () => {
    expect(studentGradeProvenance("ai")).toEqual({
      badge: "AI-generated · teacher editable",
      feedbackLabel: "AI-generated feedback",
    });
    expect(studentGradeProvenance("teacher")).toEqual({
      badge: null,
      feedbackLabel: "Teacher feedback",
    });
  });

  it("discloses provider processing, stored AI output, and teacher editability", () => {
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("AI transcription or grading");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("recorded answer");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("configured for this TryHabla deployment");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("may store the transcript");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("suggestions stay private to your teacher");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("reviews them and saves the final grade or feedback");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("edit, replace, or decline any suggestion");
    expect(STUDENT_AI_GRADING_DISCLOSURE).not.toContain("visible before your teacher reviews");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("whether AI is authorized");
    expect(STUDENT_AI_GRADING_DISCLOSURE).not.toContain("school's approved AI provider");
  });
});

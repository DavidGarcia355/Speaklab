import { describe, expect, it } from "vitest";
import {
  STUDENT_AI_GRADING_DISCLOSURE,
  studentGradeProvenance,
} from "@/lib/ai/student-provenance";

describe("student-visible AI grade provenance", () => {
  it("labels automatically saved AI output without attributing it to the teacher", () => {
    expect(studentGradeProvenance("ai")).toEqual({
      badge: "AI-generated · teacher editable",
      feedbackLabel: "AI-generated feedback",
    });
    expect(studentGradeProvenance("teacher")).toEqual({
      badge: null,
      feedbackLabel: "Teacher feedback",
    });
  });

  it("discloses automatic generation, provider processing, and teacher editability", () => {
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("AI can generate a score and feedback automatically");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("AI-generated results are labeled");
    expect(STUDENT_AI_GRADING_DISCLOSURE).toContain("teacher can review, edit, or replace them");
  });
});

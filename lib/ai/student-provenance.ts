export type StudentGradeSource = "ai" | "teacher";

export const STUDENT_AI_GRADING_DISCLOSURE =
  "Your teacher may enable optional AI grading for this recording. When enabled, the audio, " +
  "transcript, assignment, and rubric may be processed by the school's approved AI provider. " +
  "AI can generate a score and feedback automatically; AI-generated results are labeled, and " +
  "your teacher can review, edit, or replace them.";

export function studentGradeProvenance(source: StudentGradeSource) {
  return source === "ai"
    ? {
        badge: "AI-generated · teacher editable",
        feedbackLabel: "AI-generated feedback",
      }
    : {
        badge: null,
        feedbackLabel: "Teacher feedback",
      };
}

export type StudentGradeSource = "ai" | "teacher";

export const STUDENT_AI_GRADING_DISCLOSURE =
  "Your teacher may enable optional AI grading for this recording. When enabled, your recorded " +
  "answer, a transcript, the assignment instructions, and any rubric are processed by the AI " +
  "provider or providers configured for this Habla deployment. Habla may store the transcript and " +
  "the AI-generated score, rubric details, feedback, and provider/model details with your " +
  "submission. AI-generated results are labeled and may be visible before your teacher reviews " +
  "them; your teacher can review, edit, or replace them. Your teacher or school is responsible " +
  "for deciding whether AI is authorized for this activity; Habla remains responsible for " +
  "describing and handling its own processing.";

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

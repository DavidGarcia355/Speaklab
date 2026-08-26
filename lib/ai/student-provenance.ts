export type StudentGradeSource = "ai" | "teacher";

export const STUDENT_AI_GRADING_DISCLOSURE =
  "Your teacher may enable optional AI transcription or grading for this recording. When your " +
  "teacher requests either feature, your recorded answer is processed by the AI provider or " +
  "providers configured for this TryHabla deployment. TryHabla may store the transcript with your " +
  "submission. If grading is requested, the transcript, assignment instructions, and any rubric " +
  "may also be processed, and TryHabla may store the AI-generated score, rubric details, feedback, " +
  "and provider/model details. AI-generated grades and feedback are labeled and may be visible " +
  "before your teacher reviews them; your teacher can review, edit, or replace them. Your teacher " +
  "or school is responsible for deciding whether AI is authorized for this activity; TryHabla " +
  "remains responsible for describing and handling its own processing.";

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

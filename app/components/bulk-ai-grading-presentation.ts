export const BULK_AI_CONFIRM_LABEL = "Start AI grading";
export const BULK_AI_CANCEL_LABEL = "Not now";

export const BULK_AI_SUPPORT_COPY =
  "Get suggested scores, rubric feedback, and comments for every ungraded submission. Review everything before saving.";

export const INDIVIDUAL_AI_ACTION_LABEL = "Grade this submission with AI";
export const INDIVIDUAL_AI_SUPPORT_COPY =
  "Generate a suggested score, rubric breakdown, and editable feedback. You make the final call.";

export const BULK_AI_REVIEW_DISCLOSURE =
  "TryHabla will process every eligible recording and prepare suggested scores, rubric feedback, and comments. Nothing is saved to student submissions until you review and approve the results.";

export const BULK_AI_QUEUE_CLEAR_COPY = "No AI grading action is needed for this queue.";

export function bulkAiPrimaryLabel(ungradedCount: number) {
  if (ungradedCount <= 0) return "No grades waiting";
  return `Grade all ${ungradedCount} with AI`;
}

export function bulkAiConfirmationTitle(ungradedCount: number) {
  return `Grade ${ungradedCount} submission${ungradedCount === 1 ? "" : "s"} with AI?`;
}

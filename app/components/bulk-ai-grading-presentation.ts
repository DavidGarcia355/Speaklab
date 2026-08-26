export const BULK_AI_CONFIRM_LABEL = "Yes, use AI grades";
export const BULK_AI_CANCEL_LABEL = "No, keep ungraded";

export const BULK_AI_REVIEW_DISCLOSURE =
  "TryHabla will process every eligible recording. Grades that pass the grading safeguards are saved automatically, shown to students immediately, and marked Needs teacher review. Uncertain results remain suggestion-only or are skipped.";

export function bulkAiConfirmationTitle(ungradedCount: number) {
  return `Use AI grades for all ${ungradedCount} ungraded submission${ungradedCount === 1 ? "" : "s"}?`;
}

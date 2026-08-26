import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiGradeReviewBadge, {
  AI_GRADE_REVIEW_LABEL,
} from "@/app/components/AiGradeReviewBadge";
import {
  BULK_AI_CANCEL_LABEL,
  BULK_AI_CONFIRM_LABEL,
  BULK_AI_REVIEW_DISCLOSURE,
  bulkAiConfirmationTitle,
} from "@/app/components/bulk-ai-grading-presentation";

describe("teacher AI-grade review UX", () => {
  it("renders a persistent human-review flag for a saved AI grade", () => {
    const markup = renderToStaticMarkup(
      <AiGradeReviewBadge grade={18} gradeSource="ai" />,
    );

    expect(markup).toContain(AI_GRADE_REVIEW_LABEL);
    expect(markup).toContain("status-warning");
    expect(markup).toContain("should be reviewed by the teacher");
  });

  it("does not flag manual or empty grades as AI grades", () => {
    expect(renderToStaticMarkup(
      <AiGradeReviewBadge grade={18} gradeSource="teacher" />,
    )).toBe("");
    expect(renderToStaticMarkup(
      <AiGradeReviewBadge grade={null} gradeSource="ai" />,
    )).toBe("");
  });

  it("uses an explicit yes-or-no approval before bulk AI grades are applied", () => {
    expect(bulkAiConfirmationTitle(4)).toBe(
      "Use AI grades for all 4 ungraded submissions?",
    );
    expect(bulkAiConfirmationTitle(1)).toBe(
      "Use AI grades for all 1 ungraded submission?",
    );
    expect(BULK_AI_CONFIRM_LABEL).toMatch(/^Yes,/);
    expect(BULK_AI_CANCEL_LABEL).toMatch(/^No,/);
    expect(BULK_AI_REVIEW_DISCLOSURE).toContain("every eligible recording");
    expect(BULK_AI_REVIEW_DISCLOSURE).toContain("Needs teacher review");
    expect(BULK_AI_REVIEW_DISCLOSURE).toContain("suggestion-only or are skipped");
  });
});

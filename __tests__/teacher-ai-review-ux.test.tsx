import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiGradeReviewBadge, {
  AI_GRADE_REVIEW_LABEL,
} from "@/app/components/AiGradeReviewBadge";
import {
  BULK_AI_CANCEL_LABEL,
  BULK_AI_CONFIRM_LABEL,
  BULK_AI_QUEUE_CLEAR_COPY,
  BULK_AI_REVIEW_DISCLOSURE,
  BULK_AI_SUPPORT_COPY,
  INDIVIDUAL_AI_ACTION_LABEL,
  INDIVIDUAL_AI_SUPPORT_COPY,
  bulkAiConfirmationTitle,
  bulkAiPrimaryLabel,
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

  it("makes assignment-wide AI grading the explicit, dynamic primary workflow", () => {
    expect(bulkAiPrimaryLabel(8)).toBe("Grade all 8 with AI");
    expect(bulkAiPrimaryLabel(1)).toBe("Grade all 1 with AI");
    expect(bulkAiPrimaryLabel(0)).toBe("No grades waiting");
    expect(BULK_AI_QUEUE_CLEAR_COPY).toBe("No AI grading action is needed for this queue.");
    expect(BULK_AI_SUPPORT_COPY).toBe(
      "Get suggested scores, rubric feedback, and comments for every ungraded submission. Review everything before saving.",
    );
  });

  it("uses an explicit confirmation before AI units are consumed", () => {
    expect(bulkAiConfirmationTitle(4)).toBe(
      "Grade 4 submissions with AI?",
    );
    expect(bulkAiConfirmationTitle(1)).toBe(
      "Grade 1 submission with AI?",
    );
    expect(BULK_AI_CONFIRM_LABEL).toBe("Start AI grading");
    expect(BULK_AI_CANCEL_LABEL).toBe("Not now");
    expect(BULK_AI_REVIEW_DISCLOSURE).toContain("every eligible recording");
    expect(BULK_AI_REVIEW_DISCLOSURE).toContain("Nothing is saved");
    expect(BULK_AI_REVIEW_DISCLOSURE).toContain("review and approve");
    expect(BULK_AI_REVIEW_DISCLOSURE).not.toContain("shown to students immediately");
    expect(BULK_AI_REVIEW_DISCLOSURE).not.toContain("saved automatically");
  });

  it("positions the individual AI action as an editable suggestion, not a final decision", () => {
    expect(INDIVIDUAL_AI_ACTION_LABEL).toBe("Grade this submission with AI");
    expect(INDIVIDUAL_AI_SUPPORT_COPY).toBe(
      "Generate a suggested score, rubric breakdown, and editable feedback. You make the final call.",
    );
  });
});

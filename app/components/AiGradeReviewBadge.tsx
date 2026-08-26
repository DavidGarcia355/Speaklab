export const AI_GRADE_REVIEW_LABEL = "AI grade: Needs teacher review";

type AiGradeReviewBadgeProps = {
  grade: number | null;
  gradeSource: "teacher" | "ai";
};

export default function AiGradeReviewBadge({
  grade,
  gradeSource,
}: AiGradeReviewBadgeProps) {
  if (grade === null || gradeSource !== "ai") return null;

  return (
    <span
      className="status-badge status-warning"
      title="This grade was saved by AI and should be reviewed by the teacher."
    >
      {AI_GRADE_REVIEW_LABEL}
    </span>
  );
}

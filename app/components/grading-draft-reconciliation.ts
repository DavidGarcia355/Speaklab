export type GradingRubricScore = {
  criterionId: string;
  criterionName: string;
  maxPoints: number;
  awarded: number;
};

export type GradingSubmissionSnapshot = {
  id: string;
  assignmentId: string;
  grade: number | null;
  feedback: string;
  gradeSource: "teacher" | "ai";
  rubricScores: GradingRubricScore[] | null;
};

export type GradingAssignmentSnapshot = {
  id: string;
  rubric: {
    criteria: { id: string }[];
  } | null;
};

export type GradingDraftState = {
  gradeInput: string;
  feedback: string;
  saving: boolean;
  rubricScoreInputs: Record<string, string>;
};

export type SavedBatchItemSnapshot = {
  submissionId: string;
  status: string;
  draft: {
    grade: number | null;
    feedback: string;
    rubricScores: GradingRubricScore[] | null;
  };
};

function assignmentMap(assignments: readonly GradingAssignmentSnapshot[]) {
  return new Map(assignments.map((assignment) => [assignment.id, assignment]));
}

function rubricInputsFromSnapshot(
  submission: GradingSubmissionSnapshot,
  assignment: GradingAssignmentSnapshot | null,
) {
  if (!assignment?.rubric) return {};
  return Object.fromEntries(
    assignment.rubric.criteria.map((criterion) => {
      const score = submission.rubricScores?.find(
        (entry) => entry.criterionId === criterion.id,
      );
      return [criterion.id, score ? String(score.awarded) : ""];
    }),
  );
}

function draftFromSubmission(
  submission: GradingSubmissionSnapshot,
  assignment: GradingAssignmentSnapshot | null,
): GradingDraftState {
  return {
    gradeInput: submission.grade === null ? "" : String(submission.grade),
    feedback: submission.feedback ?? "",
    saving: false,
    rubricScoreInputs: rubricInputsFromSnapshot(submission, assignment),
  };
}

export function gradingDraftIsDirty(
  draft: GradingDraftState | undefined,
  submission: GradingSubmissionSnapshot,
  assignment: GradingAssignmentSnapshot | null,
) {
  if (!draft) return false;
  if (draft.saving || draft.feedback !== (submission.feedback ?? "")) return true;

  if (assignment?.rubric) {
    return assignment.rubric.criteria.some((criterion) => {
      const saved = submission.rubricScores?.find(
        (score) => score.criterionId === criterion.id,
      );
      return (draft.rubricScoreInputs[criterion.id]?.trim() ?? "") !==
        (saved ? String(saved.awarded) : "");
    });
  }

  const value = draft.gradeInput.trim();
  if (submission.grade === null) return value !== "";
  return value === "" || !Number.isFinite(Number(value)) || Number(value) !== submission.grade;
}

export function cleanBatchSavedDraftIds(input: {
  batchItems: readonly SavedBatchItemSnapshot[];
  drafts: Readonly<Record<string, GradingDraftState>>;
  submissions: readonly GradingSubmissionSnapshot[];
  assignments: readonly GradingAssignmentSnapshot[];
}) {
  const savedSubmissionIds = new Set(
    input.batchItems
      .filter((item) => item.status === "saved" && item.draft.grade !== null)
      .map((item) => item.submissionId),
  );
  const assignments = assignmentMap(input.assignments);

  return new Set(
    input.submissions
      .filter((submission) => savedSubmissionIds.has(submission.id))
      .filter((submission) => !gradingDraftIsDirty(
        input.drafts[submission.id],
        submission,
        assignments.get(submission.assignmentId) ?? null,
      ))
      .map((submission) => submission.id),
  );
}

export function applyBatchSavedGrades<TSubmission extends GradingSubmissionSnapshot>(input: {
  submissions: readonly TSubmission[];
  batchItems: readonly SavedBatchItemSnapshot[];
}) {
  const savedBySubmissionId = new Map(
    input.batchItems
      .filter((item) => item.status === "saved" && item.draft.grade !== null)
      .map((item) => [item.submissionId, item]),
  );

  return input.submissions.map((submission) => {
    const saved = savedBySubmissionId.get(submission.id);
    if (!saved) return submission;
    return {
      ...submission,
      grade: saved.draft.grade,
      feedback: saved.draft.feedback,
      gradeSource: "teacher" as const,
      rubricScores: saved.draft.rubricScores,
    };
  });
}

export function mergeGradingDraftsFromServer(input: {
  previousDrafts: Readonly<Record<string, GradingDraftState>>;
  submissions: readonly GradingSubmissionSnapshot[];
  assignments: readonly GradingAssignmentSnapshot[];
  resetSubmissionIds?: ReadonlySet<string>;
}) {
  const next: Record<string, GradingDraftState> = { ...input.previousDrafts };
  const assignments = assignmentMap(input.assignments);

  for (const submission of input.submissions) {
    const previous = input.previousDrafts[submission.id];
    if (previous && !input.resetSubmissionIds?.has(submission.id)) {
      next[submission.id] = { ...previous, saving: false };
      continue;
    }
    next[submission.id] = draftFromSubmission(
      submission,
      assignments.get(submission.assignmentId) ?? null,
    );
  }

  return next;
}

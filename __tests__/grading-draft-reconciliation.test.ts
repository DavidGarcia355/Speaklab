import { describe, expect, it } from "vitest";
import {
  applyBatchSavedGrades,
  cleanBatchSavedDraftIds,
  gradingDraftIsDirty,
  mergeGradingDraftsFromServer,
  type GradingAssignmentSnapshot,
  type GradingDraftState,
  type GradingSubmissionSnapshot,
  type SavedBatchItemSnapshot,
} from "@/app/components/grading-draft-reconciliation";

const assignment: GradingAssignmentSnapshot = { id: "assignment_1", rubric: null };

function submission(id: string): GradingSubmissionSnapshot {
  return {
    id,
    assignmentId: assignment.id,
    grade: null,
    feedback: "",
    gradeSource: "teacher",
    rubricScores: null,
  };
}

function draft(gradeInput = "", feedback = ""): GradingDraftState {
  return { gradeInput, feedback, saving: false, rubricScoreInputs: {} };
}

function savedItem(
  submissionId: string,
  grade: number,
  feedback: string,
): SavedBatchItemSnapshot {
  return {
    submissionId,
    status: "saved",
    draft: { grade, feedback, rubricScores: null },
  };
}

describe("post-batch-save grading draft reconciliation", () => {
  it("hydrates every clean saved row while preserving a genuine manual draft", () => {
    const beforeSave = [
      submission("alex"),
      submission("ana"),
      submission("chloe"),
      submission("manual"),
    ];
    const previousDrafts = {
      alex: draft(),
      ana: draft(),
      chloe: draft(),
      manual: draft("19", "My in-progress note"),
    };
    const batchItems = [
      savedItem("alex", 12, "Keep practicing."),
      savedItem("ana", 16, "Strong detail."),
      savedItem("chloe", 18, "Clear and fluent."),
      savedItem("manual", 14, "AI suggestion."),
    ];

    const resetSubmissionIds = cleanBatchSavedDraftIds({
      batchItems,
      drafts: previousDrafts,
      submissions: beforeSave,
      assignments: [assignment],
    });
    expect([...resetSubmissionIds].sort()).toEqual(["alex", "ana", "chloe"]);

    const savedSubmissions = applyBatchSavedGrades({
      submissions: beforeSave,
      batchItems,
    });
    const nextDrafts = mergeGradingDraftsFromServer({
      previousDrafts,
      submissions: savedSubmissions,
      assignments: [assignment],
      resetSubmissionIds,
    });

    expect(nextDrafts.alex).toMatchObject({ gradeInput: "12", feedback: "Keep practicing." });
    expect(nextDrafts.ana).toMatchObject({ gradeInput: "16", feedback: "Strong detail." });
    expect(nextDrafts.chloe).toMatchObject({ gradeInput: "18", feedback: "Clear and fluent." });

    for (const id of ["alex", "ana", "chloe"]) {
      const saved = savedSubmissions.find((entry) => entry.id === id)!;
      expect(gradingDraftIsDirty(nextDrafts[id], saved, assignment)).toBe(false);
    }

    const manuallyEdited = savedSubmissions.find((entry) => entry.id === "manual")!;
    expect(nextDrafts.manual).toEqual(previousDrafts.manual);
    expect(gradingDraftIsDirty(nextDrafts.manual, manuallyEdited, assignment)).toBe(true);
    expect(savedSubmissions.every((entry) => entry.gradeSource === "teacher")).toBe(true);
  });

  it("hydrates saved rubric criteria but leaves manual and unsuccessful rows alone", () => {
    const rubricAssignment: GradingAssignmentSnapshot = {
      id: "rubric_assignment",
      rubric: { criteria: [{ id: "ideas" }, { id: "fluency" }] },
    };
    const cleanRubric = { ...submission("rubric_clean"), assignmentId: rubricAssignment.id };
    const manualRubric = { ...submission("rubric_manual"), assignmentId: rubricAssignment.id };
    const failed = { ...submission("failed"), assignmentId: rubricAssignment.id };
    const previousDrafts = {
      rubric_clean: { ...draft(), rubricScoreInputs: { ideas: "", fluency: "" } },
      rubric_manual: { ...draft(), rubricScoreInputs: { ideas: "5", fluency: "" } },
      failed: { ...draft(), rubricScoreInputs: { ideas: "", fluency: "" } },
    };
    const rubricScores = [
      { criterionId: "ideas", criterionName: "Ideas", maxPoints: 10, awarded: 9 },
      { criterionId: "fluency", criterionName: "Fluency", maxPoints: 10, awarded: 8 },
    ];
    const batchItems: SavedBatchItemSnapshot[] = [
      {
        submissionId: cleanRubric.id,
        status: "saved",
        draft: { grade: 17, feedback: "Reviewed.", rubricScores },
      },
      {
        submissionId: manualRubric.id,
        status: "saved",
        draft: { grade: 17, feedback: "Reviewed.", rubricScores },
      },
      {
        submissionId: failed.id,
        status: "failed",
        draft: { grade: 17, feedback: "Must not apply.", rubricScores },
      },
    ];
    const beforeSave = [cleanRubric, manualRubric, failed];

    const resetSubmissionIds = cleanBatchSavedDraftIds({
      batchItems,
      drafts: previousDrafts,
      submissions: beforeSave,
      assignments: [rubricAssignment],
    });
    expect([...resetSubmissionIds]).toEqual([cleanRubric.id]);

    const savedSubmissions = applyBatchSavedGrades({ submissions: beforeSave, batchItems });
    const nextDrafts = mergeGradingDraftsFromServer({
      previousDrafts,
      submissions: savedSubmissions,
      assignments: [rubricAssignment],
      resetSubmissionIds,
    });

    expect(nextDrafts.rubric_clean.rubricScoreInputs).toEqual({ ideas: "9", fluency: "8" });
    expect(gradingDraftIsDirty(
      nextDrafts.rubric_clean,
      savedSubmissions.find((entry) => entry.id === cleanRubric.id)!,
      rubricAssignment,
    )).toBe(false);
    expect(nextDrafts.rubric_manual).toEqual(previousDrafts.rubric_manual);
    expect(savedSubmissions.find((entry) => entry.id === failed.id)?.grade).toBeNull();
    expect(nextDrafts.failed).toEqual(previousDrafts.failed);
  });
});

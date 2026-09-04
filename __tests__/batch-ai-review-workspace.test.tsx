import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BatchAiReviewWorkspace, {
  buildBulkAiReviewDraftSaveItems,
  buildBulkAiReviewSaveItems,
} from "@/app/components/BatchAiReviewWorkspace";
import type {
  BulkAiBatch,
  BulkAiBatchItem,
} from "@/app/components/bulk-ai-grade-runner";

function item(
  id: string,
  status: BulkAiBatchItem["status"],
  overrides: Partial<BulkAiBatchItem> = {},
): BulkAiBatchItem {
  return {
    id,
    submissionId: `submission_${id}`,
    studentName: id === "ready" ? "Alex Rivera" : `Student ${id}`,
    studentEmail: `${id}@students.example.test`,
    submittedAt: 1,
    ordinal: 0,
    status,
    attemptId: status === "review_ready" ? `attempt_${id}` : null,
    attempt: status === "review_ready"
      ? {
          id: `attempt_${id}`,
          status: "completed",
          transcript: "Hola, this tradition matters to me.",
          suggestedScore: 17,
          rubricScores: [],
          feedback: "Clear and specific.",
          strengths: ["Clear explanation"],
          improvements: ["Add one example"],
          evidence: ["this tradition"],
          confidence: "high",
          warnings: [],
          teacherAttention: "review",
          errorMessage: "",
        }
      : null,
    errorCode: "",
    errorMessage: "",
    retryCount: 0,
    teacherEdited: false,
    draft: {
      grade: status === "review_ready" ? 17 : null,
      rubricScores: null,
      feedback: status === "review_ready" ? "Clear and specific." : "",
    },
    updatedAt: 1,
    ...overrides,
  };
}

function batch(items: BulkAiBatchItem[]): BulkAiBatch {
  const count = (status: BulkAiBatchItem["status"]) =>
    items.filter((entry) => entry.status === status).length;
  return {
    id: "batch_1",
    assignmentId: "assignment_1",
    assignmentTitle: "A tradition that matters to me",
    assignmentFingerprint: "fingerprint",
    status: items.some((entry) => entry.status === "failed")
      ? "partial_failure"
      : "review_ready",
    eligibleCount: items.length,
    newUnitsRequired: 2,
    transcriptsRequired: 2,
    savedTranscripts: 0,
    enhanced: false,
    counts: {
      total: items.length,
      queued: count("queued"),
      processing: count("processing"),
      reviewReady: count("review_ready"),
      failed: count("failed"),
      skipped: count("skipped"),
      saved: count("saved"),
      conflict: count("conflict"),
    },
    items,
    createdAt: 1,
    updatedAt: 1,
    completedAt: 2,
    savedAt: null,
  };
}

describe("batch AI review workspace", () => {
  it("makes every staged score and comment editable before an explicit save", () => {
    const markup = renderToStaticMarkup(
      <BatchAiReviewWorkspace
        batch={batch([item("ready", "review_ready")])}
        maxPoints={20}
        rubric={null}
        saving={false}
        onSave={vi.fn()}
        onRetryFailed={vi.fn()}
        onDismiss={vi.fn()}
        onBackToManual={vi.fn()}
        onBatchUpdated={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-labelledby="batch-ai-review-title"');
    expect(markup).toContain("Review every suggestion");
    expect(markup).toContain("Nothing below is visible to students until you choose");
    expect(markup).toContain('aria-label="AI grading review summary"');
    expect(markup).toContain("Alex Rivera");
    expect(markup).toContain("Score");
    expect(markup).toContain('type="number"');
    expect(markup).toContain('min="0"');
    expect(markup).toContain('max="20"');
    expect(markup).toContain("Feedback for Alex Rivera");
    expect(markup).toContain("Listen before saving");
    expect(markup).toContain("/api/submissions/submission_ready/audio");
    expect(markup).toContain("Why AI suggested this");
    expect(markup).toContain("Save all scores");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Students will see them only after you save.");
  });

  it("shows partial failures and conflicts without pretending they were graded", () => {
    const markup = renderToStaticMarkup(
      <BatchAiReviewWorkspace
        batch={batch([
          item("ready", "review_ready"),
          item("failed", "failed", { errorMessage: "Provider timed out." }),
          item("skipped", "skipped"),
          item("conflict", "conflict"),
        ])}
        maxPoints={20}
        rubric={null}
        saving={false}
        onSave={vi.fn()}
        onRetryFailed={vi.fn()}
        onDismiss={vi.fn()}
        onBackToManual={vi.fn()}
        onBatchUpdated={vi.fn()}
      />,
    );

    expect(markup).toContain("Needs your attention");
    expect(markup).toContain("These submissions were not changed.");
    expect(markup).toContain("AI could not finish - Provider timed out.");
    expect(markup).toContain("Needs manual grading");
    expect(markup).toContain("Changed since this run");
    expect(markup).toContain("Retry failed");
    expect(markup).not.toContain("Dismiss this batch");
    expect(markup).toContain("1 score ready");
  });

  it("offers dismissal only when a terminal batch has exceptions and no suggestions left", () => {
    const markup = renderToStaticMarkup(
      <BatchAiReviewWorkspace
        batch={batch([item("failed", "failed", { errorMessage: "Provider timed out." })])}
        maxPoints={20}
        rubric={null}
        saving={false}
        onSave={vi.fn()}
        onRetryFailed={vi.fn()}
        onDismiss={vi.fn()}
        onBackToManual={vi.fn()}
        onBatchUpdated={vi.fn()}
      />,
    );

    expect(markup).toContain("Dismiss this batch");
    expect(markup).toContain("Retry failed");
    expect(markup).toContain("No AI suggestions are waiting.");
  });

  it("announces saving, disables editing, and exposes server errors as alerts", () => {
    const markup = renderToStaticMarkup(
      <BatchAiReviewWorkspace
        batch={batch([item("ready", "review_ready")])}
        maxPoints={20}
        rubric={null}
        saving
        saveError="A submission changed. Nothing was saved."
        onSave={vi.fn()}
        onRetryFailed={vi.fn()}
        onDismiss={vi.fn()}
        onBackToManual={vi.fn()}
        onBatchUpdated={vi.fn()}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("A submission changed. Nothing was saved.");
    expect(markup).toContain("Saving the reviewed scores...");
    expect(markup).toContain("Saving all scores...");
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("batch AI review validation", () => {
  it("hydrates a persisted teacher edit after a reload or retry remount", () => {
    const persisted = item("ready", "review_ready", {
      draft: {
        grade: 19,
        rubricScores: null,
        feedback: "Teacher edit restored from the private batch draft.",
      },
    });
    const markup = renderToStaticMarkup(
      <BatchAiReviewWorkspace
        batch={batch([persisted, item("retried", "review_ready")])}
        maxPoints={20}
        rubric={null}
        saving={false}
        onSave={vi.fn()}
        onRetryFailed={vi.fn()}
        onDismiss={vi.fn()}
        onBackToManual={vi.fn()}
        onBatchUpdated={vi.fn()}
      />,
    );

    expect(markup).toContain('value="19"');
    expect(markup).toContain("Teacher edit restored from the private batch draft.");
    expect(markup).toContain("Review draft saved.");
  });

  it("persists only valid changed drafts and leaves invalid in-progress input local", () => {
    const ready = item("ready", "review_ready");
    const invalid = item("invalid", "review_ready");
    const result = buildBulkAiReviewDraftSaveItems({
      batch: batch([ready, invalid]),
      maxPoints: 20,
      rubric: null,
      drafts: {
        ready: {
          gradeInput: "18",
          feedback: "A durable teacher edit.",
          rubricScoreInputs: {},
        },
        invalid: {
          gradeInput: "18.5",
          feedback: "Keep this invalid draft local for now.",
          rubricScoreInputs: {},
        },
      },
    });

    expect(result).toEqual({
      errors: {
        invalid: "Score must be a whole number from 0 to 20.",
      },
      items: [{
        itemId: "ready",
        grade: 18,
        feedback: "A durable teacher edit.",
        rubricScores: null,
      }],
    });
  });

  it("does not issue a draft write when local values already match the persisted batch", () => {
    const ready = item("ready", "review_ready");
    expect(buildBulkAiReviewDraftSaveItems({
      batch: batch([ready]),
      maxPoints: 20,
      rubric: null,
      drafts: {
        ready: {
          gradeInput: "17",
          feedback: "Clear and specific.",
          rubricScoreInputs: {},
        },
      },
    })).toEqual({ errors: {}, items: [] });
  });

  it("serializes only review-ready rows and preserves teacher-edited values", () => {
    const ready = item("ready", "review_ready");
    const skipped = item("skipped", "skipped");
    const result = buildBulkAiReviewSaveItems({
      batch: batch([ready, skipped]),
      maxPoints: 20,
      rubric: null,
      drafts: {
        ready: {
          gradeInput: "18",
          feedback: "  Teacher-edited feedback.  ",
          rubricScoreInputs: {},
        },
        skipped: {
          gradeInput: "20",
          feedback: "Must never be included.",
          rubricScoreInputs: {},
        },
      },
    });

    expect(result).toEqual({
      errors: {},
      items: [{
        itemId: "ready",
        grade: 18,
        feedback: "Teacher-edited feedback.",
        rubricScores: null,
      }],
    });
  });

  it.each(["", "4.5", "-1", "21"])(
    "rejects an invalid whole-number score (%j) instead of producing a save payload",
    (gradeInput) => {
      const ready = item("ready", "review_ready");
      const result = buildBulkAiReviewSaveItems({
        batch: batch([ready]),
        maxPoints: 20,
        rubric: null,
        drafts: {
          ready: { gradeInput, feedback: "Reviewed.", rubricScoreInputs: {} },
        },
      });

      expect(result.items).toEqual([]);
      expect(result.errors.ready).toBe("Score must be a whole number from 0 to 20.");
    },
  );

  it("requires every rubric criterion and derives the final score from the rubric", () => {
    const ready = item("ready", "review_ready");
    const rubric = {
      title: "Speaking rubric",
      criteria: [
        { id: "clarity", name: "Clarity", description: "Easy to follow", maxPoints: 10 },
        { id: "detail", name: "Detail", description: "Specific evidence", maxPoints: 10 },
      ],
    };

    expect(buildBulkAiReviewSaveItems({
      batch: batch([ready]),
      maxPoints: 20,
      rubric,
      drafts: {
        ready: {
          gradeInput: "1",
          feedback: "Reviewed.",
          rubricScoreInputs: { clarity: "9", detail: "8" },
        },
      },
    })).toEqual({
      errors: {},
      items: [{
        itemId: "ready",
        grade: 17,
        feedback: "Reviewed.",
        rubricScores: [
          { criterionId: "clarity", criterionName: "Clarity", maxPoints: 10, awarded: 9 },
          { criterionId: "detail", criterionName: "Detail", maxPoints: 10, awarded: 8 },
        ],
      }],
    });

    const missingCriterion = buildBulkAiReviewSaveItems({
      batch: batch([ready]),
      maxPoints: 20,
      rubric,
      drafts: {
        ready: {
          gradeInput: "17",
          feedback: "Reviewed.",
          rubricScoreInputs: { clarity: "9" },
        },
      },
    });
    expect(missingCriterion.items).toEqual([]);
    expect(missingCriterion.errors.ready).toBe("Detail must be a whole number from 0 to 10.");
  });
});

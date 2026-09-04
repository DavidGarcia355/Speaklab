import { describe, expect, it, vi } from "vitest";
import {
  BulkAiBatchRequestError,
  bulkAiPreflightFromScopeError,
  closeBulkAiBatch,
  createOrResumeBulkAiBatch,
  loadBulkAiBatch,
  runBulkAiGradeRequests,
  runBulkAiBatch,
  saveBulkAiBatch,
  saveBulkAiBatchDraft,
  type BulkAiAttempt,
  type BulkAiBatch,
  type BulkAiBatchItem,
} from "@/app/components/bulk-ai-grade-runner";

function attempt(score: number | null): BulkAiAttempt {
  return {
    id: crypto.randomUUID(),
    status: "completed",
    transcript: "Hola.",
    suggestedScore: score,
    rubricScores: [],
    feedback: "Feedback",
    strengths: [],
    improvements: [],
    evidence: [],
    confidence: score === null ? "low" : "high",
    warnings: [],
    teacherAttention: score === null ? "unable_to_grade" : "none",
    errorMessage: "",
  };
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

function batch(
  overrides: Partial<BulkAiBatch> & Pick<BulkAiBatch, "status">,
): BulkAiBatch {
  const { status, ...rest } = overrides;
  return {
    id: "batch_1",
    assignmentId: "asg_1",
    assignmentTitle: "Una tradición que me importa",
    assignmentFingerprint: "assignment-fingerprint",
    status,
    eligibleCount: 2,
    newUnitsRequired: 2,
    transcriptsRequired: 2,
    savedTranscripts: 0,
    enhanced: false,
    counts: {
      total: 2,
      queued: status === "queued" ? 2 : 0,
      processing: 0,
      reviewReady: status === "review_ready" ? 2 : 0,
      failed: status === "partial_failure" ? 1 : 0,
      skipped: 0,
      saved: status === "saved" ? 2 : 0,
      conflict: 0,
    },
    createdAt: 1,
    updatedAt: 1,
    completedAt: status === "review_ready" || status === "partial_failure" ? 2 : null,
    savedAt: status === "saved" ? 3 : null,
    items: [],
    ...rest,
  };
}

function batchItem(
  overrides: Partial<BulkAiBatchItem> & Pick<BulkAiBatchItem, "id" | "status">,
): BulkAiBatchItem {
  const { id, status, ...rest } = overrides;
  return {
    id,
    submissionId: `submission_${id}`,
    studentName: "Alex Rivera",
    studentEmail: "alex@example.test",
    submittedAt: 1,
    ordinal: 0,
    status,
    attemptId: null,
    errorCode: "",
    errorMessage: "",
    retryCount: 0,
    teacherEdited: false,
    draft: { grade: null, rubricScores: null, feedback: "" },
    attempt: null,
    updatedAt: 1,
    ...rest,
  };
}

describe("durable bulk AI grading requests", () => {
  it("creates a confirmed batch with a caller-supplied idempotency key", async () => {
    const createdBatch = batch({ status: "queued" });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ created: true, batch: createdBatch }, 201),
    );

    await expect(createOrResumeBulkAiBatch({
      assignmentId: "asg 1",
      idempotencyKey: "click_123",
      confirmationToken: "confirmation_123",
      enhanced: true,
      fetchImpl,
    })).resolves.toEqual({ created: true, batch: createdBatch });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/assignments/asg%201/ai-grade-all",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: "click_123",
          confirmationToken: "confirmation_123",
          confirmed: true,
          enhanced: true,
        }),
      }),
    );
  });

  it("preserves structured allowance details for an insufficient-units decision", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        error: "This batch needs 8 units, but only 3 are available.",
        code: "insufficient_allowance",
        requiredUnits: 8,
        availableUnits: 3,
        additionalUnits: 5,
        eligibleCount: 8,
      }, 429),
    );

    const error = await createOrResumeBulkAiBatch({
      assignmentId: "asg_1",
      idempotencyKey: "click_123",
      confirmationToken: "confirmation_123",
      fetchImpl,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BulkAiBatchRequestError);
    expect(error).toMatchObject({
      status: 429,
      code: "insufficient_allowance",
      payload: expect.objectContaining({
        requiredUnits: 8,
        availableUnits: 3,
        additionalUnits: 5,
        eligibleCount: 8,
      }),
    });
  });

  it("preserves a fresh confirmation scope so the client cannot retry a stale token", async () => {
    const freshPreflight = {
      assignmentId: "asg_1",
      confirmationToken: "fresh-token",
      confirmationScope: {
        assignmentId: "asg_1",
        assignmentFingerprint: "fresh-fingerprint",
        submissionIds: ["submission_2"],
        eligibleCount: 1,
        newUnitsRequired: 1,
        transcriptsRequired: 0,
      },
      ungradedCount: 1,
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        error: "The eligible submissions changed after confirmation.",
        code: "confirmation_scope_changed",
        preflight: freshPreflight,
      }, 409),
    );
    const error = await createOrResumeBulkAiBatch({
      assignmentId: "asg_1",
      idempotencyKey: "click_123",
      confirmationToken: "stale-token",
      fetchImpl,
    }).catch((reason: unknown) => reason);

    expect(bulkAiPreflightFromScopeError(error, "asg_1")).toEqual(freshPreflight);
    expect(bulkAiPreflightFromScopeError(error, "another_assignment")).toBeNull();
  });

  it("persists private review drafts without calling the final-save route", async () => {
    const updatedBatch = batch({ status: "review_ready" });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ batch: updatedBatch }),
    );
    const items = [{
      itemId: "item_1",
      grade: 18,
      feedback: "Teacher-edited draft.",
      rubricScores: null,
    }];

    await expect(saveBulkAiBatchDraft({
      batchId: "batch/1",
      items,
      fetchImpl,
    })).resolves.toEqual({ batch: updatedBatch });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ai-grading-batches/batch%2F1/draft",
      expect.objectContaining({
        method: "PATCH",
        cache: "no-store",
        body: JSON.stringify({ items }),
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("/save"),
      expect.anything(),
    );
  });

  it("dismisses a confirmed terminal exception batch through the close endpoint", async () => {
    const closedBatch = batch({ status: "cancelled" });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ closed: true, batch: closedBatch }),
    );

    await expect(closeBulkAiBatch({
      batchId: "batch/1",
      fetchImpl,
    })).resolves.toEqual({ closed: true, batch: closedBatch });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ai-grading-batches/batch%2F1/close",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ confirmed: true }),
      }),
    );
  });

  it("loads the durable server checkpoint after a reload", async () => {
    const checkpoint = batch({
      status: "processing",
      counts: {
        total: 2,
        queued: 1,
        processing: 0,
        reviewReady: 1,
        failed: 0,
        skipped: 0,
        saved: 0,
        conflict: 0,
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ batch: checkpoint }),
    );

    await expect(loadBulkAiBatch({ batchId: "batch/1", fetchImpl }))
      .resolves.toEqual(checkpoint);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ai-grading-batches/batch%2F1",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("advances only unfinished server items and reports real persisted progress", async () => {
    const initial = batch({ status: "queued" });
    const oneDone = batch({
      status: "processing",
      counts: {
        total: 2,
        queued: 1,
        processing: 0,
        reviewReady: 1,
        failed: 0,
        skipped: 0,
        saved: 0,
        conflict: 0,
      },
      updatedAt: 2,
    });
    const complete = batch({ status: "review_ready", updatedAt: 3 });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ processedItemId: "item_1", done: false, batch: oneDone }))
      .mockResolvedValueOnce(json({ processedItemId: "item_2", done: true, batch: complete }));
    const progress = vi.fn();

    await expect(runBulkAiBatch({
      batch: initial,
      fetchImpl,
      onProgress: progress,
    })).resolves.toEqual(complete);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([value]) => value.counts.reviewReady)).toEqual([1, 2]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({ method: "POST" });
      expect(JSON.parse(String(init?.body))).toEqual({ retryFailed: false });
    }
  });

  it("retries only the persisted failures in a partial batch", async () => {
    const partial = batch({
      status: "partial_failure",
      counts: {
        total: 2,
        queued: 0,
        processing: 0,
        reviewReady: 1,
        failed: 1,
        skipped: 0,
        saved: 0,
        conflict: 0,
      },
      items: [batchItem({ id: "failed_item", status: "failed" })],
    });
    const complete = batch({ status: "review_ready", updatedAt: 2 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ processedItemId: "failed_item", done: true, batch: complete }),
    );

    await expect(runBulkAiBatch({
      batch: partial,
      retryFailed: true,
      fetchImpl,
    })).resolves.toEqual(complete);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      retryFailed: true,
    });
  });

  it("does not call processing again for a review-ready checkpoint", async () => {
    const ready = batch({ status: "review_ready" });
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(runBulkAiBatch({ batch: ready, fetchImpl })).resolves.toEqual(ready);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends edited review values only through the explicit save endpoint", async () => {
    const savedBatch = batch({ status: "saved" });
    const items = [{
      itemId: "item_1",
      grade: 17,
      feedback: "Teacher-edited feedback.",
      rubricScores: null,
    }];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ saved: true, batch: savedBatch }),
    );

    await expect(saveBulkAiBatch({ batchId: "batch_1", items, fetchImpl }))
      .resolves.toEqual({ saved: true, batch: savedBatch });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ai-grading-batches/batch_1/save",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ confirmed: true, items }),
      }),
    );
  });

  it("treats a duplicate save response as an idempotent no-op", async () => {
    const alreadySaved = batch({ status: "saved" });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ saved: false, batch: alreadySaved }),
    );

    await expect(saveBulkAiBatch({
      batchId: "batch_1",
      items: [],
      fetchImpl,
    })).resolves.toEqual({ saved: false, batch: alreadySaved });
  });
});

describe("resumable bulk AI grade requests", () => {
  it("counts entered scores, review-only results, unusable audio, and failures exactly", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("graded")) return json({ attempt: attempt(8), gradeApplied: true });
      if (url.includes("review")) return json({ attempt: attempt(6), gradeApplied: false });
      if (url.includes("audio")) return json({ error: "No clear speech." }, 422);
      return json({ error: "Provider failed." }, 502);
    });
    const items: string[] = [];
    const progress = vi.fn();

    const result = await runBulkAiGradeRequests({
      submissionIds: ["graded", "review", "audio", "failed"],
      cooldownSeconds: 0,
      fetchImpl,
      onItem: (item) => items.push(item.outcome),
      onProgress: progress,
    });

    expect(result).toEqual({
      total: 4,
      completed: 2,
      graded: 1,
      reviewOnly: 1,
      skipped: 1,
      failed: 1,
      uncertain: 0,
      notProcessed: 0,
      terminalError: "",
    });
    expect(items).toEqual(["graded", "review_only", "skipped", "failed"]);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        total: 4,
        completed: 2,
        graded: 1,
        reviewOnly: 1,
        skipped: 1,
        failed: 1,
        uncertain: 0,
        notProcessed: 0,
      }),
      4,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchImpl.mock.calls) expect(init?.method).toBe("POST");
  });

  it("stops on billing, access, or quota errors and leaves remaining rows resumable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("quota")) return json({ error: "Allowance reached." }, 429);
      return json({ attempt: attempt(9), gradeApplied: true });
    });

    const result = await runBulkAiGradeRequests({
      submissionIds: ["first", "quota", "never-called-1", "never-called-2"],
      cooldownSeconds: 0,
      fetchImpl,
    });

    expect(result).toMatchObject({
      total: 4,
      graded: 1,
      failed: 1,
      uncertain: 0,
      notProcessed: 2,
      terminalError: "Allowance reached.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("deduplicates IDs, spaces requests, and never starts a second item after a network failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ attempt: attempt(7), gradeApplied: true }))
      .mockRejectedValueOnce(new Error("Connection lost"));
    const waitImpl = vi.fn(async () => undefined);

    const result = await runBulkAiGradeRequests({
      submissionIds: ["first", "first", "second", "third"],
      cooldownSeconds: 3,
      fetchImpl,
      waitImpl,
    });

    expect(result).toMatchObject({
      total: 3,
      graded: 1,
      failed: 0,
      uncertain: 1,
      notProcessed: 1,
      terminalError: expect.stringContaining("Connection lost"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waitImpl).toHaveBeenCalledTimes(1);
    expect(waitImpl).toHaveBeenCalledWith(3_000);
  });

  it("aborts an active request and never starts queued submissions", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    });

    const run = runBulkAiGradeRequests({
      submissionIds: ["first", "second", "third"],
      cooldownSeconds: 0,
      fetchImpl,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a malformed success response as uncertain instead of falsely failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));

    const result = await runBulkAiGradeRequests({
      submissionIds: ["ambiguous", "queued"],
      cooldownSeconds: 0,
      fetchImpl,
    });

    expect(result).toMatchObject({
      total: 2,
      graded: 0,
      failed: 0,
      uncertain: 1,
      notProcessed: 1,
      terminalError: expect.stringContaining("could not be confirmed"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

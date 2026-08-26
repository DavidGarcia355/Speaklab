import { describe, expect, it, vi } from "vitest";
import {
  runBulkAiGradeRequests,
  type BulkAiAttempt,
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

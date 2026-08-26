import { describe, expect, it, vi } from "vitest";
import {
  preflightBulkTranscripts,
  runBulkTranscriptRequests,
} from "@/app/components/bulk-transcript-runner";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const submissions = [
  { id: "saved", studentName: "Saved", submittedAt: 1 },
  { id: "missing-a", studentName: "Missing A", submittedAt: 2 },
  { id: "missing-b", studentName: "Missing B", submittedAt: 3 },
];

describe("transcript-only bulk runner", () => {
  it("preflights with GET only and identifies saved, missing, and unreadable rows", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      if (url.includes("saved")) return response({ item: { transcript: "Already saved." } });
      if (url.includes("missing-a")) return response({ item: null });
      return response({ error: "Unavailable" }, 503);
    });

    await expect(preflightBulkTranscripts({ submissions, fetchImpl })).resolves.toEqual({
      total: 3,
      reusedSubmissionIds: ["saved"],
      missingSubmissionIds: ["missing-a"],
      unreadableSubmissionIds: ["missing-b"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("POSTs only preflight-confirmed missing rows, never grades, and ZIPs all saved transcripts", async () => {
    const generated = new Set<string>();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toMatch(/\/transcript$/);
      expect(url).not.toContain("ai-grade");
      const id = url.includes("missing-a") ? "missing-a" : url.includes("missing-b") ? "missing-b" : "saved";
      if (init?.method === "POST") {
        generated.add(id);
        return response({ item: { transcript: `Generated ${id}.`, transcriptQuality: "good" } });
      }
      if (id === "saved") return response({ item: { transcript: "Already saved.", transcriptQuality: "good" } });
      return response({ item: generated.has(id) ? { transcript: `Generated ${id}.`, transcriptQuality: "good" } : null });
    });

    const result = await runBulkTranscriptRequests({
      assignmentTitle: "Speaking",
      submissions,
      preflight: {
        total: 3,
        reusedSubmissionIds: ["saved"],
        missingSubmissionIds: ["missing-a", "missing-b", "missing-a"],
        unreadableSubmissionIds: [],
      },
      fetchImpl,
      generatedAt: Date.UTC(2026, 7, 27),
    });

    expect(result).toMatchObject({
      total: 3,
      generated: 2,
      reused: 1,
      failed: 0,
      uncertain: 0,
      notProcessed: 0,
      terminalError: "",
      archive: { total: 3, included: 3, unavailable: 0 },
    });
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("continues after definite item failures but stops on an allowance/configuration error", async () => {
    const items = Array.from({ length: 4 }, (_, index) => ({
      id: `sub-${index + 1}`,
      studentName: `Student ${index + 1}`,
      submittedAt: index,
    }));
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET") return response({ item: null });
      if (url.includes("sub-1")) return response({ error: "No speech." }, 422);
      if (url.includes("sub-2")) return response({ error: "Allowance reached." }, 429);
      throw new Error("must not process after terminal error");
    });

    const result = await runBulkTranscriptRequests({
      assignmentTitle: "Speaking",
      submissions: items,
      preflight: {
        total: 4,
        reusedSubmissionIds: [],
        missingSubmissionIds: items.map((item) => item.id),
        unreadableSubmissionIds: [],
      },
      fetchImpl,
    });

    expect(result).toMatchObject({ generated: 0, reused: 0, failed: 2, uncertain: 0, notProcessed: 2 });
    expect(result.terminalError).toBe("Allowance reached.");
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("marks an ambiguous request uncertain, stops, and requires reload before retry", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("connection lost");
      return response({ item: null });
    });
    const result = await runBulkTranscriptRequests({
      assignmentTitle: "Speaking",
      submissions: submissions.slice(1),
      preflight: {
        total: 2,
        reusedSubmissionIds: [],
        missingSubmissionIds: ["missing-a", "missing-b"],
        unreadableSubmissionIds: [],
      },
      fetchImpl,
    });
    expect(result).toMatchObject({ uncertain: 1, notProcessed: 1, generated: 0 });
    expect(result.terminalError).toMatch(/Reload before retrying/);
  });

  it("treats a 409 processing race as uncertain instead of a definite failure", async () => {
    const items = submissions.slice(1);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return response({ error: "This exact recording is already being processed." }, 409);
      }
      return response({ item: null });
    });

    const result = await runBulkTranscriptRequests({
      assignmentTitle: "Speaking",
      submissions: items,
      preflight: {
        total: 2,
        reusedSubmissionIds: [],
        missingSubmissionIds: items.map((item) => item.id),
        unreadableSubmissionIds: [],
      },
      fetchImpl,
    });

    expect(result).toMatchObject({ failed: 0, uncertain: 1, notProcessed: 1 });
    expect(result.terminalError).toMatch(/another request may have saved it/i);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("is abortable and starts no later POST", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return response({ item: null });
    });
    const run = runBulkTranscriptRequests({
      assignmentTitle: "Speaking",
      submissions: submissions.slice(1),
      preflight: {
        total: 2,
        reusedSubmissionIds: [],
        missingSubmissionIds: ["missing-a", "missing-b"],
        unreadableSubmissionIds: [],
      },
      fetchImpl,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

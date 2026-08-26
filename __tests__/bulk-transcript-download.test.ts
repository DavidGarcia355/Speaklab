import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { prepareBulkTranscriptDownload } from "@/app/components/bulk-transcript-download";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function submissions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `sub_${String(index + 1).padStart(12, "0")}`,
    studentName: `Student ${index + 1}`,
    submittedAt: Date.UTC(2026, 7, 26, 12, index),
  }));
}

describe("bulk transcript ZIP preparation", () => {
  it("uses GET only and creates one privacy-safe archive with exact partial-result counts", async () => {
    const items = [
      {
        id: "sub_sameprefix000001",
        studentName: "=HYPERLINK(\"https://example.com\") / Ana",
        submittedAt: Date.UTC(2026, 7, 26, 12),
      },
      {
        id: "sub_sameprefix000002",
        studentName: "=HYPERLINK(\"https://example.com\") / Ana",
        submittedAt: Date.UTC(2026, 7, 26, 12),
      },
      {
        id: "sub_missing",
        studentName: "Missing Student",
        submittedAt: Date.UTC(2026, 7, 26, 13),
      },
      {
        id: "sub_failed",
        studentName: "Failed Student",
        submittedAt: Date.UTC(2026, 7, 26, 14),
      },
    ];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe("same-origin");
      if (url.endsWith("sub_sameprefix000001/transcript")) {
        return jsonResponse({
          item: { transcript: "Hola, me llamo Ana. \u00a1Encantada!", transcriptQuality: "good" },
        });
      }
      if (url.endsWith("sub_sameprefix000002/transcript")) {
        return jsonResponse({
          item: { transcript: "Je parle fran\u00e7ais.", transcriptQuality: "poor" },
        });
      }
      if (url.endsWith("sub_missing/transcript")) return jsonResponse({ item: null });
      return jsonResponse({ error: "private provider details" }, 503);
    });

    const result = await prepareBulkTranscriptDownload({
      assignmentTitle: "Conversaci\u00f3n / semaine 1",
      submissions: items,
      fetchImpl,
      generatedAt: Date.UTC(2026, 7, 27),
      concurrency: 2,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      total: 4,
      included: 2,
      unavailable: 2,
      needsReview: 1,
      archiveFilename: "TryHabla - Conversaci\u00f3n semaine 1 - transcripts - 2026-08-27.zip",
    });
    expect(result.archive?.type).toBe("application/zip");

    const archive = unzipSync(new Uint8Array(await result.archive!.arrayBuffer()));
    const filenames = Object.keys(archive);
    const transcriptFiles = filenames.filter((name) => name.endsWith(".txt"));
    expect(transcriptFiles).toHaveLength(2);
    expect(new Set(transcriptFiles.map((name) => name.toLocaleLowerCase())).size).toBe(2);
    expect(transcriptFiles.every((name) => !/[\\/:*?"<>|]/.test(name))).toBe(true);
    expect(transcriptFiles.map((name) => strFromU8(archive[name])).join("\n"))
      .toContain("Hola, me llamo Ana. \u00a1Encantada!");
    expect(transcriptFiles.map((name) => strFromU8(archive[name])).join("\n"))
      .toContain("Je parle fran\u00e7ais.");

    const report = strFromU8(archive["TryHabla transcript report.csv"]);
    expect(report).toContain("Included");
    expect(report).toContain("Unavailable");
    expect(report).toContain("Needs teacher review");
    expect(report).toContain("'=HYPERLINK");
    expect(report).not.toContain("private provider details");
    expect(report).not.toMatch(/student[^,\r\n]*@/i);
  });

  it("bounds concurrent owner-protected transcript reads", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse({ item: { transcript: "Saved transcript.", transcriptQuality: "good" } });
    });

    const result = await prepareBulkTranscriptDownload({
      assignmentTitle: "Speaking",
      submissions: submissions(7),
      fetchImpl,
      concurrency: 2,
    });

    expect(result).toMatchObject({ total: 7, included: 7, unavailable: 0, needsReview: 0 });
    expect(maxActive).toBe(2);
  });

  it("creates no archive when every saved transcript is missing, blank, invalid, or inaccessible", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      void _init;
      if (url.includes("000000000001")) return jsonResponse({ item: null });
      if (url.includes("000000000002")) return jsonResponse({ item: { transcript: "   " } });
      if (url.includes("000000000003")) return new Response("not json", { status: 200 });
      throw new Error("network failure");
    });

    const result = await prepareBulkTranscriptDownload({
      assignmentTitle: "Speaking",
      submissions: submissions(4),
      fetchImpl,
      concurrency: 99,
    });

    expect(result).toEqual({
      total: 4,
      included: 0,
      unavailable: 4,
      needsReview: 0,
      archive: null,
      archiveFilename: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.method).toBe("GET");
    }
  });

  it("returns empty exact counts without making a request", async () => {
    const fetchImpl = vi.fn();
    await expect(prepareBulkTranscriptDownload({
      assignmentTitle: "Speaking",
      submissions: [],
      fetchImpl,
    })).resolves.toEqual({
      total: 0,
      included: 0,
      unavailable: 0,
      needsReview: 0,
      archive: null,
      archiveFilename: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("flags a saved transcript with missing quality metadata for teacher review", async () => {
    const result = await prepareBulkTranscriptDownload({
      assignmentTitle: "Speaking",
      submissions: submissions(1),
      fetchImpl: vi.fn(async () => jsonResponse({ item: { transcript: "A usable legacy transcript." } })),
    });

    expect(result).toMatchObject({ total: 1, included: 1, unavailable: 0, needsReview: 1 });
    const archive = unzipSync(new Uint8Array(await result.archive!.arrayBuffer()));
    expect(strFromU8(archive["TryHabla transcript report.csv"])).toContain("Needs teacher review");
  });

  it("rejects an aborted run and does not start queued transcript requests", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    });
    const run = prepareBulkTranscriptDownload({
      assignmentTitle: "Speaking",
      submissions: submissions(3),
      fetchImpl,
      concurrency: 1,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

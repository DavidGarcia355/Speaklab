import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AudioPlayer from "@/app/components/AudioPlayer";
import SubmissionTranscript, {
  TRANSCRIPTION_USAGE_DISCLOSURE,
} from "@/app/components/SubmissionTranscript";
import {
  buildSubmissionDownloadFilenameBase,
  sanitizeDownloadFilenameBase,
  shortSubmissionReference,
} from "@/app/components/submission-download-filenames";
import { parseTranscriptResponse } from "@/app/components/submission-transcript-response";

describe("teacher submission downloads", () => {
  it("builds a sanitized, supportable, collision-resistant recording filename", () => {
    const filename = buildSubmissionDownloadFilenameBase({
      studentName: "Ana / Garc\u00eda",
      assignmentTitle: "Conversaci\u00f3n: d\u00eda 1?",
      submittedAt: Date.UTC(2026, 7, 26, 12),
      submissionId: "sub_12345678-abcd-4abc-8def-1234567890ab",
    });

    expect(filename).toContain("TryHabla");
    expect(filename).toContain("Ana Garc\u00eda");
    expect(filename).toContain("Conversaci\u00f3n d\u00eda 1");
    expect(filename).toContain("2026-08-26");
    expect(filename).toMatch(/sub-12345678abcd$/);
    expect(filename).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("keeps the short submission reference when user-controlled labels are long", () => {
    const filename = buildSubmissionDownloadFilenameBase({
      studentName: "A".repeat(300),
      assignmentTitle: "B".repeat(300),
      submittedAt: Date.UTC(2026, 7, 26),
      submissionId: "sub_abcdef12-3456-7890-abcd-ef1234567890",
    });

    expect(Array.from(filename).length).toBeLessThanOrEqual(180);
    expect(filename).toMatch(/sub-abcdef123456$/);
    expect(shortSubmissionReference("sub_abcdef12-3456-7890-abcd-ef1234567890"))
      .toBe("sub-abcdef123456");
  });

  it("handles empty and Windows-reserved filename values safely", () => {
    expect(sanitizeDownloadFilenameBase("<>:\"/\\|?*", "TryHabla-file")).toBe("TryHabla-file");
    expect(sanitizeDownloadFilenameBase("CON")).toBe("CON-file");
  });

  it("renders Download recording as a visible labeled action", () => {
    const markup = renderToStaticMarkup(
      <AudioPlayer src="/api/submissions/sub_123/audio" downloadFilename="TryHabla - Student - Task" />,
    );

    expect(markup).toContain("Download recording");
    expect(markup).toContain("audio-download-action");
  });
});

describe("teacher transcript UI contract", () => {
  it("parses the canonical persisted transcript response", () => {
    expect(parseTranscriptResponse({
      item: {
        transcript: "  Hola, me llamo Ana.  ",
        detectedLanguage: "es",
        transcriptQuality: "good",
        durationSeconds: 12,
        createdAt: 1,
      },
      allowance: { remaining: 29 },
    })).toEqual({
      transcript: "Hola, me llamo Ana.",
      status: "",
      message: "",
      error: "",
    });
  });

  it("accepts sensible alternate status and error response shapes", () => {
    expect(parseTranscriptResponse({ data: { transcript: { text: "Bonjour." }, status: "READY" } }))
      .toMatchObject({ transcript: "Bonjour.", status: "ready" });
    expect(parseTranscriptResponse({ item: null })).toMatchObject({ transcript: null, status: "" });
    expect(parseTranscriptResponse({ status: "failed", error: { message: "Provider unavailable." } }))
      .toMatchObject({ status: "failed", error: "Provider unavailable." });
  });

  it("keeps transcript-only work useful without burying the grading workflow", () => {
    const markup = renderToStaticMarkup(
      <SubmissionTranscript
        submissionId="sub_123"
        studentName="Student"
        downloadFilenameBase="TryHabla - Student - Task"
      />,
    );

    expect(markup).toContain("Transcript");
    expect(markup).toContain("Read, copy, or download the transcript while you review this recording.");
    expect(markup).not.toContain("AI grading is separate and optional.");
    expect(markup).toContain("Checking for a saved transcript...");
    expect(TRANSCRIPTION_USAGE_DISCLOSURE).toContain("uses one AI-assisted recording unit");
    expect(TRANSCRIPTION_USAGE_DISCLOSURE).toContain("optional grading");
  });
});

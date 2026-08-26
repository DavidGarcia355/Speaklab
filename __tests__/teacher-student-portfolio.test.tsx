import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/components/AudioPlayer", () => ({
  default: ({
    src,
    downloadFilename,
  }: {
    src: string;
    downloadFilename?: string;
  }) => (
    <div data-audio-src={src} data-download-filename={downloadFilename}>
      Download recording
    </div>
  ),
}));

vi.mock("@/app/components/SubmissionTranscript", () => ({
  default: ({ submissionId }: { submissionId: string }) => (
    <div data-transcript-submission-id={submissionId}>Transcript tools</div>
  ),
}));

import StudentOralPortfolio from "@/app/components/StudentOralPortfolio";

describe("teacher student oral portfolio", () => {
  it("renders every historical recording through teacher-protected routes", () => {
    const markup = renderToStaticMarkup(
      <StudentOralPortfolio
        studentName={"Ana Garc\u00eda"}
        items={[
          {
            assignmentId: "asg_1",
            assignmentTitle: "Conversation",
            maxPoints: 10,
            submissionId: "sub_abcdef12-1111",
            audioData: "/api/submissions/sub_abcdef12-1111/audio",
            submittedAt: Date.UTC(2026, 7, 26, 14),
            grade: 9,
            feedback: "Clear details.",
          },
          {
            assignmentId: "asg_1",
            assignmentTitle: "Conversation",
            maxPoints: 10,
            submissionId: "sub_98765432-2222",
            audioData: "/api/submissions/sub_98765432-2222/audio",
            submittedAt: Date.UTC(2026, 6, 26, 14),
            grade: null,
            feedback: "",
          },
        ]}
      />
    );

    expect(markup).toContain("2 recordings");
    expect(markup).toContain("Newest first");
    expect(markup).toContain("/api/submissions/sub_abcdef12-1111/audio");
    expect(markup).toContain("/api/submissions/sub_98765432-2222/audio");
    expect(markup.match(/Download recording/g)).toHaveLength(2);
    expect(markup.match(/Transcript tools/g)).toHaveLength(2);
    expect(markup).toContain('data-transcript-submission-id="sub_abcdef12-1111"');
    expect(markup).toContain('data-transcript-submission-id="sub_98765432-2222"');
    expect(markup).toContain("sub-abcdef121111");
    expect(markup).toContain("sub-987654322222");
  });

  it("uses submission IDs as collision-safe item identities and filenames", () => {
    const markup = renderToStaticMarkup(
      <StudentOralPortfolio
        studentName="Same Student"
        items={[
          {
            assignmentId: "asg_same",
            assignmentTitle: "Repeated assignment",
            maxPoints: 10,
            submissionId: "sub_first000000",
            audioData: "/api/submissions/sub_first000000/audio",
            submittedAt: Date.UTC(2026, 7, 26),
            grade: null,
            feedback: "",
          },
          {
            assignmentId: "asg_same",
            assignmentTitle: "Repeated assignment",
            maxPoints: 10,
            submissionId: "sub_second00000",
            audioData: "/api/submissions/sub_second00000/audio",
            submittedAt: Date.UTC(2026, 7, 26),
            grade: null,
            feedback: "",
          },
        ]}
      />
    );

    expect(markup).toContain("sub-first000000");
    expect(markup).toContain("sub-second00000");
  });

  it("does not expose a broken transcript action while AI processing is disabled", () => {
    const markup = renderToStaticMarkup(
      <StudentOralPortfolio
        studentName="Student"
        transcriptionEnabled={false}
        items={[{
          assignmentId: "asg_1",
          assignmentTitle: "Speaking",
          maxPoints: 10,
          submissionId: "sub_1",
          audioData: "/api/submissions/sub_1/audio",
          submittedAt: Date.UTC(2026, 7, 26),
          grade: null,
          feedback: "",
        }]}
      />
    );

    expect(markup).not.toContain("Transcript tools");
    expect(markup).toContain("Download recording");
  });
});

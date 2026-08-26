import AudioPlayer from "@/app/components/AudioPlayer";
import GoogleDriveExportButton from "@/app/components/GoogleDriveExportButton";
import { buildSubmissionDownloadFilenameBase } from "@/app/components/submission-download-filenames";

export type StudentOralPortfolioItem = {
  assignmentId: string;
  assignmentTitle: string;
  maxPoints: number;
  submissionId: string | null;
  audioData: string | null;
  submittedAt: number | null;
  grade: number | null;
  feedback: string;
};

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function StudentOralPortfolio({
  studentName,
  items,
}: {
  studentName: string;
  items: StudentOralPortfolioItem[];
}) {
  const recordingCount = items.filter((item) => item.submissionId !== null).length;

  return (
    <section aria-label={`${studentName} oral portfolio`}>
      <div className="dense-row">
        <div>
          <h4 className="surface-title">Oral portfolio</h4>
          <p className="meta">
            {recordingCount === 1 ? "1 recording" : `${recordingCount} recordings`} / Newest first
          </p>
        </div>
      </div>
      <div className="grid submission-grid section-gap">
        {items.map((item) => {
          if (!item.submissionId || item.submittedAt === null || !item.audioData) {
            return (
              <div key={`${item.assignmentId}:empty`} className="card">
                <strong>{item.assignmentTitle}</strong>
                <div className="meta empty">No submission</div>
              </div>
            );
          }

          const downloadFilename = buildSubmissionDownloadFilenameBase({
            studentName,
            assignmentTitle: item.assignmentTitle,
            submittedAt: item.submittedAt,
            submissionId: item.submissionId,
          });

          return (
            <article key={item.submissionId} className="card">
              <strong>{item.assignmentTitle}</strong>
              <div className="meta">Submitted {formatDateTime(item.submittedAt)}</div>
              <AudioPlayer
                src={item.audioData}
                variant="compact"
                downloadFilename={downloadFilename}
              />
              <GoogleDriveExportButton
                submissionId={item.submissionId}
                studentName={studentName}
                filenameBase={downloadFilename}
                includeTranscript={false}
              />
              <div className="meta">
                Score: {item.grade !== null ? `${item.grade} / ${item.maxPoints}` : "Not graded"}
              </div>
              {item.feedback ? <div className="meta">Feedback: {item.feedback}</div> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

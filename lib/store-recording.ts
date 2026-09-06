import "server-only";
import { assertRecordingDuration } from "./audio-duration";
import { uploadSubmissionAudio, deleteSubmissionAudio } from "./audio-storage";
import { createSubmission } from "./db";
import { getEnv } from "./env";
import { HttpError } from "./http";
import { parseAudioDataUrl } from "./validation";
import { DuplicateSubmissionError, PracticeAccessChangedError, SubmissionLimitReachedError } from "./submission-errors";

/** The common upload, measured duration, persistence and compensating cleanup path. */
export async function storeRecording(input: {
  assignmentId: string | null; practiceClassId?: string; practiceTitle?: string; practiceNote?: string;
  studentEmail: string; studentName: string; audioData: string; maxRecordingSeconds: number;
}) {
  const audio = parseAudioDataUrl(input.audioData);
  const durationSeconds = await assertRecordingDuration({ ...audio, maxRecordingSeconds: input.maxRecordingSeconds });
  const id = `sub_${crypto.randomUUID()}`;
  let audioBlobUrl: string;
  try {
    audioBlobUrl = await uploadSubmissionAudio({ assignmentId: input.assignmentId ?? `practice-${input.practiceClassId}`, submissionId: id, ...audio });
  } catch {
    if (getEnv().isDev) audioBlobUrl = input.audioData;
    else throw new HttpError(503, "We couldn't upload your recording right now. If you're on a school network, try opening this link on your phone or switching connections.");
  }
  try {
    return await createSubmission({
      id, assignmentId: input.assignmentId, studentName: input.studentName, studentEmail: input.studentEmail,
      audioBlobUrl, durationSeconds,
      ...(input.practiceClassId ? { practiceClassId: input.practiceClassId, practiceTitle: input.practiceTitle, practiceNote: input.practiceNote } : {}),
    });
  } catch (error) {
    try { await deleteSubmissionAudio(audioBlobUrl); } catch { console.error("Compensating audio deletion failed", { code: "recording_cleanup_failed" }); }
    if (error instanceof SubmissionLimitReachedError) throw new HttpError(403, error.message);
    if (error instanceof DuplicateSubmissionError) throw new HttpError(409, error.message);
    if (error instanceof PracticeAccessChangedError) throw new HttpError(403, error.message);
    throw error;
  }
}

import "server-only";
import {
  BufferSource,
  Input,
  MP4,
  OGG,
  WAVE,
  WEBM,
  type InputFormat,
} from "mediabunny";
import { HttpError } from "@/lib/http";

export const HARD_MAX_RECORDING_SECONDS = 300;

// Media containers represent time on discrete scales. A quarter second is
// enough to absorb recorder stop/finalization rounding without turning the
// assignment limit into a meaningful extra recording allowance.
export const AUDIO_DURATION_TOLERANCE_SECONDS = 0.25;

type SupportedAudioMimeType = "audio/webm" | "audio/ogg" | "audio/mp4" | "audio/wav";

const formatsByMimeType: Record<SupportedAudioMimeType, InputFormat> = {
  "audio/webm": WEBM,
  "audio/ogg": OGG,
  "audio/mp4": MP4,
  "audio/wav": WAVE,
};

function invalidAudio(message: string) {
  return new HttpError(400, "Validation failed.", {
    audioData: [message],
  });
}

const UNREADABLE_AUDIO_MESSAGE =
  "We couldn't verify this recording's length. Record it again and upload the new recording.";

export async function assertRecordingDuration(input: {
  buffer: Buffer;
  mimeType: SupportedAudioMimeType;
  maxRecordingSeconds: number;
}) {
  if (
    !Number.isFinite(input.maxRecordingSeconds) ||
    !Number.isInteger(input.maxRecordingSeconds) ||
    input.maxRecordingSeconds <= 0
  ) {
    throw new Error("Assignment has an invalid recording duration limit.");
  }

  const enforcedLimitSeconds = Math.min(
    input.maxRecordingSeconds,
    HARD_MAX_RECORDING_SECONDS
  );
  const mediaInput = new Input({
    source: new BufferSource(input.buffer),
    // Restrict probing to the MIME type already accepted by validation. This
    // makes a claimed type that does not match the decoded bytes fail closed.
    formats: [formatsByMimeType[input.mimeType]],
  });

  try {
    if (!(await mediaInput.canRead())) {
      throw invalidAudio(UNREADABLE_AUDIO_MESSAGE);
    }

    const [audioTracks, videoTracks] = await Promise.all([
      mediaInput.getAudioTracks(),
      mediaInput.getVideoTracks(),
    ]);
    if (audioTracks.length === 0 || videoTracks.length > 0) {
      throw invalidAudio(UNREADABLE_AUDIO_MESSAGE);
    }

    // computeDuration() walks packet timing rather than trusting only a
    // container's optional duration field. That matters for MediaRecorder
    // WebM files, which can omit duration metadata entirely.
    const durationSeconds = await mediaInput.computeDuration(audioTracks);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw invalidAudio(UNREADABLE_AUDIO_MESSAGE);
    }

    if (durationSeconds > enforcedLimitSeconds + AUDIO_DURATION_TOLERANCE_SECONDS) {
      throw invalidAudio(
        `Recording must be ${enforcedLimitSeconds} seconds or shorter.`
      );
    }

    return durationSeconds;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw invalidAudio(UNREADABLE_AUDIO_MESSAGE);
  } finally {
    mediaInput.dispose();
  }
}

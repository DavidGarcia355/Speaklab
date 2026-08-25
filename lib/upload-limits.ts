export const MAX_AUDIO_UPLOAD_BYTES = 3 * 1024 * 1024;
export const TARGET_AUDIO_BITS_PER_SECOND = 64_000;
export const AUDIO_RECORDING_TIMESLICE_MS = 1_000;
export const AUDIO_RECORDING_FINAL_CHUNK_RESERVE_BYTES = 512 * 1024;
export const AUDIO_RECORDING_AUTO_STOP_BYTES =
  MAX_AUDIO_UPLOAD_BYTES - AUDIO_RECORDING_FINAL_CHUNK_RESERVE_BYTES;

export const AUDIO_UPLOAD_TOO_LARGE_MESSAGE =
  "This recording is too large to upload. Record a shorter response and try again (maximum 3 MB).";
export const AUDIO_RECORDING_AUTO_STOP_MESSAGE =
  "Recording stopped early because it reached the safe upload-size limit. Play it back and submit it, or record a shorter response.";

export function isAudioUploadSizeAllowed(byteLength: number) {
  return Number.isFinite(byteLength) && byteLength >= 0 && byteLength <= MAX_AUDIO_UPLOAD_BYTES;
}

export function shouldAutoStopAudioRecording(recordedBytes: number) {
  return !Number.isFinite(recordedBytes) || recordedBytes >= AUDIO_RECORDING_AUTO_STOP_BYTES;
}

type RefCell<T> = { current: T };
type StoppableTrack = { stop: () => void };
type StoppableStream = { getTracks: () => StoppableTrack[] };

export const RECORDER_START_FAILURE_MESSAGE =
  "Microphone access was granted, but this browser couldn't start recording. Close other apps using the microphone, then try again in a current version of Chrome, Edge, Firefox, or Safari.";

export const RECORDER_RUNTIME_FAILURE_MESSAGE =
  "The browser stopped recording unexpectedly, so no recording was saved. Try again in a current version of Chrome, Edge, Firefox, or Safari.";

export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export function selectSupportedAudioMimeType(
  isTypeSupported: (mimeType: string) => boolean
) {
  return SUPPORTED_AUDIO_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType)) || "";
}

export function stopMediaStreamTracks(stream: StoppableStream | null | undefined) {
  if (!stream) return;

  let tracks: StoppableTrack[];
  try {
    tracks = stream.getTracks();
  } catch {
    return;
  }

  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      // Keep stopping the remaining tracks even if one browser track is stale.
    }
  }
}

export function cleanupFailedMediaRecorderStart<TRecorder>(input: {
  acquiredStream: StoppableStream;
  streamRef: RefCell<StoppableStream | null>;
  recorderRef: RefCell<TRecorder | null>;
  timerRef: RefCell<number | null>;
  clearTimer: (timerId: number) => void;
}) {
  const referencedStream = input.streamRef.current;
  stopMediaStreamTracks(input.acquiredStream);
  if (referencedStream && referencedStream !== input.acquiredStream) {
    stopMediaStreamTracks(referencedStream);
  }

  input.streamRef.current = null;
  input.recorderRef.current = null;
  if (input.timerRef.current !== null) {
    input.clearTimer(input.timerRef.current);
    input.timerRef.current = null;
  }
}

export function describeMicrophoneAccessFailure(error: unknown) {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      permissionDenied: true,
      message:
        "Microphone access was blocked. Allow microphone permission in your browser settings, then try again.",
    };
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      permissionDenied: false,
      message: "No microphone was found. Connect or enable a microphone, then try again.",
    };
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      permissionDenied: false,
      message:
        "The microphone is unavailable. Close other apps using it, check the device settings, then try again.",
    };
  }

  return {
    permissionDenied: false,
    message: "We couldn't access the microphone. Check the device and browser settings, then try again.",
  };
}

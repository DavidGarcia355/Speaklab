import { MAX_AUDIO_UPLOAD_BYTES } from "./upload-limits";

export const AUDIO_FILE_ACCEPT = ".mp3,.m4a,.mp4,.wav,.ogg,.webm,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm";
export type AudioMimeType = "audio/webm" | "audio/ogg" | "audio/mp4" | "audio/wav" | "audio/mpeg";
export const AUDIO_FILE_HELP = "MP3, M4A, WAV, Ogg, or WebM audio. Maximum 3 MB.";
export function normalizeAudioFileType(file: Pick<File, "name" | "type" | "size">): AudioMimeType {
  if (!file.size) throw new Error("This audio file is empty. Choose another recording.");
  if (file.size > MAX_AUDIO_UPLOAD_BYTES) throw new Error("Choose an audio file no larger than 3 MB.");
  const types: Record<string, AudioMimeType> = {
    "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg",
    "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4",
    "audio/wav": "audio/wav", "audio/wave": "audio/wav", "audio/x-wav": "audio/wav",
    "audio/ogg": "audio/ogg", "audio/webm": "audio/webm",
  };
  const extensions: Record<string, AudioMimeType> = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm" };
  const extensionType = extensions[file.name.split(".").pop()?.toLowerCase() ?? ""];
  const mime = file.type.split(";")[0].trim().toLowerCase();
  const type = mime ? types[mime] : extensionType;
  if (!type || (extensionType && extensionType !== type)) throw new Error("Choose a supported audio file. " + AUDIO_FILE_HELP);
  return type;
}

/** Packet timing works for MediaRecorder WebM files without a duration header. */
export async function readAudioDuration(blob: Blob, mimeType: AudioMimeType) {
  const { Input, BlobSource, WEBM, OGG, MP4, WAVE, MP3 } = await import("mediabunny");
  const formats = { "audio/webm": WEBM, "audio/ogg": OGG, "audio/mp4": MP4, "audio/wav": WAVE, "audio/mpeg": MP3 };
  const input = new Input({ source: new BlobSource(blob), formats: [formats[mimeType]] });
  try {
    if (!(await input.canRead())) throw new Error("Unsupported media");
    const audio = await input.getAudioTracks();
    if (!audio.length || (await input.getVideoTracks()).length) throw new Error("Audio only");
    const seconds = await input.computeDuration(audio);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("No audio duration");
    return seconds;
  } catch {
    throw new Error("We couldn't read this audio file. Choose a playable recording in a supported format.");
  } finally { input.dispose(); }
}

export function formatAudioDuration(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const whole = Math.max(1, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

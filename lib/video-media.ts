import "server-only";
import { BufferSource, BufferTarget, Conversion, Input, MP4, WEBM, Mp4OutputFormat, Output, WebMOutputFormat } from "mediabunny";
import { HttpError } from "@/lib/http";
import { LIMITS } from "@/lib/validation";

/** Remux the actual primary audio track; never accept an independent grading track. */
export async function extractVideoAudio(buffer: Buffer, contentType: string, maxSeconds: number) {
  const input = new Input({ source: new BufferSource(buffer), formats: [contentType === "video/mp4" ? MP4 : WEBM] });
  let conversion: Conversion | undefined;
  const timeout = setTimeout(() => { void conversion?.cancel(); input.dispose(); }, 15_000);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!videoTrack || !audioTrack) throw new Error("Missing tracks");
    const durationSeconds = await input.computeDuration();
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > Math.min(maxSeconds, 300) + 0.25) {
      throw new Error("Invalid duration");
    }
    const codec = await audioTrack.getCodec();
    if (codec !== "opus" && codec !== "aac") throw new Error("Unsupported sound format");
    const target = new BufferTarget();
    const mimeType = codec === "opus" ? "audio/webm" as const : "audio/mp4" as const;
    const output = new Output({ target, format: codec === "opus" ? new WebMOutputFormat() : new Mp4OutputFormat() });
    conversion = await Conversion.init({ input, output, tracks: "primary", video: { discard: true }, tags: {}, showWarnings: false });
    if (!conversion.isValid) throw new Error("Cannot extract sound");
    await conversion.execute();
    if (!target.buffer || target.buffer.byteLength < 1000 || target.buffer.byteLength > LIMITS.maxAudioBytes) {
      throw new Error("Sound track too large or empty");
    }
    return { buffer: Buffer.from(target.buffer), mimeType, durationSeconds };
  } catch {
    throw new HttpError(400, `Record a video with sound, no longer than ${maxSeconds} seconds. Try a shorter recording if it cannot be processed.`);
  } finally { clearTimeout(timeout); input.dispose(); }
}

import { describe, expect, it } from "vitest";
import { formatAudioDuration, normalizeAudioFileType, readAudioDuration } from "@/lib/audio-file";
import { createSilentWavFixtureDataUrl } from "@/lib/local-ai-fixture-audio";
import { parseAudioDataUrl } from "@/lib/validation";
import { assertRecordingDuration } from "@/lib/audio-duration";
import { MAX_AUDIO_UPLOAD_BYTES } from "@/lib/upload-limits";

describe("existing audio uploads", () => {
  it.each([
    ["voice.MP3", "audio/mpeg", "audio/mpeg"],
    ["voice.m4a", "audio/x-m4a", "audio/mp4"],
    ["voice.wav", "audio/x-wav", "audio/wav"],
    ["voice.ogg", "", "audio/ogg"],
    ["voice.webm", "audio/webm;codecs=opus", "audio/webm"],
  ])("normalizes %s without accepting arbitrary MIME types", (name, type, expected) => {
    expect(normalizeAudioFileType({ name, type, size: 100 })).toBe(expected);
  });
  it.each([
    { name: "voice.mp3", type: "text/plain", size: 100 },
    { name: "voice.wav", type: "audio/mpeg", size: 100 },
    { name: "movie.mp4", type: "video/mp4", size: 100 },
    { name: "unknown", type: "", size: 100 },
    { name: "empty.wav", type: "audio/wav", size: 0 },
    { name: "large.wav", type: "audio/wav", size: MAX_AUDIO_UPLOAD_BYTES + 1 },
  ])("rejects unsafe or unusable file selection: $name / $type / $size", file => {
    expect(() => normalizeAudioFileType(file)).toThrow();
  });
  it("accepts canonical MP3 data URLs for downstream byte validation", () => {
    expect(parseAudioDataUrl("data:audio/mpeg;base64,SUQzAA==").mimeType).toBe("audio/mpeg");
  });
  it("agrees on media duration in the browser and on the server", async () => {
    const audio = parseAudioDataUrl(createSilentWavFixtureDataUrl(42_125));
    const blob = new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType });
    expect(await readAudioDuration(blob, audio.mimeType)).toBeCloseTo(42.125, 3);
    expect(await assertRecordingDuration({ ...audio, maxRecordingSeconds: 60 })).toBeCloseTo(42.125, 3);
  });
  it("rejects unreadable and MIME-spoofed bytes on preview", async () => {
    await expect(readAudioDuration(new Blob(["corrupt"]), "audio/wav")).rejects.toThrow("couldn't read");
    const { buffer } = parseAudioDataUrl(createSilentWavFixtureDataUrl(1000));
    await expect(readAudioDuration(new Blob([new Uint8Array(buffer)]), "audio/mpeg")).rejects.toThrow("couldn't read");
  });
  it("rejects a WAV whose declared payload is missing", async () => {
    const audio = parseAudioDataUrl(createSilentWavFixtureDataUrl(4000));
    const truncated = audio.buffer.subarray(0, 44);
    await expect(readAudioDuration(new Blob([new Uint8Array(truncated)]), "audio/wav")).rejects.toThrow();
    await expect(assertRecordingDuration({ buffer: truncated, mimeType: "audio/wav", maxRecordingSeconds: 60 })).rejects.toThrow();
  });
  it.each([[42, "0:42"], [137, "2:17"], [724, "12:04"], [59.9, "1:00"], [null, "—"], [Infinity, "—"]])("formats duration %s as %s", (seconds, expected) => {
    expect(formatAudioDuration(seconds)).toBe(expected);
  });
});

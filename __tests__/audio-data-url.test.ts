import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http";
import { createSilentWavFixtureDataUrl } from "@/lib/local-ai-fixture-audio";
import { LIMITS, parseAudioDataUrl } from "@/lib/validation";

describe("audio data URL parsing", () => {
  it("accepts browser codec metadata with quotes and commas", () => {
    const parsed = parseAudioDataUrl(
      `data:audio/webm;codecs="opus,pcm";base64,${Buffer.from("audio").toString("base64")}`
    );

    expect(parsed.mimeType).toBe("audio/webm");
    expect(parsed.buffer.toString()).toBe("audio");
  });

  it("accepts unquoted codec metadata", () => {
    const parsed = parseAudioDataUrl(
      `data:audio/ogg;codecs=opus;base64,${Buffer.from("audio").toString("base64")}`
    );

    expect(parsed.mimeType).toBe("audio/ogg");
    expect(parsed.buffer.toString()).toBe("audio");
  });

  it("rejects unsupported audio types", () => {
    expect(() =>
      parseAudioDataUrl(`data:audio/mpeg;base64,${Buffer.from("audio").toString("base64")}`)
    ).toThrow(HttpError);
  });

  it("rejects invalid base64 payloads", () => {
    expect(() => parseAudioDataUrl("data:audio/webm;base64,not-valid!")).toThrow(HttpError);
  });

  it("keeps the largest accepted base64 JSON request below 4.5 MB", () => {
    const audioData = `data:audio/webm;base64,${Buffer.alloc(LIMITS.maxAudioBytes).toString("base64")}`;
    const requestBody = JSON.stringify({ studentName: "A".repeat(80), audioData });

    expect(LIMITS.maxAudioBytes).toBe(3 * 1024 * 1024);
    expect(Buffer.byteLength(requestBody)).toBeLessThan(4_500_000);
    expect(parseAudioDataUrl(audioData).buffer.byteLength).toBe(LIMITS.maxAudioBytes);
  });

  it("rejects recordings over the shared 3 MB raw-audio limit", () => {
    const audioData = `data:audio/webm;base64,${Buffer.alloc(LIMITS.maxAudioBytes + 1).toString("base64")}`;

    try {
      parseAudioDataUrl(audioData);
      throw new Error("Expected oversized audio to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).fieldErrors?.audioData).toContain(
        "This recording is too large to upload. Record a shorter response and try again (maximum 3 MB)."
      );
    }
  });

  it("builds a valid silent WAV for the local AI playback fixture", () => {
    const parsed = parseAudioDataUrl(createSilentWavFixtureDataUrl());

    expect(parsed.mimeType).toBe("audio/wav");
    expect(parsed.buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(parsed.buffer.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(parsed.buffer.readUInt32LE(40)).toBe(parsed.buffer.length - 44);
  });
});

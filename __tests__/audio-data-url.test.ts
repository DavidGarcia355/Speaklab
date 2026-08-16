import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http";
import { parseAudioDataUrl } from "@/lib/validation";

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
});

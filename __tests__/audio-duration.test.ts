import { describe, expect, it } from "vitest";
import {
  assertRecordingDuration,
  AUDIO_DURATION_TOLERANCE_SECONDS,
  HARD_MAX_RECORDING_SECONDS,
} from "@/lib/audio-duration";
import { HttpError } from "@/lib/http";

function makeLowBitrateWav(durationSeconds: number) {
  const sampleRate = 8_000;
  const channelCount = 1;
  const bitsPerSample = 8;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const dataSize = sampleCount * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize, 128);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

async function expectAudioValidationError(promise: Promise<unknown>, message: string) {
  try {
    await promise;
    throw new Error("Expected audio validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as HttpError).fieldErrors?.audioData).toContain(message);
  }
}

describe("recording duration enforcement", () => {
  it("accepts decoded audio within the assignment limit", async () => {
    const duration = await assertRecordingDuration({
      buffer: makeLowBitrateWav(59.9),
      mimeType: "audio/wav",
      maxRecordingSeconds: 60,
    });

    expect(duration).toBeCloseTo(59.9, 3);
  });

  it("only permits the documented sub-second container timing tolerance", async () => {
    const duration = await assertRecordingDuration({
      buffer: makeLowBitrateWav(60 + AUDIO_DURATION_TOLERANCE_SECONDS),
      mimeType: "audio/wav",
      maxRecordingSeconds: 60,
    });

    expect(duration).toBeCloseTo(60.25, 3);
  });

  it("rejects an over-limit low-bitrate recording even when it is small", async () => {
    const buffer = makeLowBitrateWav(61);
    expect(buffer.byteLength).toBeLessThan(500_000);

    await expectAudioValidationError(
      assertRecordingDuration({
        buffer,
        mimeType: "audio/wav",
        maxRecordingSeconds: 60,
      }),
      "Recording must be 60 seconds or shorter."
    );
  });

  it("enforces the hard ceiling even if stored assignment data is too permissive", async () => {
    await expectAudioValidationError(
      assertRecordingDuration({
        buffer: makeLowBitrateWav(HARD_MAX_RECORDING_SECONDS + 1),
        mimeType: "audio/wav",
        maxRecordingSeconds: 999,
      }),
      `Recording must be ${HARD_MAX_RECORDING_SECONDS} seconds or shorter.`
    );
  });

  it("fails closed when bytes are unreadable or do not match the claimed format", async () => {
    await expectAudioValidationError(
      assertRecordingDuration({
        buffer: Buffer.from("not a media container"),
        mimeType: "audio/webm",
        maxRecordingSeconds: 60,
      }),
      "We couldn't verify this recording's length. Record it again and upload the new recording."
    );

    await expectAudioValidationError(
      assertRecordingDuration({
        buffer: makeLowBitrateWav(10),
        mimeType: "audio/webm",
        maxRecordingSeconds: 60,
      }),
      "We couldn't verify this recording's length. Record it again and upload the new recording."
    );
  });
});

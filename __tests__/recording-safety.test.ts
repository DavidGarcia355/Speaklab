import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  cleanupFailedMediaRecorderStart,
  describeMicrophoneAccessFailure,
  selectSupportedAudioMimeType,
} from "@/lib/media-recorder-safety";
import {
  AUDIO_RECORDING_AUTO_STOP_BYTES,
  AUDIO_RECORDING_FINAL_CHUNK_RESERVE_BYTES,
  AUDIO_RECORDING_TIMESLICE_MS,
  MAX_AUDIO_UPLOAD_BYTES,
  shouldAutoStopAudioRecording,
} from "@/lib/upload-limits";

describe("MediaRecorder MIME selection", () => {
  it.each([
    [
      "prefers Opus WebM when every format is supported",
      ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"],
      "audio/webm;codecs=opus",
    ],
    [
      "prefers plain WebM over MP4 and Ogg",
      ["audio/webm", "audio/mp4", "audio/ogg;codecs=opus"],
      "audio/webm",
    ],
    [
      "prefers MP4 over Ogg when WebM is unavailable",
      ["audio/mp4", "audio/ogg;codecs=opus"],
      "audio/mp4",
    ],
    ["uses Ogg when it is the only supported format", ["audio/ogg;codecs=opus"], "audio/ogg;codecs=opus"],
  ])("%s", (_scenario, supportedTypes, expected) => {
    const supported = new Set(supportedTypes);

    expect(selectSupportedAudioMimeType((mimeType) => supported.has(mimeType))).toBe(expected);
  });

  it("returns an empty MIME type when MediaRecorder supports none of the candidates", () => {
    const isTypeSupported = vi.fn(() => false);

    expect(selectSupportedAudioMimeType(isTypeSupported)).toBe("");
    expect(isTypeSupported).toHaveBeenCalledTimes(4);
  });
});

describe("MediaRecorder failure cleanup", () => {
  it("stops every acquired track and clears recorder, stream, and timer refs", () => {
    const firstStop = vi.fn(() => {
      throw new Error("stale track");
    });
    const secondStop = vi.fn();
    const acquiredStream = {
      getTracks: () => [{ stop: firstStop }, { stop: secondStop }],
    };
    const streamRef = { current: acquiredStream };
    const recorderRef = { current: { state: "inactive" } };
    const timerRef = { current: 42 };
    const clearTimer = vi.fn();

    cleanupFailedMediaRecorderStart({
      acquiredStream,
      streamRef,
      recorderRef,
      timerRef,
      clearTimer,
    });

    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).toHaveBeenCalledOnce();
    expect(streamRef.current).toBeNull();
    expect(recorderRef.current).toBeNull();
    expect(clearTimer).toHaveBeenCalledWith(42);
    expect(timerRef.current).toBeNull();
  });

  it("distinguishes permission denial from device and recorder failures", () => {
    expect(describeMicrophoneAccessFailure({ name: "NotAllowedError" })).toMatchObject({
      permissionDenied: true,
      message: expect.stringContaining("blocked"),
    });
    expect(describeMicrophoneAccessFailure({ name: "NotFoundError" })).toMatchObject({
      permissionDenied: false,
      message: expect.stringContaining("No microphone"),
    });
    expect(describeMicrophoneAccessFailure({ name: "NotReadableError" })).toMatchObject({
      permissionDenied: false,
      message: expect.stringContaining("unavailable"),
    });
  });

  it("keeps active recorder teardown unmount-only when object URLs change", () => {
    const source = readFileSync(
      "app/a/[assignmentId]/student-assignment-client.tsx",
      "utf8"
    ).replace(/\r\n/g, "\n");
    const lifecycleEffects = source.slice(
      source.indexOf("  useEffect(() => {\n    return () => {\n      if (recordingUrl)"),
      source.indexOf("  async function startRecording()")
    );

    expect(lifecycleEffects).toContain("  }, [recordingUrl]);");
    expect(lifecycleEffects).toContain("stopMediaStreamTracks(streamRef.current);");
    expect(lifecycleEffects).toMatch(
      /stopMediaStreamTracks\(streamRef\.current\);[\s\S]*recorderRef\.current = null;[\s\S]*}, \[\]\);/
    );
    expect(lifecycleEffects.indexOf("  }, [recordingUrl]);")).toBeLessThan(
      lifecycleEffects.indexOf("stopMediaStreamTracks(streamRef.current);")
    );
  });
});

describe("recording upload byte budget", () => {
  it("uses periodic chunks and reserves room for the recorder's final chunk", () => {
    expect(AUDIO_RECORDING_TIMESLICE_MS).toBe(1_000);
    expect(AUDIO_RECORDING_FINAL_CHUNK_RESERVE_BYTES).toBe(512 * 1024);
    expect(AUDIO_RECORDING_AUTO_STOP_BYTES).toBe(
      MAX_AUDIO_UPLOAD_BYTES - AUDIO_RECORDING_FINAL_CHUNK_RESERVE_BYTES
    );
    expect(shouldAutoStopAudioRecording(AUDIO_RECORDING_AUTO_STOP_BYTES - 1)).toBe(false);
    expect(shouldAutoStopAudioRecording(AUDIO_RECORDING_AUTO_STOP_BYTES)).toBe(true);
    expect(shouldAutoStopAudioRecording(Number.NaN)).toBe(true);
  });
});

describe("student submission access guard", () => {
  it("surfaces preflight failures and blocks recording and submission controls", () => {
    const source = readFileSync(
      "app/a/[assignmentId]/student-assignment-client.tsx",
      "utf8"
    );

    expect(source).toContain("submissionAccessState");
    expect(source).toContain(
      "`/api/student/assignments/${assignmentId}/submissions`"
    );
    expect(source).toContain('submissionAccessState === "blocked"');
    expect(source.match(/submissionAccessBlocked/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("Delete an ungraded recording from My Recordings");
    expect(source).toMatch(/!atSubmissionLimit \? \([\s\S]*Record another response/);
  });
});

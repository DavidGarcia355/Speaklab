import { afterEach, describe, expect, it, vi } from "vitest";
import { openLocalMicrophone } from "../app/labs/hablaman/audio";

afterEach(() => vi.unstubAllGlobals());

function audioEnvironment(resumeFailure = false) {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const analyser = {
    fftSize: 0,
    disconnect: vi.fn(),
    getByteTimeDomainData: vi.fn((values: Uint8Array) => values.fill(128)),
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const close = vi.fn().mockResolvedValue(undefined);
  const resume = resumeFailure
    ? vi.fn().mockRejectedValue(new Error("Audio suspended"))
    : vi.fn().mockResolvedValue(undefined);
  class Context {
    close = close;
    resume = resume;
    createMediaStreamSource = vi.fn(() => source);
    createAnalyser = vi.fn(() => analyser);
  }
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", Context);
  return { stop, getUserMedia, analyser, source, close };
}

describe("HablaMan local microphone", () => {
  it("requests only audio and connects only to an analyser, never an output or recorder", async () => {
    const env = audioEnvironment();
    const mic = await openLocalMicrophone();
    expect(env.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(env.source.connect).toHaveBeenCalledExactlyOnceWith(env.analyser);
    expect(mic.sample()).toBe(0);
    env.analyser.getByteTimeDomainData.mockImplementation((values) =>
      values.fill(255),
    );
    expect(mic.sample()).toBe(1);
    mic.stop();
  });

  it("releases hardware and audio resources exactly once, and never samples after stopping", async () => {
    const env = audioEnvironment();
    const mic = await openLocalMicrophone();
    mic.stop();
    mic.stop();
    expect(env.stop).toHaveBeenCalledOnce();
    expect(env.close).toHaveBeenCalledOnce();
    expect(env.source.disconnect).toHaveBeenCalledOnce();
    expect(env.analyser.disconnect).toHaveBeenCalledOnce();
    expect(mic.sample()).toBe(0);
    expect(env.analyser.getByteTimeDomainData).not.toHaveBeenCalled();
  });

  it("releases an acquired stream when Web Audio initialization fails", async () => {
    const env = audioEnvironment(true);
    await expect(openLocalMicrophone()).rejects.toThrow("Audio suspended");
    expect(env.stop).toHaveBeenCalledOnce();
    expect(env.close).toHaveBeenCalledOnce();
  });

  it("propagates permission denial so the UI can use its simulation", async () => {
    const env = audioEnvironment();
    env.getUserMedia.mockRejectedValue(new Error("Permission denied"));
    await expect(openLocalMicrophone()).rejects.toThrow("Permission denied");
    expect(env.close).not.toHaveBeenCalled();
  });

  it("supports browsers without microphone APIs through the same fallback", async () => {
    vi.stubGlobal("navigator", {});
    await expect(openLocalMicrophone()).rejects.toThrow(
      "Microphone unavailable",
    );
  });

  it("stops an active microphone immediately when its owning interaction aborts", async () => {
    const env = audioEnvironment();
    const controller = new AbortController();
    const mic = await openLocalMicrophone(controller.signal);
    controller.abort();
    expect(env.stop).toHaveBeenCalledOnce();
    expect(env.close).toHaveBeenCalledOnce();
    expect(mic.sample()).toBe(0);
  });

  it("releases a late permission result without constructing an audio context", async () => {
    const env = audioEnvironment();
    const controller = new AbortController();
    const pending = openLocalMicrophone(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(env.stop).toHaveBeenCalledOnce();
    expect(env.close).not.toHaveBeenCalled();
  });
});

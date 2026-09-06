export type LocalMicrophone = { sample: () => number; stop: () => void };

export async function openLocalMicrophone(
  signal?: AbortSignal,
): Promise<LocalMicrophone> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Microphone unavailable");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener("abort", stop);
    stream.getTracks().forEach((track) => track.stop());
    source?.disconnect();
    analyser?.disconnect();
    void context?.close().catch(() => undefined);
  }
  signal?.addEventListener("abort", stop, { once: true });
  try {
    signal?.throwIfAborted();
    context = new AudioContext();
    await context.resume();
    signal?.throwIfAborted();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    return {
      sample() {
        if (stopped) return 0;
        analyser!.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += ((value - 128) / 128) ** 2;
        return Math.min(1, Math.sqrt(sum / samples.length) * 5);
      },
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}

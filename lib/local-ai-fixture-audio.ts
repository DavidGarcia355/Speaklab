const SAMPLE_RATE = 8_000;
const BITS_PER_SAMPLE = 8;
const CHANNELS = 1;

/** Creates a short, deterministic silent WAV for local-only playback and AI smoke fixtures. */
export function createSilentWavFixtureDataUrl(durationMilliseconds = 250) {
  const sampleCount = Math.max(1, Math.round((SAMPLE_RATE * durationMilliseconds) / 1_000));
  const dataSize = sampleCount * CHANNELS;
  const wav = Buffer.alloc(44 + dataSize);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(CHANNELS, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28);
  wav.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);
  wav.writeUInt16LE(BITS_PER_SAMPLE, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  wav.fill(128, 44);

  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

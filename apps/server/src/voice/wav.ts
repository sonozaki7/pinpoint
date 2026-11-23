export const SAMPLE_RATE = 16_000;
export const BYTES_PER_SAMPLE = 2;
export const MAX_PCM_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * 25;

/** Wrap raw s16le mono PCM in a 44-byte WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bits) / 8, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function isWav(audio: Buffer): boolean {
  return audio.length >= 44 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE';
}

/** Read the PCM data chunk from a WAV file. */
export function wavToPcm(wav: Buffer): Buffer {
  if (!isWav(wav)) throw new Error('Not a WAV file');
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'data') {
      const end = Math.min(start + size, wav.length);
      return wav.subarray(start, end);
    }
    offset = start + size + (size % 2);
  }
  // Some encoders omit the data chunk size; treat the tail as audio.
  return wav.subarray(44);
}

export function pcmDurationMs(pcm: Buffer): number {
  return Math.round((pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000);
}

/**
 * Convert signed 16-bit little-endian PCM to the Float32 mono PCM that T3's
 * /api/voice/transcribe endpoint expects.
 */
export function pcm16ToFloat32(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  const floats = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    floats[i] = pcm.readInt16LE(i * BYTES_PER_SAMPLE) / 32_768;
  }
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

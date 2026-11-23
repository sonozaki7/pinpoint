/** Raw PCM is s16le, 16 kHz, mono: 32 bytes per millisecond. */
export const PCM_BYTES_PER_MS = 32;

export function concatPcm(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function pcmDurationMs(bytes: number): number {
  return Math.round(bytes / PCM_BYTES_PER_MS);
}

/** Buffers microphone frames between the two taps. */
export class PcmRecorder {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private open = false;

  start() {
    this.chunks = [];
    this.size = 0;
    this.open = true;
  }

  push(pcm: Uint8Array) {
    if (!this.open || pcm.length === 0) return;
    this.chunks.push(pcm);
    this.size += pcm.length;
  }

  stop(): Uint8Array {
    const pcm = concatPcm(this.chunks);
    this.chunks = [];
    this.size = 0;
    this.open = false;
    return pcm;
  }

  get active(): boolean {
    return this.open;
  }

  get bytes(): number {
    return this.size;
  }
}

/** Raw PCM is s16le, 16 kHz, mono: 32 bytes per millisecond. */
export const PCM_BYTES_PER_MS = 32;
/** The server refuses bodies over 25 s; stop buffering there even if auto-stop fails. */
export const MAX_RECORD_BYTES = 25_000 * PCM_BYTES_PER_MS;

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
    if (!this.open || pcm.length === 0 || this.size >= MAX_RECORD_BYTES) return;
    const room = MAX_RECORD_BYTES - this.size;
    const chunk = pcm.length <= room ? pcm : pcm.subarray(0, room);
    // Copy: the host may reuse the frame buffer before stop() is called.
    this.chunks.push(chunk.slice());
    this.size += chunk.length;
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

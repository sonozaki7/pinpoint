/** Raw PCM is s16le, 16 kHz, mono: 32 bytes per millisecond. */
export const PCM_BYTES_PER_MS = 32;
/** Hard ceiling for one note; the user should never hold the ring that long. */
export const VOICE_HARD_STOP_MS = 30_000;
export const MAX_RECORD_BYTES = VOICE_HARD_STOP_MS * PCM_BYTES_PER_MS;
/** Recording ends after this much quiet, provided speech already started. */
export const SILENCE_STOP_MS = 1_200;
/** A cough or a door must not count as "speech started". */
export const MIN_SPEECH_MS = 500;
/** RMS of 16-bit samples above this is speech, not room noise. */
export const SPEECH_RMS_THRESHOLD = 420;

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

/** Root-mean-square of one s16le frame, 0 for an empty frame. */
export function pcmRms(pcm: Uint8Array): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples; index++) {
    const low = pcm[index * 2] ?? 0;
    const high = pcm[index * 2 + 1] ?? 0;
    const raw = (high << 8) | low;
    const value = raw >= 0x8000 ? raw - 0x10000 : raw;
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}

/**
 * Energy-based end-of-speech detector. Feed it the same PCM frames as the
 * recorder; it asks to stop once the user has spoken at least half a second
 * and then stayed quiet for 1.2 s, or when the 30 s ceiling is reached.
 * Tapping still stops a recording at any time.
 */
export class SilenceGate {
  private totalMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private heard = false;

  constructor(
    private readonly threshold = SPEECH_RMS_THRESHOLD,
    private readonly silenceMsLimit = SILENCE_STOP_MS,
    private readonly minSpeechMs = MIN_SPEECH_MS,
    private readonly maxMs = VOICE_HARD_STOP_MS,
  ) {}

  reset(): void {
    this.totalMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.heard = false;
  }

  /** True when the recording should stop now. */
  push(pcm: Uint8Array): boolean {
    const duration = pcmDurationMs(pcm.length);
    this.totalMs += duration;
    if (pcmRms(pcm) >= this.threshold) {
      this.speechMs += duration;
      this.silenceMs = 0;
      if (this.speechMs >= this.minSpeechMs) this.heard = true;
    } else if (this.heard) {
      this.silenceMs += duration;
    }
    if (this.totalMs >= this.maxMs) return true;
    return this.heard && this.silenceMs >= this.silenceMsLimit;
  }

  get speech(): number {
    return this.speechMs;
  }

  get silence(): number {
    return this.silenceMs;
  }

  get elapsed(): number {
    return this.totalMs;
  }
}

/** Build one PCM frame from a constant amplitude (tests and fixtures). */
export function pcmFrame(ms: number, amplitude: number): Uint8Array {
  const samples = Math.max(1, Math.round(ms * PCM_BYTES_PER_MS / 2));
  const out = new Uint8Array(samples * 2);
  for (let index = 0; index < samples; index++) {
    const value = amplitude & 0xffff;
    out[index * 2] = value & 0xff;
    out[index * 2 + 1] = (value >> 8) & 0xff;
  }
  return out;
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

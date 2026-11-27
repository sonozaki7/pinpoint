/** Target format for Pinpoint Cloud: 16 kHz, mono, signed 16-bit little-endian. */
export const TARGET_RATE = 16_000;
export const MAX_CAPTURE_MS = 30_000;
/** Recording ends after this much quiet, once speech has started (same as the glasses). */
export const SILENCE_STOP_MS = 1_200;
export const MIN_SPEECH_MS = 500;
/** RMS of float samples above this is speech, not room noise. */
export const SPEECH_RMS = 0.0125;

function floatRms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const value = frame[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / frame.length);
}

type AudioContextCtor = typeof AudioContext;

const WORKLET_SOURCE = `
class PinpointCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      const copy = channel.slice();
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor("pinpoint-capture", PinpointCapture);
`;

function audioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Average source samples down to 16 kHz mono and convert to s16le bytes. */
export function toPcm16(input: Float32Array, sourceRate: number): Uint8Array {
  const rate = sourceRate > 0 ? sourceRate : TARGET_RATE;
  const ratio = rate / TARGET_RATE;
  const length = Math.max(0, Math.floor(input.length / ratio));
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j] ?? 0;
      count++;
    }
    const sample = count > 0 ? sum / count : (input[start] ?? 0);
    pcm[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}

/**
 * Microphone capture for the simulator. Uses getUserMedia + Web Audio (works
 * on iOS Safari and Android Chrome), buffers float frames, and hands back raw
 * 16 kHz PCM when recording stops. Nothing is uploaded here.
 */
export class MicRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private frames = 0;
  private maximumFrames = 0;
  private open = false;
  private cancelled = false;
  private starting: Promise<void> | null = null;
  private speechMs = 0;
  private silenceMs = 0;
  private heard = false;
  private autoStopFired = false;

  /**
   * Called once when the speaker has been quiet for 1.2 s after speaking.
   * The main loop then stops recording exactly as if the ring was tapped.
   */
  onAutoStop: (() => void) | null = null;

  get active(): boolean {
    return this.open;
  }

  /**
   * iOS Safari only lets an AudioContext start inside a gesture. Create and
   * resume it on the first tap, then reuse it for every recording.
   */
  prime(): void {
    if (this.context && this.context.state !== "closed") {
      if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
      return;
    }
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    try {
      this.context = new Ctor();
      if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
    } catch {
      this.context = null;
    }
  }

  async start(): Promise<void> {
    this.cancelled = false;
    this.open = true;
    this.chunks = [];
    this.frames = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.heard = false;
    this.autoStopFired = false;
    const pending = this.openStream();
    this.starting = pending;
    try {
      await pending;
    } catch (error) {
      this.open = false;
      this.cleanup();
      throw error;
    } finally {
      this.starting = null;
    }
    if (this.cancelled) this.cleanup();
  }

  private async openStream(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone is not available");
    const Ctor = audioContextCtor();
    if (!Ctor) throw new Error("Web Audio is not available");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (!this.open || this.cancelled) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    const context = this.context && this.context.state !== "closed" ? this.context : new Ctor();
    this.context = context;
    if (context.state === "suspended") await context.resume();
    this.maximumFrames = Math.round((context.sampleRate * MAX_CAPTURE_MS) / 1000);
    const source = context.createMediaStreamSource(stream);
    const sink = context.createGain();
    sink.gain.value = 0;
    sink.connect(context.destination);
    this.source = source;
    this.sink = sink;

    // AudioWorklet keeps the main thread free and avoids the deprecated
    // ScriptProcessor warning in current Chrome. Older Safari gets the fallback.
    if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
        await context.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const worklet = new AudioWorkletNode(context, "pinpoint-capture");
        worklet.port.onmessage = (event: MessageEvent<Float32Array>) => this.push(event.data);
        source.connect(worklet);
        worklet.connect(sink);
        this.worklet = worklet;
        return;
      } catch {
        // Fall through to ScriptProcessor; capture still works.
      }
    }

    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => this.push(event.inputBuffer.getChannelData(0));
    source.connect(processor);
    processor.connect(sink);
    this.processor = processor;
  }

  private push(channel: Float32Array): void {
    if (!this.open || this.cancelled) return;
    if (this.frames >= this.maximumFrames) return;
    const room = this.maximumFrames - this.frames;
    const chunk = channel.length <= room ? channel.slice() : channel.slice(0, room);
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.frames += chunk.length;
    this.trackSpeech(chunk);
  }

  /** The glasses' end-of-speech rule, applied to the same float frames. */
  private trackSpeech(chunk: Float32Array): void {
    const rate = this.context?.sampleRate ?? TARGET_RATE;
    const durationMs = (chunk.length / rate) * 1_000;
    if (floatRms(chunk) >= SPEECH_RMS) {
      this.speechMs += durationMs;
      this.silenceMs = 0;
      if (this.speechMs >= MIN_SPEECH_MS) this.heard = true;
      return;
    }
    if (!this.heard) return;
    this.silenceMs += durationMs;
    if (this.autoStopFired || this.silenceMs < SILENCE_STOP_MS) return;
    this.autoStopFired = true;
    const callback = this.onAutoStop;
    if (callback) window.setTimeout(() => callback(), 0);
  }

  /** Stops capture and returns PCM. Safe to call while the mic is still starting. */
  async stop(): Promise<Uint8Array> {
    this.open = false;
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        // start() already surfaced the error; nothing was captured.
      }
    }
    const rate = this.context?.sampleRate ?? TARGET_RATE;
    const merged = this.merge();
    this.cleanup();
    return toPcm16(merged, rate);
  }

  cancel(): void {
    this.open = false;
    this.cancelled = true;
    this.chunks = [];
    this.frames = 0;
    if (!this.starting) this.cleanup();
  }

  private merge(): Float32Array {
    const out = new Float32Array(this.frames);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  private cleanup(): void {
    try {
      if (this.processor) {
        this.processor.onaudioprocess = null;
        this.processor.disconnect();
      }
      if (this.worklet) {
        this.worklet.port.onmessage = null;
        this.worklet.disconnect();
      }
      this.source?.disconnect();
      this.sink?.disconnect();
      for (const track of this.stream?.getTracks() ?? []) track.stop();
      // Keep the AudioContext alive: Safari will not resume a new one outside a
      // gesture, and an idle context costs nothing measurable on this page.
    } catch {
      // Cleanup is best-effort; a failed disconnect must not block the UI.
    }
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.worklet = null;
    this.sink = null;
    this.chunks = [];
    this.frames = 0;
  }
}

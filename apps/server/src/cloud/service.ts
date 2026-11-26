import type { Health } from '../../../../shared/contract.js';
import type { Env } from '../core/env.js';
import { HttpError, errorMessage } from '../core/errors.js';
import type { VoiceHint, VoiceTranscriber } from '../voice/service.js';
import { verdictForTranscript } from '../voice/verdict.js';
import {
  CLOUD_VOICE_CONCURRENCY,
  CLOUD_VOICE_QUEUE_MS,
} from './limits.js';
import { DeskHub } from './deskHub.js';
import { TranscriptionQueue } from './rateLimit.js';
import type { SampleWorkspaceDefinition } from './sample.js';
import {
  SampleDeviceRouter,
  type DeviceRouter,
  type DeviceWorkspace,
} from './workspace.js';

export interface CloudServiceDeps {
  env: Env;
  sample: SampleWorkspaceDefinition;
  voice: VoiceTranscriber;
  /** Tests may inject a different router; the sample workspace is the fallback. */
  router?: DeviceRouter;
  /** Tests may inject a preconfigured desk hub; production creates one. */
  desk?: DeskHub;
}

const SWEEP_INTERVAL_MS = 60 * 60_000;

/**
 * The public cloud server: no T3, no Telegram, no splitter, no API keys.
 *
 * Each device id gets a private in-memory sample workspace. Devices idle for
 * seven days (or beyond the 5,000-device cap) are dropped; a process restart
 * restores the sample workspace for everyone.
 */
export class CloudService {
  readonly env: Env;
  readonly router: DeviceRouter;
  /** Live desks and device pairings; in memory, wiped on restart. */
  readonly desk: DeskHub;
  private readonly voice: VoiceTranscriber;
  private readonly queue: TranscriptionQueue;
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(deps: CloudServiceDeps) {
    this.env = deps.env;
    this.voice = deps.voice;
    this.desk = deps.desk ?? new DeskHub();
    this.queue = new TranscriptionQueue(CLOUD_VOICE_CONCURRENCY, CLOUD_VOICE_QUEUE_MS);
    this.router =
      deps.router ??
      new SampleDeviceRouter({
        sample: deps.sample,
        replyMs: deps.env.sampleReplyMs,
      });
    this.sweepTimer = setInterval(() => this.router.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  /**
   * Cloud health. A device paired to a live/registered desk gets the desk
   * workspace; everything else keeps the private sample workspace. Pairing is
   * always advertised as available.
   */
  health(desk?: { name: string; online: boolean }): Health {
    return {
      ok: true,
      mode: 'cloud',
      t3: 'off',
      telegram: 'off',
      splitter: 'fixture',
      version: this.env.serverVersion,
      workspace: desk ? 'desk' : 'sample',
      pairing: true,
      ...(desk ? { desk } : {}),
    };
  }

  workspaceFor(deviceId: string): DeviceWorkspace {
    return this.router.workspaceFor(deviceId);
  }

  get deviceCount(): number {
    return this.router.deviceCount;
  }

  async transcribe(
    _deviceId: string,
    audio: Buffer,
    hint?: VoiceHint,
  ): Promise<{ text: string; verdict: 'object' | 'note' }> {
    try {
      const result = await this.queue.run(() => this.voice.transcribe(audio, hint));
      return { text: result.text, verdict: verdictForTranscript(result.text) };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, errorMessage(error), 'voice_error');
    }
  }

  stop(): void {
    clearInterval(this.sweepTimer);
    this.router.stop();
    this.desk.stop();
  }
}

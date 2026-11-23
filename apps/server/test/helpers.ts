import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeckStore } from '../src/core/decks.js';
import { loadDemoData } from '../src/core/demo.js';
import { readEnv } from '../src/core/env.js';
import { FakeTelegramNotifier, FakeT3Client } from '../src/core/fakes.js';
import { ReviewStore } from '../src/core/reviews.js';
import { PinpointService } from '../src/core/service.js';
import { createNaiveSplitter } from '../src/core/splitter/index.js';
import type { Splitter } from '../src/core/splitter/types.js';
import type { VoiceTranscriber } from '../src/voice/service.js';

export const stubVoice: VoiceTranscriber = {
  async transcribe() {
    return { text: 'No, migrate the sessions instead', via: 't3' };
  },
};

export interface TestContext {
  dir: string;
  service: PinpointService;
  t3: FakeT3Client;
  telegram: FakeTelegramNotifier;
}

export async function makeTestContext(options?: {
  preload?: boolean;
  voice?: VoiceTranscriber;
  precomputed?: boolean;
  splitter?: Splitter;
  env?: Record<string, string>;
}): Promise<TestContext> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-test-'));
  const env = readEnv({
    PINPOINT_MODE: 'demo',
    SPLITTER_PROVIDER: 'fixture',
    ...options?.env,
    // Always isolate test data, even when a test overrides other settings.
    PINPOINT_DATA_DIR: dir,
  });
  const demo = loadDemoData(path.join(dir, 'missing-fixtures'));
  const t3 = new FakeT3Client(demo.fixtures);
  const telegram = new FakeTelegramNotifier();
  const service = new PinpointService({
    env,
    t3,
    t3Live: false,
    telegram,
    splitter: options?.splitter ?? createNaiveSplitter(),
    decks: new DeckStore(dir),
    reviews: new ReviewStore(dir),
    voice: options?.voice ?? stubVoice,
    precomputed: options?.precomputed === false ? undefined : demo.precomputed,
  });
  await service.start();
  if (options?.preload !== false) await service.preload();
  return { dir, service, t3, telegram };
}

export async function cleanupTestContext(context: TestContext): Promise<void> {
  await context.service.stop();
  await fs.promises.rm(context.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

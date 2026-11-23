import { serve } from '@hono/node-server';
import { DeckStore } from './core/decks.js';
import { loadDemoData } from './core/demo.js';
import { readEnv } from './core/env.js';
import { FakeT3Client } from './core/fakes.js';
import { loadTelegramNotifier, loadT3Client } from './core/loaders.js';
import { ReviewStore } from './core/reviews.js';
import { PinpointService } from './core/service.js';
import { createSplitter } from './core/splitter/index.js';
import { createApp } from './http/app.js';
import { createVoiceService } from './voice/service.js';
import type { AttentionThread } from './core/types.js';

async function main(): Promise<void> {
  const env = readEnv();
  const demo = env.mode === 'demo' ? loadDemoData(env.fixturesDir) : undefined;

  let t3;
  let t3Live = false;
  if (demo) {
    t3 = new FakeT3Client(demo.fixtures);
  } else {
    const loaded = await loadT3Client(env);
    t3 = loaded.client;
    t3Live = loaded.live;
    if (!loaded.live) {
      console.warn(
        `[pinpoint] T3 client unavailable (${loaded.reason ?? 'unknown reason'}); waiting in live mode with no threads`,
      );
    }
  }

  let service: PinpointService | null = null;
  const telegramLoaded = await loadTelegramNotifier(env, {
    onAgreeAll: async (threadOrId: AttentionThread | string) => {
      if (!service) throw new Error('Server is still starting');
      const thread =
        typeof threadOrId === 'string'
          ? await service.inbox.lookupThread(threadOrId)
          : threadOrId;
      if (!thread) throw new Error(`Unknown thread ${threadOrId}`);
      await service.agreeAll(thread);
    },
  });
  if (!telegramLoaded.live && telegramLoaded.reason) {
    console.warn(`[pinpoint] Telegram notifier unavailable: ${telegramLoaded.reason}`);
  }

  const splitter = createSplitter(env);
  const decks = new DeckStore(env.dataDir);
  const reviews = new ReviewStore(env.dataDir);
  const voice = createVoiceService(env);

  service = new PinpointService({
    env,
    t3,
    t3Live,
    telegram: telegramLoaded.notifier,
    splitter,
    decks,
    reviews,
    voice,
    precomputed: demo?.precomputed,
  });

  await service.start();
  const app = createApp({ service });
  const server = serve({ fetch: app.fetch, port: env.port });

  console.info(
    `[pinpoint] listening on http://127.0.0.1:${env.port} mode=${env.mode} splitter=${splitter.label} telegram=${telegramLoaded.notifier.mode}`,
  );

  void service.preload();

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.info(`[pinpoint] shutting down (${signal})`);
    const force = setTimeout(() => process.exit(0), 4_000);
    force.unref();
    try {
      await service?.stop();
    } catch (error) {
      console.warn(`[pinpoint] shutdown error: ${(error as Error).message}`);
    }
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(`[pinpoint] failed to start: ${(error as Error).message}`);
  process.exit(1);
});

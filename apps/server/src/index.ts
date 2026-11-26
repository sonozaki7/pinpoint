import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachDeskSocket } from './cloud/deskSocketServer.js';
import { CLOUD_MAX_DEVICES } from './cloud/limits.js';
import { loadSampleWorkspace } from './cloud/sample.js';
import { CloudService } from './cloud/service.js';
import { DeckStore } from './core/decks.js';
import { loadDemoData, loadDeckFixture } from './core/demo.js';
import { readEnv, assertLivePrivacy, type Env } from './core/env.js';
import { FakeT3Client } from './core/fakes.js';
import { loadTelegramNotifier, loadT3Client } from './core/loaders.js';
import { ReviewStore } from './core/reviews.js';
import { redactSecrets } from './core/redact.js';
import { PinpointService } from './core/service.js';
import { createSplitter } from './core/splitter/index.js';
import { createApp } from './http/app.js';
import { createCloudApp } from './http/cloudApp.js';
import { createSources } from './sources/index.js';
import { createVoiceService } from './voice/service.js';
import type { AttentionThread } from './core/types.js';

export interface LocalRuntime {
  app: ReturnType<typeof createApp>;
  service: PinpointService;
  server: ReturnType<typeof serve>;
  close: () => Promise<void>;
}

async function runCloud(env: Env): Promise<void> {
  // Cloud never loads T3, Telegram or a splitter. The sample workspace comes
  // straight from demo fixtures, so a device opens its deck instantly.
  const sample = loadSampleWorkspace(env);
  const voice = createVoiceService(env);
  const cloud = new CloudService({ env, sample, voice });
  const app = createCloudApp({ cloud });
  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host });
  // Desk WebSockets share the HTTP server; nginx/Cloudflare pass the upgrade.
  const detachDeskSocket = attachDeskSocket(server as unknown as Server, cloud.desk);

  console.info(
    `[pinpoint] listening on http://${env.host}:${env.port} mode=cloud version=${env.serverVersion} ` +
      `workspace=sample devices<=${CLOUD_MAX_DEVICES} state=memory (restart wipes it) splitter=fixture ` +
      `voice=whisper pairing=desk`,
  );

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.info(`[pinpoint] shutting down (${signal})`);
    const force = setTimeout(() => process.exit(0), 4_000);
    force.unref();
    cloud.stop();
    detachDeskSocket();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Start the normal demo/live server and return it without installing signal
 * handlers. `npm run desk` uses the same app in-process to answer relayed
 * requests; the standalone entry below keeps the old CLI behaviour.
 */
export async function startLocal(env: Env): Promise<LocalRuntime> {
  assertLivePrivacy(env);
  const demo = env.mode === 'demo' ? loadDemoData(env.fixturesDir) : undefined;
  const deckFixture = env.deckFixture ? loadDeckFixture(env.deckFixture) : undefined;
  if (deckFixture) console.info(`[pinpoint] deck fixture for ${[...deckFixture.keys()].join(', ')}`);

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
        `[pinpoint] T3 client unavailable (${redactSecrets(loaded.reason ?? 'unknown reason')}); waiting in live mode with no threads`,
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
    onAnswer: async (threadId, pointId, option) => {
      if (!service) throw new Error('Server is still starting');
      await service.answer(threadId, pointId, option);
    },
    onApprove: async (threadId) => {
      if (!service) throw new Error('Server is still starting');
      await service.approve(threadId);
    },
    onSend: async (threadId) => {
      if (!service) throw new Error('Server is still starting');
      await service.sendFromTelegram(threadId);
    },
  });
  if (!telegramLoaded.live && telegramLoaded.reason) {
    console.warn(`[pinpoint] Telegram notifier unavailable: ${redactSecrets(telegramLoaded.reason)}`);
  }

  const splitter = createSplitter(env);
  const decks = new DeckStore(env.dataDir);
  const reviews = new ReviewStore(env.dataDir);
  const voice = createVoiceService(env);
  const { sources } = createSources(env, t3, { demo: env.mode === 'demo' });
  console.info(
    `[pinpoint] review sources: ${sources.map((source) => source.app).join(', ')}`,
  );

  service = new PinpointService({
    env,
    t3,
    t3Live,
    telegram: telegramLoaded.notifier,
    splitter,
    decks,
    reviews,
    voice,
    precomputed: demo?.precomputed ?? deckFixture,
    sources,
  });

  await service.start();
  const app = createApp({ service });
  // Demo/live keep Node's old all-interfaces default unless PINPOINT_HOST is
  // explicitly set, so a LAN phone preview keeps working exactly as before.
  const bindHost =
    (process.env.PINPOINT_HOST ?? '').trim().length > 0 ? env.host : undefined;
  const server = serve({
    fetch: app.fetch,
    port: env.port,
    ...(bindHost ? { hostname: bindHost } : {}),
  });

  console.info(
    `[pinpoint] listening on http://${env.host}:${env.port} mode=${env.mode} splitter=${splitter.label} telegram=${telegramLoaded.notifier.mode}`,
  );

  void service.preload();

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await service.stop();
    } catch (error) {
      console.warn(`[pinpoint] shutdown error: ${redactSecrets((error as Error).message)}`);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { app, service, server, close };
}

async function main(): Promise<void> {
  const env = readEnv();
  // Privacy gate: a live server without an allowlist must not start (SPEC §6).
  assertLivePrivacy(env);
  if (env.mode === 'cloud') {
    await runCloud(env);
    return;
  }

  const runtime = await startLocal(env);
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.info(`[pinpoint] shutting down (${signal})`);
    const force = setTimeout(() => process.exit(0), 4_000);
    force.unref();
    await runtime.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(`[pinpoint] failed to start: ${redactSecrets((error as Error).message)}`);
    process.exit(1);
  });
}

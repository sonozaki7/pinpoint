import type { Env } from './env.js';
import { FakeTelegramNotifier, FakeT3Client } from './fakes.js';
import { redactSecrets } from './redact.js';
import type { AgreeAllHook, TelegramNotifier, T3Client } from './types.js';

async function importModule(url: string): Promise<Record<string, unknown> | null> {
  try {
    const module = (await import(url)) as Record<string, unknown>;
    return module;
  } catch (error) {
    const message = (error as Error).message.split('\n')[0];
    console.warn(`[loaders] could not import ${url}: ${redactSecrets(message)}`);
    return null;
  }
}

function hasMethods(value: unknown, names: string[]): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return names.every((name) => typeof record[name] === 'function');
}

/**
 * Prefer src/t3 when it exists; otherwise an empty fake (live) so the server still runs.
 * The empty fake keeps demo threads out of live mode.
 */
export async function loadT3Client(
  env: Env,
): Promise<{ client: T3Client; live: boolean; reason?: string }> {
  const url = new URL('../t3/index.js', import.meta.url).href;
  const module = await importModule(url);
  const factory = module?.createT3Client;
  if (typeof factory !== 'function') {
    return {
      client: new FakeT3Client([]),
      live: false,
      reason: 'src/t3/index.js is missing createT3Client(env)',
    };
  }
  try {
    const client = (await Promise.resolve((factory as (env: Env) => unknown)(env))) as T3Client;
    if (
      !hasMethods(client, ['listAttention', 'getSource', 'sendMessage', 'answerQuestion'])
    ) {
      throw new Error('createT3Client returned an object without the T3Client methods');
    }
    return { client, live: true };
  } catch (error) {
    return {
      client: new FakeT3Client([]),
      live: false,
      reason: (error as Error).message,
    };
  }
}

/** Prefer src/telegram; otherwise a dry-run fake. */
export async function loadTelegramNotifier(
  env: Env,
  hooks: { onAgreeAll: AgreeAllHook },
): Promise<{ notifier: TelegramNotifier; live: boolean; reason?: string }> {
  const url = new URL('../telegram/index.js', import.meta.url).href;
  const module = await importModule(url);
  const factory = module?.createTelegramNotifier;
  if (typeof factory !== 'function') {
    return {
      notifier: new FakeTelegramNotifier(),
      live: false,
      reason: 'src/telegram/index.js is missing createTelegramNotifier(env, hooks)',
    };
  }
  try {
    const notifier = (await Promise.resolve(
      (factory as (env: Env, hooks: { onAgreeAll: AgreeAllHook }) => unknown)(env, hooks),
    )) as TelegramNotifier;
    if (
      !hasMethods(notifier, ['onAttention', 'onReviewSent', 'readOnPhone', 'start', 'stop']) ||
      (notifier.mode !== 'live' && notifier.mode !== 'dry-run')
    ) {
      throw new Error('createTelegramNotifier returned an invalid notifier');
    }
    return { notifier, live: notifier.mode === 'live' };
  } catch (error) {
    return {
      notifier: new FakeTelegramNotifier(),
      live: false,
      reason: (error as Error).message,
    };
  }
}

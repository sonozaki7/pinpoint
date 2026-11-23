// Thin Bot API transport with three jobs:
//  - dry-run: every intended call is appended to a JSON-lines log, plausible fake ids returned
//  - rate limit: at most one call per second per chat, calls serialised per chat
//  - retry: HTTP 429 responses wait `parameters.retry_after` seconds and retry
// The bot token only ever appears in the request URL; it is never logged or put in an error.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { errorMessage } from '../core/errors.js';
import { redactSecrets } from '../core/redact.js';

export interface TelegramMessage {
  message_id: number;
  [key: string]: unknown;
}

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export interface TransportConfig {
  token: string;
  dryRun: boolean;
  logPath: string;
  allocateId: () => Promise<number>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum gap between two calls in the same chat (default 1000 ms = 1 msg/s). */
  minIntervalMs?: number;
  maxRetries?: number;
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(redactSecrets(`${method} failed (${code || 'network'}): ${description}`));
    this.description = redactSecrets(description);
    this.name = 'TelegramApiError';
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class TelegramTransport {
  private readonly lastCallAt = new Map<string, number>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private logQueue: Promise<void> = Promise.resolve();
  private dirReady: Promise<void> | undefined;

  constructor(private readonly config: TransportConfig) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.config.dryRun) {
      return (await this.dryRunCall(method, params)) as T;
    }
    const key = chatKey(params);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.then(() => this.liveCall<T>(method, params));
    this.queues.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async liveCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const key = chatKey(params);
    const minInterval = this.config.minIntervalMs ?? 1000;
    const sleep = this.config.sleep ?? defaultSleep;
    const now = this.config.now ?? Date.now;
    const doFetch = this.config.fetchImpl ?? fetch;
    const maxRetries = this.config.maxRetries ?? 3;

    for (let attempt = 0; ; attempt += 1) {
      const wait = minInterval - (now() - (this.lastCallAt.get(key) ?? 0));
      if (wait > 0) await sleep(wait);
      this.lastCallAt.set(key, now());

      let response: Response;
      try {
        response = await doFetch(`https://api.telegram.org/bot${this.config.token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
        });
      } catch (error) {
        throw new TelegramApiError(method, 0, `network error: ${errorMessage(error)}`);
      }

      const body = (await response.json().catch(() => undefined)) as TelegramResponse | undefined;
      if (body?.ok) return body.result as T;

      const code = body?.error_code ?? response.status;
      const description = body?.description ?? `HTTP ${response.status}`;
      const retryAfter = body?.parameters?.retry_after;

      if (code === 429 && attempt < maxRetries) {
        await sleep(Math.max(1, Number(retryAfter ?? 1)) * 1000);
        continue;
      }
      throw new TelegramApiError(method, code, description, retryAfter);
    }
  }

  private async dryRunCall(method: string, params: Record<string, unknown>): Promise<unknown> {
    const now = this.config.now ?? Date.now;
    await this.appendLog({ at: new Date(now()).toISOString(), method, params });
    return this.fakeResult(method, params);
  }

  private async fakeResult(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'createForumTopic':
        return { message_thread_id: await this.config.allocateId(), name: params.name };
      case 'sendMessage':
      case 'editMessageText':
        return { message_id: await this.config.allocateId(), chat: { id: params.chat_id } };
      case 'answerCallbackQuery':
        return true;
      case 'getMe':
        return { id: 1000001, is_bot: true, first_name: 'Pinpoint', username: 'pinpoint_bot' };
      case 'getUpdates':
        return [];
      default:
        return true;
    }
  }

  private appendLog(entry: { at: string; method: string; params: Record<string, unknown> }): Promise<void> {
    this.logQueue = this.logQueue
      .then(async () => {
        await this.ensureDir();
        await appendFile(this.config.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
      })
      .catch((error: unknown) => {
        console.error(`[telegram] dry-run log write failed: ${errorMessage(error)}`);
      });
    return this.logQueue;
  }

  private ensureDir(): Promise<void> {
    if (!this.dirReady) {
      this.dirReady = mkdir(dirname(this.config.logPath), { recursive: true }).then(() => undefined);
    }
    return this.dirReady;
  }
}

function chatKey(params: Record<string, unknown>): string {
  return params.chat_id === undefined ? 'global' : String(params.chat_id);
}

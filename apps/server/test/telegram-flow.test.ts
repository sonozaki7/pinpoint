import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deck, Point, ReviewDraft, Note } from '../../../shared/contract.js';
import { handleCallbackQuery } from '../src/telegram/callbacks.js';
import { createTelegramNotifier } from '../src/telegram/index.js';
import { JsonStateStore } from '../src/telegram/store.js';
import { findQuoteMatch } from '../src/telegram/quotes.js';
import { TelegramApiError, TelegramTransport } from '../src/telegram/transport.js';

const dataDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pinpoint-telegram-'));
  dataDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const filler = (label: string): string =>
  `${label}\n\n${'The agent explains this part of the plan with ordinary sentences that take space. '.repeat(
    24,
  )}`;

const sourceText = [
  '# Auth refresh fix',
  'Intro paragraph about the thread and what the agent is about to do.',
  filler('## Section one'),
  filler('## Section two'),
  'Step 4: **Force-logout every user** by truncating the `sessions` table.',
  filler('## Section three'),
  '```ts',
  'export function refreshToken() {',
  '  return withMutex(refreshTokenInner);',
  '}',
  '```',
  filler('## Section four'),
].join('\n\n');

const points: Point[] = [
  {
    id: 'p1',
    index: 1,
    kind: 'claim',
    glance: 'Intro explains the fix',
    quote: 'Intro paragraph about the thread',
  },
  {
    id: 'p2',
    index: 2,
    kind: 'claim',
    glance: 'Section one wording',
    quote: 'The agent explains this part of the plan',
  },
  {
    id: 'p3',
    index: 3,
    kind: 'step',
    glance: 'Migrate sessions in place',
    quote: 'Force-logout every user',
  },
  {
    id: 'p4',
    index: 4,
    kind: 'step',
    glance: 'Word the sessions step',
    quote: 'truncating the sessions table',
  },
  {
    id: 'p5',
    index: 5,
    kind: 'risk',
    glance: 'Mutex may deadlock',
    quote: 'withMutex(refreshTokenInner)',
    risk: 'high',
  },
  {
    id: 'p6',
    index: 6,
    kind: 'step',
    glance: 'Keep the retry path',
    quote: 'Section three',
  },
  {
    id: 'p7',
    index: 7,
    kind: 'step',
    glance: 'Finish the plan',
    quote: 'Section four',
  },
];

const deck: Deck = {
  threadId: 'thread-abc',
  sourceMessageId: 'msg-src-1',
  title: 'auth-refresh-fix',
  attention: 'plan',
  headline: '7 steps to fix auth',
  points,
  createdAt: '2026-11-24T01:00:00.000Z',
  splitter: 'fixture',
};

const thread = {
  threadId: 'thread-abc',
  title: 'auth-refresh-fix',
  project: 'pinpoint',
  attention: 'plan' as const,
};

const source = { sourceMessageId: 'msg-src-1', text: sourceText };

interface LogEntry {
  at: string;
  method: string;
  params: Record<string, any>;
}

async function readLog(dataDir: string): Promise<LogEntry[]> {
  const raw = await readFile(join(dataDir, 'telegram-dryrun.log'), 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry);
}

async function readState(dataDir: string): Promise<any> {
  return JSON.parse(await readFile(join(dataDir, 'telegram.json'), 'utf8')) as any;
}

describe('dry-run notifier flow', () => {
  it('creates a topic, header with agree button, full source in HTML, review and quote replies', async () => {
    const dataDir = await tempDataDir();
    const agreed: string[] = [];
    const notifier = createTelegramNotifier(
      {},
      {
        dataDir,
        onAgreeAll: async (threadId) => {
          agreed.push(threadId);
        },
        sleep: async () => undefined,
      },
    );

    expect(notifier.mode).toBe('dry-run');
    await notifier.onAttention(thread, source, deck);

    const state = await readState(dataDir);
    const record = state.topics['thread-abc'];
    expect(record).toBeDefined();
    expect(record.topicId).toBeGreaterThan(0);
    expect(record.headerMessageId).toBeGreaterThan(0);
    expect(record.parts.length).toBeGreaterThan(1);
    expect(record.parts[0].plain.length).toBeLessThanOrEqual(4000);

    const log = await readLog(dataDir);
    expect(log[0]?.method).toBe('createForumTopic');
    expect(log[0]?.params.chat_id).toBe('-1001234567890');
    expect(log[0]?.params.name).toBe('auth-refresh-fix');

    const header = log.find(
      (entry) => entry.method === 'sendMessage' && entry.params.reply_markup !== undefined,
    );
    expect(header?.params.text).toBe('Needs you · plan · 7 points');
    expect(header?.params.reply_markup.inline_keyboard[0][0]).toEqual({
      text: 'Agree all & continue',
      callback_data: 'agree:thread-abc',
    });

    const sourceSends = log.filter(
      (entry) => entry.method === 'sendMessage' && entry.params.parse_mode === 'HTML',
    );
    expect(sourceSends).toHaveLength(record.parts.length);
    expect(sourceSends.every((entry) => entry.params.disable_notification === true)).toBe(true);
    expect(sourceSends.map((entry) => entry.params.text).join('\n')).toContain('<pre><code');

    const notes: Note[] = [
      { pointId: 'p3', verdict: 'object', text: 'Migrate existing sessions instead.' },
      { pointId: 'p5', verdict: 'note', text: 'Use a request queue, not a mutex.' },
      { pointId: 'p2', verdict: 'answer', option: 'Stay on 6 for now' },
    ];
    const draft: ReviewDraft = {
      threadId: thread.threadId,
      sourceMessageId: source.sourceMessageId,
      notes,
      seen: notes.map((note) => note.pointId),
      updatedAt: '2026-11-24T01:05:00.000Z',
    };
    const composed = [
      'Review from G2 (Pinpoint) — 3 points',
      '✗ 3. "Force-logout every user" → Migrate existing sessions instead.',
      '● 5. "withMutex(refreshTokenInner)" → Use a request queue, not a mutex.',
      '? 2. "The agent explains this part of the plan" → Stay on 6 for now.',
    ].join('\n');

    const review = await notifier.onReviewSent(thread, deck, draft, composed);
    const stateAfterReview = await readState(dataDir);
    const reviewRecord = stateAfterReview.topics['thread-abc'];
    expect(reviewRecord.reviewMessageId).toBeGreaterThan(0);
    expect(review.link).toBe(
      `https://t.me/c/1234567890/${reviewRecord.reviewMessageId}?thread=${record.topicId}`,
    );

    const afterReview = await readLog(dataDir);
    const reviewSend = afterReview.find(
      (entry) => entry.method === 'sendMessage' && entry.params.text === composed,
    );
    expect(reviewSend?.params.reply_parameters).toEqual({
      message_id: record.headerMessageId,
      allow_sending_without_reply: true,
    });

    const quoteReplies = afterReview.filter(
      (entry) => entry.method === 'sendMessage' && entry.params.reply_parameters?.quote !== undefined,
    );
    expect(quoteReplies).toHaveLength(2);

    for (const entry of quoteReplies) {
      const quote = String(entry.params.reply_parameters.quote);
      const target = record.parts.find(
        (part: { messageId: number }) => part.messageId === entry.params.reply_parameters.message_id,
      );
      expect(target).toBeDefined();
      expect(target.plain.includes(quote)).toBe(true);
    }
    expect(quoteReplies.map((entry) => entry.params.text).join('\n')).toContain(
      'Migrate existing sessions instead.',
    );

    const point = points[4] as Point;
    const read = await notifier.readOnPhone(thread, deck, point);
    const afterRead = await readLog(dataDir);
    const readSend = afterRead[afterRead.length - 1];
    expect(readSend?.params.text).toBe('Point 5 — from your glasses');
    const expectedPart = findQuoteMatch(record.parts, point.quote);
    expect(readSend?.params.reply_parameters.message_id).toBe(
      record.parts[expectedPart?.partIndex ?? -1]?.messageId,
    );
    expect(readSend?.params.reply_parameters.quote).toBe(expectedPart?.quote);
    const stateAfterRead = await readState(dataDir);
    expect(read.link).toBe(
      `https://t.me/c/1234567890/${stateAfterRead.fakeNextId - 1}?thread=${record.topicId}`,
    );
    expect(agreed).toEqual([]);

    await notifier.start();
    const afterStart = await readLog(dataDir);
    expect(afterStart[afterStart.length - 1]?.method).toBe('getUpdates');
    await notifier.stop();
  });

  it('reuses the topic and header instead of posting twice', async () => {
    const dataDir = await tempDataDir();
    const notifier = createTelegramNotifier({}, { dataDir, onAgreeAll: async () => undefined });

    await notifier.onAttention(thread, source, deck);
    const first = await readState(dataDir);
    const sends = (await readLog(dataDir)).length;

    await notifier.onAttention(thread, source, deck);
    const second = await readState(dataDir);
    const log = await readLog(dataDir);

    expect(second.topics['thread-abc'].topicId).toBe(first.topics['thread-abc'].topicId);
    expect(second.topics['thread-abc'].headerMessageId).toBe(
      first.topics['thread-abc'].headerMessageId,
    );
    expect(log.length).toBe(sends);
    expect(log.filter((entry) => entry.method === 'createForumTopic')).toHaveLength(1);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('configuration', () => {
  it('reads the server config object keys (telegramToken / telegramChatId / dataDir)', async () => {
    const dataDir = await tempDataDir();
    const notifier = createTelegramNotifier(
      { telegramToken: 'not-a-real-token', telegramChatId: '-1001112223334', dataDir },
      { onAgreeAll: async () => undefined, fetchImpl: (async () => jsonResponse({ ok: true, result: [] })) as unknown as typeof fetch, minIntervalMs: 0 },
    );
    expect(notifier.mode).toBe('live');

    const dry = createTelegramNotifier(
      { telegramToken: '', telegramChatId: '-1001112223334' },
      { dataDir, onAgreeAll: async () => undefined },
    );
    expect(dry.mode).toBe('dry-run');
  });

  it('throws a clear error when a token is set without a chat id', () => {
    expect(() =>
      createTelegramNotifier({ TELEGRAM_BOT_TOKEN: 'not-a-real-token' }, { onAgreeAll: async () => undefined }),
    ).toThrow(/TELEGRAM_CHAT_ID/);
  });
});

describe('live transport behaviour', () => {
  it('retries a 429 after retry_after seconds', async () => {
    const dataDir = await tempDataDir();
    const sleeps: number[] = [];
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse(
          {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 1',
            parameters: { retry_after: 1 },
          },
          429,
        );
      }
      return jsonResponse({ ok: true, result: { message_id: 555 } });
    }) as unknown as typeof fetch;

    const transport = new TelegramTransport({
      token: 'not-a-real-token',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      minIntervalMs: 0,
    });

    const result = await transport.call<{ message_id: number }>('sendMessage', {
      chat_id: '-1001234567890',
      text: 'hello',
    });
    expect(result.message_id).toBe(555);
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it('throws a typed error when 429 retries run out', async () => {
    const dataDir = await tempDataDir();
    const tryFetch = (async () =>
      jsonResponse(
        { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 2 } },
        429,
      )) as unknown as typeof fetch;

    const transport = new TelegramTransport({
      token: 'not-a-real-token',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl: tryFetch,
      sleep: async () => undefined,
      minIntervalMs: 0,
      maxRetries: 1,
    });

    await expect(
      transport.call('sendMessage', { chat_id: '-1001', text: 'x' }),
    ).rejects.toMatchObject({ code: 429, description: 'Too Many Requests' });
  });

  it('waits at least one second between messages in the same chat', async () => {
    const dataDir = await tempDataDir();
    const sleeps: number[] = [];
    const okFetch = (async () =>
      jsonResponse({ ok: true, result: { message_id: 1 } })) as unknown as typeof fetch;

    const transport = new TelegramTransport({
      token: 'not-a-real-token',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl: okFetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      minIntervalMs: 1000,
    });

    await transport.call('sendMessage', { chat_id: '-1002', text: 'one' });
    await transport.call('sendMessage', { chat_id: '-1002', text: 'two' });

    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(800);
    expect(sleeps[0]).toBeLessThanOrEqual(1000);
  });

  it('falls back to a plain reply when Telegram rejects the quote', async () => {
    const dataDir = await tempDataDir();
    const calls: Array<{ method: string; params: Record<string, any> }> = [];
    let messageId = 500;

    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const method = String(url).split('/').pop() ?? '';
      const params = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
      calls.push({ method, params });
      if (method === 'createForumTopic') {
        return jsonResponse({ ok: true, result: { message_thread_id: 41 } });
      }
      if (method === 'sendMessage' && params.reply_parameters?.quote !== undefined) {
        return jsonResponse(
          { ok: false, error_code: 400, description: 'Bad Request: QUOTE_TEXT_INVALID' },
          400,
        );
      }
      messageId += 1;
      return jsonResponse({ ok: true, result: { message_id: messageId } });
    }) as unknown as typeof fetch;

    const notifier = createTelegramNotifier(
      { TELEGRAM_BOT_TOKEN: 'not-a-real-token', TELEGRAM_CHAT_ID: '-1009876543210' },
      { dataDir, onAgreeAll: async () => undefined, fetchImpl, minIntervalMs: 0 },
    );
    expect(notifier.mode).toBe('live');

    const minimalSource = { sourceMessageId: 'src-2', text: 'Step 4: Force-logout every user.' };
    const minimalDeck: Deck = {
      ...deck,
      sourceMessageId: 'src-2',
      points: [{ ...(points[2] as Point), quote: 'Force-logout every user', index: 1 }],
    };
    await notifier.onAttention(thread, minimalSource, minimalDeck);

    const draft: ReviewDraft = {
      threadId: thread.threadId,
      sourceMessageId: minimalSource.sourceMessageId,
      notes: [{ pointId: 'p3', verdict: 'object', text: 'Migrate instead.' }],
      seen: ['p3'],
      updatedAt: '2026-11-24T01:10:00.000Z',
    };
    await notifier.onReviewSent(
      thread,
      minimalDeck,
      draft,
      'Review from G2 (Pinpoint) — 1 point\n✗ 1. "Force-logout every user" → Migrate instead.',
    );

    const quoted = calls.filter(
      (call) => call.method === 'sendMessage' && call.params.reply_parameters?.quote !== undefined,
    );
    const fallbacks = calls.filter(
      (call) =>
        call.method === 'sendMessage' &&
        call.params.reply_parameters !== undefined &&
        call.params.reply_parameters.quote === undefined &&
        call.params.text === '✗ 1. "Force-logout every user" → Migrate instead.',
    );
    expect(quoted).toHaveLength(1);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.params.reply_parameters.message_id).toBe(quoted[0]?.params.reply_parameters.message_id);
  });

  it('does not leak the bot token into errors', async () => {
    const dataDir = await tempDataDir();
    const failing = (async () =>
      jsonResponse({ ok: false, error_code: 404, description: 'Not Found' }, 404)) as unknown as typeof fetch;
    const transport = new TelegramTransport({
      token: 'secret-token-value',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl: failing,
      sleep: async () => undefined,
      minIntervalMs: 0,
    });

    const error = await transport
      .call('sendMessage', { chat_id: '-1003', text: 'x' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as Error).message).not.toContain('secret-token-value');
  });
});

describe('agreement callback', () => {
  const seedTopic = async (store: JsonStateStore): Promise<void> => {
    await store.update((state) => {
      state.topics['thread-abc'] = {
        threadId: 'thread-abc',
        chatId: '-1005550001111',
        topicId: 41,
        title: 'auth-refresh-fix',
        attention: 'plan',
        pointCount: 7,
        headerMessageId: 55,
        headerText: 'Needs you · plan · 7 points',
        sourceMessageIds: [],
        parts: [],
        updatedAt: '2026-11-24T01:00:00.000Z',
      };
    });
  };

  it('calls onAgreeAll, answers the callback and marks the header done', async () => {
    const dataDir = await tempDataDir();
    const calls: Array<{ method: string; params: Record<string, any> }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const method = String(url).split('/').pop() ?? '';
      calls.push({ method, params: JSON.parse(String(init?.body ?? '{}')) as Record<string, any> });
      return jsonResponse({ ok: true, result: true });
    }) as unknown as typeof fetch;

    const transport = new TelegramTransport({
      token: 'not-a-real-token',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl,
      sleep: async () => undefined,
      minIntervalMs: 0,
    });
    const store = new JsonStateStore(join(dataDir, 'telegram.json'));
    await seedTopic(store);

    const order: string[] = [];
    await handleCallbackQuery(
      {
        chatId: '-1005550001111',
        transport,
        store,
        onAgreeAll: async (threadId) => {
          order.push(`agree:${threadId}`);
        },
        nowIso: () => '2026-11-24T02:00:00.000Z',
      },
      { id: 'cb-1', data: 'agree:thread-abc' },
    );
    order.push(...calls.map((call) => call.method));

    expect(order).toEqual(['agree:thread-abc', 'answerCallbackQuery', 'editMessageText']);
    expect(calls[0]?.params).toMatchObject({
      callback_query_id: 'cb-1',
      text: 'Agreed — sent to T3',
    });
    expect(calls[1]?.params).toMatchObject({
      chat_id: '-1005550001111',
      message_id: 55,
      text: '✓ Agreed on phone · plan · 7 points',
      reply_markup: { inline_keyboard: [] },
    });

    const state = await store.get();
    expect(state.topics['thread-abc']?.agreedAt).toBe('2026-11-24T02:00:00.000Z');
    expect(state.topics['thread-abc']?.headerText).toBe('✓ Agreed on phone · plan · 7 points');
  });

  it('reports a failure without editing the header when onAgreeAll throws', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dataDir = await tempDataDir();
    const calls: Array<{ method: string; params: Record<string, any> }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({
        method: String(url).split('/').pop() ?? '',
        params: JSON.parse(String(init?.body ?? '{}')) as Record<string, any>,
      });
      return jsonResponse({ ok: true, result: true });
    }) as unknown as typeof fetch;

    const transport = new TelegramTransport({
      token: 'not-a-real-token',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl,
      sleep: async () => undefined,
      minIntervalMs: 0,
    });
    const store = new JsonStateStore(join(dataDir, 'telegram.json'));
    await seedTopic(store);

    await handleCallbackQuery(
      {
        chatId: '-1005550001111',
        transport,
        store,
        onAgreeAll: async () => {
          throw new Error('T3 is down');
        },
        nowIso: () => '2026-11-24T02:00:00.000Z',
      },
      { id: 'cb-2', data: 'agree:thread-abc' },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('answerCallbackQuery');
    expect(calls[0]?.params).toMatchObject({ text: 'Could not reach T3. Try again.', show_alert: true });
    const state = await store.get();
    expect(state.topics['thread-abc']?.agreedAt).toBeUndefined();
    quiet.mockRestore();
  });

  it('ignores unknown callback data', async () => {
    const dataDir = await tempDataDir();
    const store = new JsonStateStore(join(dataDir, 'telegram.json'));
    const calls: Array<Record<string, unknown>> = [];
    const transport = new TelegramTransport({
      token: 'not-a-real-token',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl: (async (_url: string | URL, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return jsonResponse({ ok: true, result: true });
      }) as unknown as typeof fetch,
      sleep: async () => undefined,
      minIntervalMs: 0,
    });

    await handleCallbackQuery(
      { chatId: '-100', transport, store, onAgreeAll: async () => undefined, nowIso: () => '' },
      { id: 'cb-3', data: 'something-else' },
    );
    expect(calls[0]).toMatchObject({ callback_query_id: 'cb-3', text: 'Unknown action' });
  });
});

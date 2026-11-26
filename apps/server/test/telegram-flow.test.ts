import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deck, Point, ReviewDraft, Note } from '../../../shared/contract.js';
import { handleCallbackQuery } from '../src/telegram/callbacks.js';
import {
  LEGEND_TEXT,
  cardFirstLine,
  messageLink,
  needsCard,
  noteReplyText,
  renderCard,
  reviewCounts,
  reviewedFirstLine,
  summaryText,
} from '../src/telegram/format.js';
import { createTelegramNotifier } from '../src/telegram/index.js';
import { JsonStateStore } from '../src/telegram/store.js';
import { findQuoteMatch, paragraphContaining } from '../src/telegram/quotes.js';
import { applyTopicStatus, type TopicIconResolver } from '../src/telegram/status.js';
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
  filler('## Section two'),
  'Step 4: **Force-logout every user** by truncating the `sessions` table.',
  filler('## Section three'),
  ['```ts', 'export function refreshToken() {', '  return withMutex(refreshTokenInner);', '}', '```'].join('\n'),
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

const CARD_NEEDS = [
  '🟡 Needs you: plan, 7 steps',
  'auth-refresh-fix · pinpoint',
  '',
  '1. Intro explains the fix',
  '2. Section one wording',
  '3. Migrate sessions in place',
  '4. Word the sessions step',
  '5. ⚠️ Mutex may deadlock',
  '6. Keep the retry path',
  '7. Finish the plan',
  '',
  'Review it on your G2, or:',
].join('\n');

const CARD_REVIEWED = [
  '✅ Reviewed from G2: 1 change sent',
  'auth-refresh-fix · pinpoint',
  '',
  '1. Intro explains the fix',
  '2. Section one wording',
  '3. Migrate sessions in place',
  '4. Word the sessions step',
  '5. ⚠️ Mutex may deadlock',
  '6. Keep the retry path',
  '7. Finish the plan',
].join('\n');

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
  'Review from G2 (Pinpoint) — 7 points',
  '✗ 3. "Force-logout every user" → Migrate existing sessions instead.',
  '● 5. "withMutex(refreshTokenInner)" → Use a request queue, not a mutex.',
  '? 2. "The agent explains this part of the plan" → Stay on 6 for now.',
].join('\n');

describe('format helpers', () => {
  it('writes a card first line for every attention type', () => {
    expect(cardFirstLine({ title: 'login-fix', attention: 'plan' }, 7)).toBe(
      '🟡 Needs you: plan, 7 steps',
    );
    expect(cardFirstLine({ title: 'login-fix', attention: 'plan' }, 1)).toBe(
      '🟡 Needs you: plan, 1 step',
    );
    expect(cardFirstLine({ title: 'payment-upgrade', attention: 'question' }, 5)).toBe(
      '🟡 Needs you: a question',
    );
    expect(cardFirstLine({ title: 'auth-refresh-fix', attention: 'failed' }, 0)).toBe(
      '⚠️ Failed: auth-refresh-fix',
    );
    expect(cardFirstLine({ title: 'weekly-report', attention: 'report' }, 4)).toBe(
      '🟡 Needs you: reply, 4 points',
    );
  });

  it('renders the numbered glasses lines with a warning on risks', () => {
    expect(needsCard(thread, deck)).toEqual({
      firstLine: '🟡 Needs you: plan, 7 steps',
      titleLine: 'auth-refresh-fix · pinpoint',
      points: [
        '1. Intro explains the fix',
        '2. Section one wording',
        '3. Migrate sessions in place',
        '4. Word the sessions step',
        '5. ⚠️ Mutex may deadlock',
        '6. Keep the retry path',
        '7. Finish the plan',
      ],
      footer: 'Review it on your G2, or:',
    });
  });

  it('counts and summarises a review with correct plurals', () => {
    const counts = reviewCounts(deck, notes);
    expect(counts).toEqual({ objections: 1, notes: 1, answers: 1, agreed: 4 });
    expect(summaryText(counts)).toBe(
      '✅ Sent to the agent from your G2: 1 change, 1 note, 1 answer, 4 agreed',
    );
    expect(reviewedFirstLine(counts)).toBe('✅ Reviewed from G2: 1 change sent');
    expect(reviewedFirstLine({ objections: 0, notes: 2, answers: 0, agreed: 5 })).toBe(
      '✅ Reviewed from G2: 2 notes sent',
    );
    expect(reviewedFirstLine({ objections: 0, notes: 0, answers: 1, agreed: 6 })).toBe(
      '✅ Answered from G2: 1 answer sent',
    );
    expect(reviewedFirstLine({ objections: 0, notes: 0, answers: 0, agreed: 7 })).toBe(
      '✅ Reviewed from G2: all 7 agreed',
    );
    expect(summaryText({ objections: 0, notes: 0, answers: 0, agreed: 7 })).toBe(
      '✅ Sent to the agent from your G2: all 7 agreed',
    );
  });

  it('writes note bodies without repeating the quoted sentence', () => {
    expect(noteReplyText(notes[0] as Note)).toBe('❌ Your change: Migrate existing sessions instead.');
    expect(noteReplyText(notes[1] as Note)).toBe('📝 Your note: Use a request queue, not a mutex.');
    expect(noteReplyText(notes[2] as Note)).toBe('💬 Your answer: Stay on 6 for now');
  });

  it('renders a reviewed card without the review footer', () => {
    expect(
      renderCard({
        firstLine: '✅ Reviewed from G2: 1 change sent',
        titleLine: 'auth-refresh-fix · pinpoint',
        points: ['1. One', '2. ⚠️ Two'],
      }),
    ).toBe('✅ Reviewed from G2: 1 change sent\nauth-refresh-fix · pinpoint\n\n1. One\n2. ⚠️ Two');
  });
});

describe('dry-run notifier flow', () => {
  it('posts the legend, a notifying card, silent full text, quote replies, summary and status edits', async () => {
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
    await notifier.start();
    await notifier.onAttention(thread, source, deck);

    const state = await readState(dataDir);
    const record = state.topics['thread-abc'];
    expect(record).toBeDefined();
    expect(record.topicId).toBeGreaterThan(0);
    expect(record.headerMessageId).toBeGreaterThan(0);
    expect(record.status).toBe('needs');
    expect(record.parts.length).toBeGreaterThan(1);
    expect(record.parts[0].plain.length).toBeLessThanOrEqual(4000);
    expect(state.generalMessageId).toBeGreaterThan(0);

    const log = await readLog(dataDir);
    expect(log[0]?.method).toBe('sendMessage');
    expect(log[0]?.params).toMatchObject({
      chat_id: '-1001234567890',
      text: LEGEND_TEXT,
      disable_notification: true,
    });
    expect(log[0]?.params.message_thread_id).toBeUndefined();
    expect(log[1]?.method).toBe('pinChatMessage');
    expect(log[1]?.params).toMatchObject({
      chat_id: '-1001234567890',
      message_id: state.generalMessageId,
      disable_notification: true,
    });

    const created = log.find((entry) => entry.method === 'createForumTopic');
    expect(created?.params.name).toBe('auth-refresh-fix');
    expect(created?.params.icon_custom_emoji_id).toBe('1001');

    const cardSend = log.find(
      (entry) => entry.method === 'sendMessage' && entry.params.reply_markup !== undefined,
    );
    expect(cardSend?.params.message_thread_id).toBe(record.topicId);
    expect(cardSend?.params.text).toBe(CARD_NEEDS);
    expect(cardSend?.params.disable_notification).toBeUndefined();
    expect(cardSend?.params.reply_markup.inline_keyboard).toEqual([
      [{ text: '✅ Agree all', callback_data: 'agree:thread-abc' }],
    ]);
    const unpin = log.find((entry) => entry.method === 'unpinChatMessage');
    expect(unpin?.params.message_id).toBe(record.headerMessageId);

    const sourceSends = log.filter(
      (entry) => entry.method === 'sendMessage' && entry.params.parse_mode === 'HTML',
    );
    expect(sourceSends).toHaveLength(record.parts.length);
    expect(sourceSends.every((entry) => entry.params.disable_notification === true)).toBe(true);
    expect(sourceSends[0]?.params.text.startsWith("🤖 Agent's plan, full text\n\n")).toBe(true);
    expect(sourceSends[0]?.params.text).toContain('<blockquote expandable>');
    expect(sourceSends.map((entry) => entry.params.text).join('\n')).toContain('<pre><code');
    expect(sourceSends[1]?.params.text.startsWith('<blockquote expandable>')).toBe(true);

    const keyboardEdit = log.find((entry) => entry.method === 'editMessageReplyMarkup');
    expect(keyboardEdit?.params.message_id).toBe(record.headerMessageId);
    const readPlan = keyboardEdit?.params.reply_markup.inline_keyboard
      .flat()
      .find((button: { text: string }) => button.text === '📄 Read full plan');
    expect(readPlan?.url).toBe(messageLink('-1001234567890', record.parts[0].messageId, record.topicId));

    const review = await notifier.onReviewSent(thread, deck, draft, composed);
    const stateAfterReview = await readState(dataDir);
    const reviewRecord = stateAfterReview.topics['thread-abc'];
    expect(reviewRecord.status).toBe('done');
    expect(reviewRecord.summaryMessageId).toBeGreaterThan(0);
    expect(reviewRecord.reviewedAt).toBeTruthy();
    expect(review.link).toBe(
      messageLink('-1001234567890', reviewRecord.summaryMessageId, record.topicId),
    );
    expect(review.messages?.map((entry) => entry.kind)).toEqual([
      'card',
      'note',
      'note',
      'note',
      'summary',
    ]);

    const afterReview = await readLog(dataDir);
    const quoteReplies = afterReview.filter(
      (entry) => entry.method === 'sendMessage' && entry.params.reply_parameters?.quote !== undefined,
    );
    expect(quoteReplies).toHaveLength(3);
    expect(quoteReplies.map((entry) => entry.params.text)).toEqual([
      '❌ Your change: Migrate existing sessions instead.',
      '📝 Your note: Use a request queue, not a mutex.',
      '💬 Your answer: Stay on 6 for now',
    ]);
    expect(quoteReplies.every((entry) => entry.params.disable_notification === true)).toBe(true);
    for (const entry of quoteReplies) {
      expect(entry.params.text).not.toContain('"');
      const quote = String(entry.params.reply_parameters.quote);
      const target = record.parts.find(
        (part: { messageId: number }) => part.messageId === entry.params.reply_parameters.message_id,
      );
      expect(target).toBeDefined();
      expect(target.plain.includes(quote)).toBe(true);
    }

    const summarySend = afterReview.find(
      (entry) =>
        entry.method === 'sendMessage' &&
        entry.params.text ===
          '✅ Sent to the agent from your G2: 1 change, 1 note, 1 answer, 4 agreed',
    );
    expect(summarySend?.params.disable_notification).toBe(true);
    expect(summarySend?.params.message_thread_id).toBe(record.topicId);

    const cardEdit = afterReview.find(
      (entry) =>
        entry.method === 'editMessageText' &&
        entry.params.message_id === record.headerMessageId &&
        entry.params.text.startsWith('✅ Reviewed from G2'),
    );
    expect(cardEdit?.params.text).toBe(CARD_REVIEWED);
    const emptyMarkup = afterReview.find(
      (entry) =>
        entry.method === 'editMessageReplyMarkup' &&
        entry.params.message_id === record.headerMessageId &&
        entry.params.reply_markup.inline_keyboard.length === 0,
    );
    expect(emptyMarkup).toBeDefined();

    const doneTopic = afterReview
      .filter((entry) => entry.method === 'editForumTopic')
      .at(-1);
    expect(doneTopic?.params).toMatchObject({
      chat_id: '-1001234567890',
      message_thread_id: record.topicId,
      name: 'auth-refresh-fix',
      icon_custom_emoji_id: '1002',
    });

    const point = points[4] as Point;
    const read = await notifier.readOnPhone(thread, deck, point);
    const afterRead = await readLog(dataDir);
    const readSend = afterRead[afterRead.length - 1];
    expect(readSend?.params.text).toBe(
      '📖 Step 5: you opened this from your glasses\n\nexport function refreshToken() {\n  return withMutex(refreshTokenInner);\n}',
    );
    expect(readSend?.params.disable_notification).toBeUndefined();
    const expectedPart = findQuoteMatch(record.parts, point.quote);
    expect(readSend?.params.reply_parameters.message_id).toBe(
      record.parts[expectedPart?.partIndex ?? -1]?.messageId,
    );
    expect(readSend?.params.reply_parameters.quote).toBe(expectedPart?.quote);
    expect(read.link).toBe(
      messageLink('-1001234567890', read.messageId as number, record.topicId),
    );
    expect(agreed).toEqual([]);

    // Only the card and the read-on-phone message notify.
    const all = await readLog(dataDir);
    const notifying = all.filter(
      (entry) => entry.method === 'sendMessage' && entry.params.disable_notification !== true,
    );
    expect(
      notifying.map((entry) =>
        String(entry.params.text).startsWith('🟡 Needs you')
          ? 'card'
          : String(entry.params.text).startsWith('📖')
            ? 'read'
            : 'other',
      ),
    ).toEqual(['card', 'read']);

    // A second start does not duplicate the legend and still logs polling.
    await notifier.start();
    const afterStart = await readLog(dataDir);
    expect(afterStart.filter((entry) => entry.method === 'pinChatMessage')).toHaveLength(1);
    expect(afterStart[afterStart.length - 1]?.method).toBe('getUpdates');
    await notifier.stop();
  });

  it('reuses the topic, card and full text instead of posting twice', async () => {
    const dataDir = await tempDataDir();
    const notifier = createTelegramNotifier({}, {
      dataDir,
      onAgreeAll: async () => undefined,
      sleep: async () => undefined,
    });

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
    expect(log.filter((entry) => entry.method === 'createForumTopic')).toHaveLength(1);
    expect(
      log.filter((entry) => entry.method === 'sendMessage' && entry.params.reply_markup !== undefined),
    ).toHaveLength(1);
    expect(
      log.filter((entry) => entry.method === 'sendMessage' && entry.params.parse_mode === 'HTML'),
    ).toHaveLength(first.topics['thread-abc'].parts.length);
    expect(log.length).toBeGreaterThan(sends);
  });

  it('keeps the long full text quote-safe and quotable inside the expandable block', async () => {
    const dataDir = await tempDataDir();
    const notifier = createTelegramNotifier({}, { dataDir, onAgreeAll: async () => undefined });
    await notifier.onAttention(thread, source, deck);
    const state = await readState(dataDir);
    const record = state.topics['thread-abc'];
    for (const point of points) {
      const match = findQuoteMatch(record.parts, point.quote);
      expect(match, point.id).toBeDefined();
      const target = record.parts[match?.partIndex ?? -1];
      expect(target.plain.includes(match?.quote ?? '')).toBe(true);
      expect(target.plain.includes('**')).toBe(false);
    }
  });

  it('falls back to prefixed topic names when Telegram refuses custom icons', async () => {
    const dataDir = await tempDataDir();
    const calls: Array<{ method: string; params: Record<string, any> }> = [];
    let messageId = 700;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const method = String(url).split('/').pop() ?? '';
      const params = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
      calls.push({ method, params });
      if (method === 'getForumTopicIconStickers') {
        return jsonResponse({
          ok: true,
          result: [
            { emoji: '❗️', custom_emoji_id: '1001' },
            { emoji: '✅', custom_emoji_id: '1002' },
            { emoji: '‼️', custom_emoji_id: '1003' },
          ],
        });
      }
      if (method === 'createForumTopic' && params.icon_custom_emoji_id) {
        return jsonResponse(
          { ok: false, error_code: 400, description: 'Bad Request: CUSTOM_EMOJI_INVALID' },
          400,
        );
      }
      if (method === 'createForumTopic') {
        return jsonResponse({ ok: true, result: { message_thread_id: 77 } });
      }
      messageId += 1;
      return jsonResponse({ ok: true, result: { message_id: messageId } });
    }) as unknown as typeof fetch;

    const notifier = createTelegramNotifier(
      { TELEGRAM_BOT_TOKEN: 'not-a-real-token', TELEGRAM_CHAT_ID: '-1001112223334' },
      { dataDir, onAgreeAll: async () => undefined, fetchImpl, minIntervalMs: 0 },
    );
    await notifier.onAttention(thread, source, deck);

    const creates = calls.filter((call) => call.method === 'createForumTopic');
    expect(creates).toHaveLength(2);
    expect(creates[0]?.params.icon_custom_emoji_id).toBe('1001');
    expect(creates[1]?.params.icon_custom_emoji_id).toBeUndefined();
    expect(creates[1]?.params.name).toBe('🟡 auth-refresh-fix');
    expect(calls.some((call) => call.method === 'getForumTopicIconStickers')).toBe(true);
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

  it('retries a dropped connection instead of losing the message', async () => {
    const dataDir = await tempDataDir();
    const sleeps: number[] = [];
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('fetch failed');
      return jsonResponse({ ok: true, result: { message_id: 777 } });
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
    expect(result.message_id).toBe(777);
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
      if (method === 'getForumTopicIconStickers') {
        return jsonResponse({ ok: true, result: [] });
      }
      if (method === 'sendMessage' && params.reply_parameters?.quote !== undefined) {
        return jsonResponse(
          { ok: false, error_code: 400, description: 'Bad Request: QUOTE_TEXT_INVALID' },
          400,
        );
      }
      if (method === 'editMessageReplyMarkup') {
        // Editing the card after editMessageText may already have removed the keyboard.
        return jsonResponse(
          {
            ok: false,
            error_code: 400,
            description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same',
          },
          400,
        );
      }
      messageId += 1;
      return jsonResponse({ ok: true, result: { message_id: messageId } });
    }) as unknown as typeof fetch;

    const fallbacks: string[] = [];
    const notifier = createTelegramNotifier(
      { TELEGRAM_BOT_TOKEN: 'not-a-real-token', TELEGRAM_CHAT_ID: '-1009876543210' },
      {
        dataDir,
        onAgreeAll: async () => undefined,
        fetchImpl,
        minIntervalMs: 0,
        onQuoteFallback: (info) => fallbacks.push(info.reason),
      },
    );
    expect(notifier.mode).toBe('live');

    const minimalSource = { sourceMessageId: 'src-2', text: 'Step 4: Force-logout every user.' };
    const minimalDeck: Deck = {
      ...deck,
      sourceMessageId: 'src-2',
      points: [{ ...(points[2] as Point), quote: 'Force-logout every user', index: 1 }],
    };
    await notifier.onAttention(thread, minimalSource, minimalDeck);

    const minimalDraft: ReviewDraft = {
      threadId: thread.threadId,
      sourceMessageId: minimalSource.sourceMessageId,
      notes: [{ pointId: 'p3', verdict: 'object', text: 'Migrate instead.' }],
      seen: ['p3'],
      updatedAt: '2026-11-24T01:10:00.000Z',
    };
    await notifier.onReviewSent(
      thread,
      minimalDeck,
      minimalDraft,
      'Review from G2 (Pinpoint) — 1 point\n✗ 1. "Force-logout every user" → Migrate instead.',
    );

    const quoted = calls.filter(
      (call) => call.method === 'sendMessage' && call.params.reply_parameters?.quote !== undefined,
    );
    const fallback = calls.filter(
      (call) =>
        call.method === 'sendMessage' &&
        call.params.reply_parameters !== undefined &&
        call.params.reply_parameters.quote === undefined &&
        call.params.text === '❌ Your change: Migrate instead.',
    );
    expect(quoted).toHaveLength(1);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.params.reply_parameters.message_id).toBe(
      quoted[0]?.params.reply_parameters.message_id,
    );
    expect(fallbacks).toHaveLength(1);
  });

  it('treats TOPIC_NOT_MODIFIED as the wanted topic state, not an error', async () => {
    const dataDir = await tempDataDir();
    const transport = new TelegramTransport({
      token: 'not-a-real-token',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl: (async () =>
        jsonResponse(
          { ok: false, error_code: 400, description: 'Bad Request: TOPIC_NOT_MODIFIED' },
          400,
        )) as unknown as typeof fetch,
      sleep: async () => undefined,
      minIntervalMs: 0,
    });
    const icons: TopicIconResolver = {
      iconId: async () => '1001',
      unsupported: () => false,
      markUnsupported: () => undefined,
    };
    await expect(
      applyTopicStatus(transport, '-100123', { topicId: 41, title: 'login-fix' }, 'needs', icons),
    ).resolves.toBeUndefined();
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
        project: 'pinpoint',
        attention: 'plan',
        status: 'needs',
        pointCount: 7,
        headerMessageId: 55,
        headerText: '🟡 Needs you: plan, 7 steps',
        cardTitleLine: 'auth-refresh-fix · pinpoint',
        cardLines: ['1. One', '2. ⚠️ Two'],
        sourceMessageIds: [],
        parts: [],
        updatedAt: '2026-11-24T01:00:00.000Z',
      };
    });
  };

  it('calls onAgreeAll, answers the callback, marks the card agreed and the topic done', async () => {
    const dataDir = await tempDataDir();
    const calls: Array<{ method: string; params: Record<string, any> }> = [];
    const order: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const method = String(url).split('/').pop() ?? '';
      order.push(method);
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

    await handleCallbackQuery(
      {
        chatId: '-1005550001111',
        transport,
        store,
        onAgreeAll: async (threadId) => {
          order.push(`agree:${threadId}`);
        },
        setTopicStatus: async (record, status) => {
          order.push(`status:${record.threadId}:${status}`);
        },
        nowIso: () => '2026-11-24T02:00:00.000Z',
      },
      { id: 'cb-1', data: 'agree:thread-abc' },
    );

    expect(order).toEqual([
      'agree:thread-abc',
      'answerCallbackQuery',
      'editMessageText',
      'editMessageReplyMarkup',
      'status:thread-abc:done',
    ]);
    expect(calls[0]?.params).toMatchObject({
      callback_query_id: 'cb-1',
      text: 'Agreed — sent to T3',
    });
    expect(calls[1]?.params).toMatchObject({
      chat_id: '-1005550001111',
      message_id: 55,
      text: '✅ Agreed from Telegram\nauth-refresh-fix · pinpoint\n\n1. One\n2. ⚠️ Two',
    });
    expect(calls[2]?.params).toMatchObject({
      chat_id: '-1005550001111',
      message_id: 55,
      reply_markup: { inline_keyboard: [] },
    });

    const state = await store.get();
    expect(state.topics['thread-abc']?.agreedAt).toBe('2026-11-24T02:00:00.000Z');
    expect(state.topics['thread-abc']?.headerText).toBe(
      '✅ Agreed from Telegram\nauth-refresh-fix · pinpoint\n\n1. One\n2. ⚠️ Two',
    );
  });

  it('reports a failure without editing the card when onAgreeAll throws', async () => {
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
        setTopicStatus: async () => undefined,
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

  it('sends a question option through onAnswer on the glasses answer path', async () => {
    const dataDir = await tempDataDir();
    const answers: Array<{ threadId: string; pointId: string; option: string }> = [];
    const calls: Array<{ method: string; params: Record<string, any> }> = [];
    const store = new JsonStateStore(join(dataDir, 'telegram.json'));
    await store.update((state) => {
      state.topics['payment-upgrade'] = {
        threadId: 'payment-upgrade',
        chatId: '-1005550001111',
        topicId: 42,
        title: 'payment-upgrade',
        attention: 'question',
        status: 'needs',
        pointCount: 1,
        headerMessageId: 56,
        headerText: '🟡 Needs you: a question',
        cardTitleLine: 'payment-upgrade · acme-shop',
        cardLines: ['1. Upgrade payments now or after the sale?'],
        answerPointId: 'p1',
        answerOptions: ['Wait until Monday', 'Upgrade now'],
        sourceMessageIds: [],
        parts: [],
        updatedAt: '2026-11-24T01:00:00.000Z',
      };
    });

    const transport = new TelegramTransport({
      token: 'not-a-real-token',
      dryRun: false,
      logPath: join(dataDir, 'unused.log'),
      allocateId: async () => 1,
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        calls.push({
          method: String(url).split('/').pop() ?? '',
          params: JSON.parse(String(init?.body ?? '{}')) as Record<string, any>,
        });
        return jsonResponse({ ok: true, result: true });
      }) as unknown as typeof fetch,
      sleep: async () => undefined,
      minIntervalMs: 0,
    });

    await handleCallbackQuery(
      {
        chatId: '-1005550001111',
        transport,
        store,
        onAgreeAll: async () => undefined,
        onAnswer: async (threadId, pointId, option) => {
          answers.push({ threadId, pointId, option });
        },
        setTopicStatus: async () => undefined,
        nowIso: () => '2026-11-24T02:00:00.000Z',
      },
      { id: 'cb-3', data: 'ans:payment-upgrade:0' },
    );

    expect(answers).toEqual([
      { threadId: 'payment-upgrade', pointId: 'p1', option: 'Wait until Monday' },
    ]);
    expect(calls[0]?.params).toMatchObject({ callback_query_id: 'cb-3', text: 'Answer sent' });
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
      {
        chatId: '-100',
        transport,
        store,
        onAgreeAll: async () => undefined,
        setTopicStatus: async () => undefined,
        nowIso: () => '',
      },
      { id: 'cb-4', data: 'something-else' },
    );
    expect(calls[0]).toMatchObject({ callback_query_id: 'cb-4', text: 'Unknown action' });
  });
});

describe('paragraph extraction for read on phone', () => {
  it('returns the whole blank-line separated block that contains the quote', () => {
    const plain = 'Intro.\n\nStep 4: Sign out every customer once, to clear the broken logins.\n\nOutro.';
    expect(paragraphContaining(plain, 'Sign out every customer once')).toBe(
      'Step 4: Sign out every customer once, to clear the broken logins.',
    );
    expect(paragraphContaining(plain, 'not there')).toBeUndefined();
  });

  it('returns only the list item that contains the quote, without the number', () => {
    const plain = [
      '1. Reproduce the bug with two tabs.',
      '2. Add a failing test first.',
      '4. Sign out every customer once, to clear the broken logins. Some logins are already bad.',
      '5. Keep the 30-day sign-in.',
    ].join('\n');
    expect(paragraphContaining(plain, 'Sign out every customer once')).toBe(
      'Sign out every customer once, to clear the broken logins. Some logins are already bad.',
    );
  });
});

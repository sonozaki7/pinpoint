import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  Deck,
  Note,
  Point,
  Receipt,
  ReviewDraft,
  ThreadAttention,
} from '../../../shared/contract.js';
import type { AppId } from '../../../shared/contract.js';
import { DeckStore } from '../src/core/decks.js';
import { readEnv } from '../src/core/env.js';
import { FakeTelegramNotifier, FakeT3Client } from '../src/core/fakes.js';
import { InboxService } from '../src/core/inbox.js';
import { ReviewStore } from '../src/core/reviews.js';
import { PinpointService } from '../src/core/service.js';
import { createNaiveSplitter } from '../src/core/splitter/index.js';
import type { AttentionSource, AttentionThread, TelegramNotifier } from '../src/core/types.js';
import { notionReceipt } from '../src/sources/receipts.js';
import type { ReviewSource } from '../src/sources/types.js';
import { handleCallbackQuery, type CallbackDeps } from '../src/telegram/callbacks.js';
import { createTelegramNotifier } from '../src/telegram/index.js';
import { JsonStateStore, type TopicRecord } from '../src/telegram/store.js';
import { TelegramTransport } from '../src/telegram/transport.js';
import type { SourceRef, ThreadRef } from '../src/telegram/types.js';
import { cleanupTestContext, makeTestContext, stubVoice } from './helpers.js';

const dataDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pinpoint-telegram-v2-'));
  dataDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const notionSentences = [
  'Pinpoint turns long replies into a short list of points.',
  'Each point quotes the exact line it refers to.',
  'The launch week starts on Monday with design partners.',
  'Available to every customer starting today.',
  'Pricing stays at twelve dollars a month.',
  'Every note is saved with the review.',
];

function pointsFor(sentences: string[], app: AppId): Point[] {
  return sentences.map((sentence, index) => ({
    id: `p${index + 1}`,
    index: index + 1,
    kind: app === 'gmail' ? ('draft' as const) : ('claim' as const),
    glance: sentence.replace(/\.$/, ''),
    quote: sentence,
    ...(index === 1 && app === 'gmail' ? { flag: 'notes say net-45' } : {}),
  }));
}

function notionFixture() {
  const thread: ThreadRef = {
    threadId: 'notion:page-1',
    title: 'Launch post: Pinpoint 1.0',
    project: 'Notion',
    attention: 'report' as ThreadAttention,
    app: 'notion',
  };
  const source: SourceRef = {
    sourceMessageId: 'notion-launch-1',
    text: notionSentences.join('\n\n'),
    app: 'notion',
    target: { name: 'Launch post', link: 'https://www.notion.so/pinpoint-launch-post' },
  };
  const deck: Deck = {
    threadId: thread.threadId,
    sourceMessageId: source.sourceMessageId,
    title: thread.title,
    attention: 'report',
    headline: 'Launch post: 6 points',
    points: pointsFor(notionSentences, 'notion'),
    createdAt: '2026-11-27T09:05:04.000Z',
    splitter: 'fixture',
  };
  return { thread, source, deck };
}

const gmailSentences = [
  'Thanks for sending the revised contract over.',
  "We're happy to agree to net-60 payment terms.",
  'Our finance team can start invoicing from Monday.',
  "I'll ask legal to narrow clause 12.",
  'The delivery date in clause 9 works.',
  'We can have the signed copy back by Friday.',
];

function gmailFixture() {
  const thread: ThreadRef = {
    threadId: 'gmail:draft-1',
    title: 'Draft reply to Priya: contract terms',
    project: 'Gmail',
    attention: 'report' as ThreadAttention,
    app: 'gmail',
  };
  const source: SourceRef = {
    sourceMessageId: 'gmail-draft-1',
    text: gmailSentences.join(' '),
    app: 'gmail',
    target: {
      name: 'Priya',
      recipient: 'Priya',
      subject: 'Re: Acme contract - net-45 terms',
      link: 'https://mail.google.com/mail/u/0/#drafts/pinpoint-draft-priya',
    },
  };
  const deck: Deck = {
    threadId: thread.threadId,
    sourceMessageId: source.sourceMessageId,
    title: thread.title,
    attention: 'report',
    headline: 'Draft to Priya: 6 lines',
    points: pointsFor(gmailSentences, 'gmail'),
    createdAt: '2026-11-27T09:12:03.000Z',
    splitter: 'fixture',
  };
  return { thread, source, deck };
}

const agentThread: ThreadRef = {
  threadId: 'thread-abc',
  title: 'auth-refresh-fix',
  project: 'pinpoint',
  attention: 'plan',
};
const agentSource: SourceRef = {
  sourceMessageId: 'msg-1',
  text: [
    'Intro paragraph about the fix.',
    'Step 4: Force-logout every user by truncating the sessions table.',
    'Section three explains the retry path.',
  ].join('\n\n'),
};
const agentDeck: Deck = {
  threadId: agentThread.threadId,
  sourceMessageId: agentSource.sourceMessageId,
  title: agentThread.title,
  attention: 'plan',
  headline: '3 steps',
  points: [
    {
      id: 'p1',
      index: 1,
      kind: 'claim',
      glance: 'Intro explains the fix',
      quote: 'Intro paragraph about the fix.',
    },
    {
      id: 'p2',
      index: 2,
      kind: 'step',
      glance: 'Word the sessions step',
      quote: 'truncating the sessions table',
    },
    {
      id: 'p3',
      index: 3,
      kind: 'step',
      glance: 'Keep the retry path',
      quote: 'Section three explains the retry path.',
    },
  ],
  createdAt: '2026-11-24T01:00:00.000Z',
  splitter: 'fixture',
};

function draftWith(threadId: string, sourceMessageId: string, notes: Note[]): ReviewDraft {
  return {
    threadId,
    sourceMessageId,
    notes,
    seen: notes.map((note) => note.pointId),
    updatedAt: '2026-11-27T10:00:00.000Z',
  };
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

describe('source cards', () => {
  it('writes the Notion card with the page title, points and Approve/Read buttons', async () => {
    const dataDir = await tempDataDir();
    const { thread, source, deck } = notionFixture();
    const notifier = createTelegramNotifier(
      {},
      {
        dataDir,
        onAgreeAll: async () => undefined,
        onApprove: async () => undefined,
        sleep: async () => undefined,
      },
    );

    await notifier.onAttention(thread, source, deck);
    const log = await readLog(dataDir);
    const card = log.find(
      (entry) => entry.method === 'sendMessage' && entry.params.reply_markup !== undefined,
    );

    expect(card?.params.text).toBe(
      [
        '🟡 Needs you: Notion page, 6 points',
        'Launch post: Pinpoint 1.0',
        '',
        '1. Pinpoint turns long replies into a short list of points',
        '2. Each point quotes the exact line it refers to',
        '3. The launch week starts on Monday with design partners',
        '4. Available to every customer starting today',
        '5. Pricing stays at twelve dollars a month',
        '6. Every note is saved with the review',
        '',
        'Approve it on your G2, or:',
      ].join('\n'),
    );
    expect(card?.params.reply_markup.inline_keyboard).toEqual([
      [
        { text: '✅ Approve', callback_data: 'approve:notion:page-1' },
        { text: '📄 Read page', url: 'https://www.notion.so/pinpoint-launch-post' },
      ],
    ]);
    expect(card?.params.disable_notification).toBeUndefined();
    const fullText = log.find(
      (entry) => entry.method === 'sendMessage' && entry.params.parse_mode === 'HTML',
    );
    expect(String(fullText?.params.text).startsWith('📄 Notion page, full text')).toBe(true);

    const state = await readState(dataDir);
    expect(state.topics['notion:page-1']).toMatchObject({
      app: 'notion',
      status: 'needs',
      recipient: 'Launch post',
      targetLink: 'https://www.notion.so/pinpoint-launch-post',
    });
  });

  it('writes the Gmail card with the recipient, flagged lines and Read/Send buttons', async () => {
    const dataDir = await tempDataDir();
    const { thread, source, deck } = gmailFixture();
    const notifier = createTelegramNotifier(
      {},
      {
        dataDir,
        onAgreeAll: async () => undefined,
        onSend: async () => undefined,
        sleep: async () => undefined,
      },
    );

    await notifier.onAttention(thread, source, deck);
    const log = await readLog(dataDir);
    const card = log.find(
      (entry) => entry.method === 'sendMessage' && entry.params.reply_markup !== undefined,
    );
    const text = String(card?.params.text);
    expect(text.split('\n')[0]).toBe('🟡 Needs you: draft to Priya, 6 lines');
    expect(text.split('\n')[1]).toBe('Re: Acme contract - net-45 terms');
    expect(text).toContain("2. ⚠️ We're happy to agree to net-60 payment terms");
    expect(text).toContain('Send it from your G2, or:');
    expect(card?.params.reply_markup.inline_keyboard).toEqual([
      [
        {
          text: '📄 Read draft',
          url: 'https://mail.google.com/mail/u/0/#drafts/pinpoint-draft-priya',
        },
        { text: '✉️ Send as written', callback_data: 'mail:gmail:draft-1' },
      ],
    ]);
    expect(card?.params.disable_notification).toBeUndefined();
    const fullText = log.find(
      (entry) => entry.method === 'sendMessage' && entry.params.parse_mode === 'HTML',
    );
    expect(String(fullText?.params.text).startsWith('✉️ Draft, full text')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Callbacks                                                                  */
/* -------------------------------------------------------------------------- */

function makeTransport(dataDir: string, calls: LogEntry[]) {
  return new TelegramTransport({
    token: 'not-a-real-token',
    dryRun: false,
    logPath: join(dataDir, 'unused.log'),
    allocateId: async () => 1,
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      const method = String(url).split('/').pop() ?? '';
      const params = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
      calls.push({ at: '', method, params });
      return jsonResponse({
        ok: true,
        result: method === 'sendMessage' ? { message_id: 901 } : true,
      });
    }) as unknown as typeof fetch,
    sleep: async () => undefined,
    minIntervalMs: 0,
  });
}

async function seedTopic(dataDir: string, record: Partial<TopicRecord>): Promise<JsonStateStore> {
  const store = new JsonStateStore(join(dataDir, 'telegram.json'));
  await store.update((state) => {
    state.topics['gmail:draft-1'] = {
      threadId: 'gmail:draft-1',
      chatId: '-1005550001111',
      topicId: 42,
      title: 'Draft reply to Priya: contract terms',
      attention: 'report',
      status: 'needs',
      pointCount: 6,
      headerMessageId: 56,
      headerText: '🟡 Needs you: draft to Priya, 6 lines',
      cardTitleLine: 'Re: Acme contract - net-45 terms',
      cardLines: ['1. One', '2. ⚠️ Two'],
      app: 'gmail',
      recipient: 'Priya',
      sourceMessageIds: [],
      parts: [],
      updatedAt: '2026-11-27T09:00:00.000Z',
      ...record,
    };
  });
  return store;
}

describe('Telegram callbacks', () => {
  it('answers a question, rewrites the card and marks the topic done', async () => {
    const dataDir = await tempDataDir();
    const store = await seedTopic(dataDir, {
      threadId: 'payment-upgrade',
      title: 'payment-upgrade',
      attention: 'question',
      pointCount: 1,
      headerMessageId: 66,
      headerText: '🟡 Needs you: a question',
      cardTitleLine: 'payment-upgrade · acme-shop',
      cardLines: ['1. Upgrade payments now or after the sale?'],
      app: 't3',
      answerPointId: 'p1',
      answerOptions: ['Wait until Monday', 'Upgrade now'],
    });
    // Move the seeded record to the question thread id.
    await store.update((state) => {
      state.topics['payment-upgrade'] = state.topics['gmail:draft-1']!;
      state.topics['payment-upgrade']!.threadId = 'payment-upgrade';
      delete state.topics['gmail:draft-1'];
    });

    const calls: LogEntry[] = [];
    const transport = makeTransport(dataDir, calls);
    const answers: Array<{ threadId: string; pointId: string; option: string }> = [];
    const statuses: string[] = [];
    await handleCallbackQuery(
      {
        chatId: '-1005550001111',
        transport,
        store,
        onAgreeAll: async () => undefined,
        onAnswer: async (threadId, pointId, option) => {
          answers.push({ threadId, pointId, option });
        },
        setTopicStatus: async (record, status) => {
          statuses.push(`${record.threadId}:${status}`);
        },
        nowIso: () => '2026-11-27T10:00:00.000Z',
      },
      { id: 'cb-answer', data: 'ans:payment-upgrade:0' },
    );

    expect(answers).toEqual([
      { threadId: 'payment-upgrade', pointId: 'p1', option: 'Wait until Monday' },
    ]);
    expect(statuses).toEqual(['payment-upgrade:done']);
    const cardEdit = calls.find((call) => call.method === 'editMessageText');
    expect(cardEdit?.params.text).toBe(
      [
        '✅ Answered from Telegram: Wait until Monday',
        'payment-upgrade · acme-shop',
        '',
        '1. Upgrade payments now or after the sale?',
      ].join('\n'),
    );
    const markup = calls.find((call) => call.method === 'editMessageReplyMarkup');
    expect(markup?.params.reply_markup).toEqual({ inline_keyboard: [] });
    expect(calls[0]?.params).toMatchObject({ callback_query_id: 'cb-answer', text: 'Answer sent' });
  });

  it('calls the Notion approve hook from the Approve button', async () => {
    const dataDir = await tempDataDir();
    const store = await seedTopic(dataDir, {
      threadId: 'notion:page-1',
      app: 'notion',
      recipient: 'Launch post',
    });
    await store.update((state) => {
      state.topics['notion:page-1'] = state.topics['gmail:draft-1']!;
      state.topics['notion:page-1']!.threadId = 'notion:page-1';
      delete state.topics['gmail:draft-1'];
    });
    const calls: LogEntry[] = [];
    const approved: string[] = [];
    await handleCallbackQuery(
      {
        chatId: '-1005550001111',
        transport: makeTransport(dataDir, calls),
        store,
        onAgreeAll: async () => undefined,
        onApprove: async (threadId) => {
          approved.push(threadId);
        },
        setTopicStatus: async () => undefined,
        nowIso: () => '2026-11-27T10:00:00.000Z',
      },
      { id: 'cb-approve', data: 'approve:notion:page-1' },
    );
    expect(approved).toEqual(['notion:page-1']);
    expect(calls[0]?.method).toBe('answerCallbackQuery');
    expect(calls[0]?.params).toMatchObject({ text: 'Approved' });
  });

  it('asks on the phone before a Gmail draft is sent, and Cancel sends nothing', async () => {
    const dataDir = await tempDataDir();
    const store = await seedTopic(dataDir, {});
    const calls: LogEntry[] = [];
    let sends = 0;
    const deps: CallbackDeps = {
      chatId: '-1005550001111',
      transport: makeTransport(dataDir, calls),
      store,
      onAgreeAll: async () => undefined,
      onSend: async () => {
        sends += 1;
      },
      setTopicStatus: async () => undefined,
      nowIso: () => '2026-11-27T10:00:00.000Z',
    };

    await handleCallbackQuery(deps, { id: 'cb-mail', data: 'mail:gmail:draft-1' });
    const confirm = calls.find((call) => call.method === 'sendMessage');
    expect(confirm?.params.text).toBe('Send to Priya as written?');
    expect(confirm?.params.disable_notification).toBe(true);
    expect(confirm?.params.reply_markup.inline_keyboard).toEqual([
      [
        { text: 'Send', callback_data: 'mailsend:gmail:draft-1' },
        { text: 'Cancel', callback_data: 'mailcancel:gmail:draft-1' },
      ],
    ]);
    expect((await store.get()).topics['gmail:draft-1']?.confirmMessageId).toBe(901);

    await handleCallbackQuery(deps, { id: 'cb-cancel', data: 'mailcancel:gmail:draft-1' });
    expect(sends).toBe(0);
    const cancelled = calls.filter((call) => call.method === 'editMessageText').at(-1);
    expect(cancelled?.params.text).toBe('Cancelled — nothing sent.');
    const cancelledMarkup = calls.filter((call) => call.method === 'editMessageReplyMarkup').at(-1);
    expect(cancelledMarkup?.params.reply_markup).toEqual({ inline_keyboard: [] });
    expect((await store.get()).topics['gmail:draft-1']?.confirmMessageId).toBeUndefined();
  });

  it('sends the draft only after Send is tapped on the confirmation', async () => {
    const dataDir = await tempDataDir();
    const store = await seedTopic(dataDir, { confirmMessageId: 900 });
    const calls: LogEntry[] = [];
    let sends = 0;
    const deps: CallbackDeps = {
      chatId: '-1005550001111',
      transport: makeTransport(dataDir, calls),
      store,
      onAgreeAll: async () => undefined,
      onSend: async () => {
        sends += 1;
      },
      setTopicStatus: async () => undefined,
      nowIso: () => '2026-11-27T10:00:00.000Z',
    };

    await handleCallbackQuery(deps, { id: 'cb-send', data: 'mailsend:gmail:draft-1' });
    expect(sends).toBe(1);
    expect(calls[0]?.params).toMatchObject({ callback_query_id: 'cb-send', text: 'Sent' });
    const edited = calls.find((call) => call.method === 'editMessageText');
    expect(edited?.params).toMatchObject({
      message_id: 900,
      text: '✅ Sent to Priya as written.',
    });
    expect((await store.get()).topics['gmail:draft-1']?.confirmMessageId).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Receipts                                                                   */
/* -------------------------------------------------------------------------- */

describe('receipts', () => {
  it('posts the Gmail receipt with its link and shows the change count on the card', async () => {
    const dataDir = await tempDataDir();
    const { thread, source, deck } = gmailFixture();
    const notifier = createTelegramNotifier({}, { dataDir, onAgreeAll: async () => undefined });
    await notifier.onAttention(thread, source, deck);

    const note: Note = {
      pointId: 'p2',
      verdict: 'note',
      text: 'Net-45, not net-60.',
      after: "We're happy to agree to net-45 payment terms.",
    };
    const draft = draftWith(thread.threadId, source.sourceMessageId, [note]);
    const receipt: Receipt = {
      lines: [
        {
          app: 'gmail',
          text: 'Sent to Priya',
          ok: true,
          link: 'https://mail.google.com/mail/u/0/#sent/pinpoint-1',
        },
      ],
    };
    const result = await notifier.onReviewSent(thread, deck, draft, 'review', receipt);
    expect(result.firstLine).toBe('✅ Sent to Priya: 1 change');

    const log = await readLog(dataDir);
    const quoteReply = log.find(
      (entry) => entry.method === 'sendMessage' && entry.params.reply_parameters?.quote !== undefined,
    );
    expect(quoteReply?.params.text).toBe(
      "✏️ Changed to: We're happy to agree to net-45 payment terms.",
    );

    const receiptSend = log.find(
      (entry) =>
        entry.method === 'sendMessage' &&
        typeof entry.params.text === 'string' &&
        entry.params.text.startsWith('📍 Where it landed'),
    );
    expect(receiptSend?.params.disable_notification).toBe(true);
    expect(receiptSend?.params.parse_mode).toBe('HTML');
    expect(receiptSend?.params.text).toContain(
      '<a href="https://mail.google.com/mail/u/0/#sent/pinpoint-1">Sent to Priya</a>',
    );

    const summary = log.find(
      (entry) =>
        entry.method === 'sendMessage' &&
        String(entry.params.text).startsWith('✅ Sent the draft from your G2'),
    );
    expect(summary?.params.text).toBe(
      '✅ Sent the draft from your G2: 1 change, 5 agreed',
    );

    const stateAfter = await readState(dataDir);
    const headerId = stateAfter.topics[thread.threadId].headerMessageId;
    const cardEdit = log.find(
      (entry) => entry.method === 'editMessageText' && entry.params.message_id === headerId,
    );
    expect(String(cardEdit?.params.text).split('\n')[0]).toBe('✅ Sent to Priya: 1 change');
  });

  it('shows the Notion comment count and Approved status from the receipt', async () => {
    const dataDir = await tempDataDir();
    const { thread, source, deck } = notionFixture();
    const notifier = createTelegramNotifier({}, { dataDir, onAgreeAll: async () => undefined });
    await notifier.onAttention(thread, source, deck);

    const note: Note = {
      pointId: 'p4',
      verdict: 'note',
      text: 'Check the rollout date before this goes out.',
    };
    const reviewed = draftWith(thread.threadId, source.sourceMessageId, [note]);
    const reviewedReceipt: Receipt = {
      lines: [
        {
          app: 'notion',
          text: '1 comment on Launch post',
          ok: true,
          link: 'https://www.notion.so/pinpoint-launch-post',
        },
        {
          app: 'notion',
          text: 'Status: Changes requested',
          ok: true,
          link: 'https://www.notion.so/pinpoint-launch-post',
        },
      ],
    };
    const first = await notifier.onReviewSent(thread, deck, reviewed, 'review', reviewedReceipt);
    expect(first.firstLine).toBe('✅ 1 comment on Launch post');

    const approved = await notifier.onReviewSent(
      thread,
      deck,
      draftWith(thread.threadId, source.sourceMessageId, []),
      'review',
      {
        lines: [
          {
            app: 'notion',
            text: '0 comments on Launch post',
            ok: true,
            link: 'https://www.notion.so/pinpoint-launch-post',
          },
          { app: 'notion', text: 'Status: Approved', ok: true },
        ],
      },
    );
    expect(approved.firstLine).toBe('✅ Approved: Launch post');

    const log = await readLog(dataDir);
    const receiptSends = log.filter(
      (entry) =>
        entry.method === 'sendMessage' &&
        typeof entry.params.text === 'string' &&
        entry.params.text.startsWith('📍 Where it landed'),
    );
    expect(receiptSends).toHaveLength(2);
    expect(receiptSends[0]?.params.text).toContain(
      '<a href="https://www.notion.so/pinpoint-launch-post">1 comment on Launch post</a>',
    );
    expect(receiptSends[1]?.params.text).toContain('Status: Approved');
  });
});

/* -------------------------------------------------------------------------- */
/* Agent replies                                                              */
/* -------------------------------------------------------------------------- */

describe('agent replied', () => {
  it('posts one silent agent reply, records it and turns the topic back to needs-you', async () => {
    const dataDir = await tempDataDir();
    const notifier = createTelegramNotifier({}, { dataDir, onAgreeAll: async () => undefined });
    await notifier.onAttention(agentThread, agentSource, agentDeck);
    await notifier.onReviewSent(
      agentThread,
      agentDeck,
      draftWith(agentThread.threadId, agentSource.sourceMessageId, [
        { pointId: 'p2', verdict: 'object', text: 'Migrate sessions instead.' },
      ]),
      'review',
    );
    const before = await readState(dataDir);
    expect(before.topics[agentThread.threadId].status).toBe('done');
    const reviewedAt = before.topics[agentThread.threadId].reviewedAt;
    expect(reviewedAt).toBeTruthy();

    const longReply = `Fixed the migration.\n\n${'The agent explains the change in ordinary sentences. '.repeat(20)}`;
    const handled = await notifier.onAgentReply(agentThread, {
      sourceMessageId: 'msg-2',
      text: longReply,
    });
    expect(handled).toBe(true);

    const log = await readLog(dataDir);
    const replySend = log.filter((entry) => entry.method === 'sendMessage').at(-1);
    expect(replySend?.params.disable_notification).toBe(true);
    expect(replySend?.params.parse_mode).toBe('HTML');
    expect(String(replySend?.params.text).startsWith('🤖 Agent replied\n\n<blockquote expandable>')).toBe(
      true,
    );

    const after = await readState(dataDir);
    expect(after.topics[agentThread.threadId].status).toBe('needs');
    expect(after.topics[agentThread.threadId].sourceMessageId).toBe('msg-2');
    expect(after.topics[agentThread.threadId].parts[0].plain.startsWith('🤖 Agent replied')).toBe(true);

    // The same message is not posted twice.
    expect(
      await notifier.onAgentReply(agentThread, { sourceMessageId: 'msg-2', text: longReply }),
    ).toBe(false);
  });

  it('leaves the topic done when the new message does not need you', async () => {
    const dataDir = await tempDataDir();
    const notifier = createTelegramNotifier({}, { dataDir, onAgreeAll: async () => undefined });
    await notifier.onAttention(agentThread, agentSource, agentDeck);
    await notifier.onReviewSent(
      agentThread,
      agentDeck,
      draftWith(agentThread.threadId, agentSource.sourceMessageId, []),
      'review',
    );

    const handled = await notifier.onAgentReply(
      agentThread,
      { sourceMessageId: 'msg-2', text: 'Still working on it.' },
      { needsYou: false },
    );
    expect(handled).toBe(true);
    const state = await readState(dataDir);
    expect(state.topics[agentThread.threadId].status).toBe('done');
    expect(state.topics[agentThread.threadId].sourceMessageId).toBe('msg-2');
  });

  it('ignores a page or draft (only agents reply)', async () => {
    const dataDir = await tempDataDir();
    const { thread, source, deck } = notionFixture();
    const notifier = createTelegramNotifier({}, { dataDir, onAgreeAll: async () => undefined });
    await notifier.onAttention(thread, source, deck);
    await notifier.onReviewSent(
      thread,
      deck,
      draftWith(thread.threadId, source.sourceMessageId, []),
      'review',
      { lines: [{ app: 'notion', text: '0 comments on Launch post', ok: true }] },
    );
    expect(
      await notifier.onAgentReply(thread, { sourceMessageId: 'notion-2', text: 'changed' }),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Live inbox hook                                                            */
/* -------------------------------------------------------------------------- */

class LiveStubNotifier implements TelegramNotifier {
  readonly mode = 'live' as const;
  readonly attention: string[] = [];
  readonly replies: string[] = [];
  reviews = 0;

  async onAttention(_thread: ThreadRef, source: SourceRef): Promise<void> {
    this.attention.push(source.sourceMessageId);
  }

  async onReviewSent(): Promise<{ link?: string }> {
    this.reviews += 1;
    return {};
  }

  async onAgentReply(_thread: ThreadRef, source: SourceRef): Promise<boolean> {
    if (this.reviews === 0) return false;
    this.replies.push(source.sourceMessageId);
    return true;
  }

  async readOnPhone(): Promise<{ link?: string }> {
    return {};
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

describe('live inbox polling hook', () => {
  it('asks the notifier about an agent reply before posting a fresh card', async () => {
    const dir = await tempDataDir();
    const env = readEnv({
      PINPOINT_MODE: 'live',
      T3_PROJECTS: 'pinpoint',
      PINPOINT_DATA_DIR: dir,
    });
    const notifier = new LiveStubNotifier();
    const inbox = new InboxService({
      env,
      sources: [],
      telegram: notifier,
      splitter: createNaiveSplitter(),
      decks: new DeckStore(dir),
      reviews: new ReviewStore(dir),
    });
    await inbox.init();
    try {
      const first: SourceRef = { sourceMessageId: 'msg-1', text: agentSource.text };
      const second: SourceRef = { sourceMessageId: 'msg-2', text: 'The agent replied again.' };
      await (inbox as unknown as {
        maybeNotify(t: ThreadRef, s: SourceRef, d: Deck): Promise<void>;
      }).maybeNotify(agentThread, first, agentDeck);
      expect(notifier.attention).toEqual(['msg-1']);

      notifier.reviews = 1;
      await (inbox as unknown as {
        maybeNotify(t: ThreadRef, s: SourceRef, d: Deck): Promise<void>;
      }).maybeNotify(agentThread, second, agentDeck);
      expect(notifier.replies).toEqual(['msg-2']);
      // The handled message does not also become a fresh notifying card.
      expect(notifier.attention).toEqual(['msg-1']);
    } finally {
      await inbox.stop();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Server answer hook                                                         */
/* -------------------------------------------------------------------------- */

describe('question answer hook', () => {
  it('answers through the same saved-answer path the glasses use', async () => {
    const context = await makeTestContext();
    try {
      await context.service.answer('deps-upgrade', 'p1', 'Stay on 6 for now');
      expect(context.t3.answered).toEqual([
        {
          threadId: 'deps-upgrade',
          requestId: 'req-vite-7',
          answers: { 'q-vite-7': 'Stay on 6 for now' },
        },
      ]);
      expect(context.telegram.reviewCalls.map((call) => call.threadId)).toContain('deps-upgrade');
      expect((await context.service.getDraft('deps-upgrade')).notes).toEqual([]);
    } finally {
      await cleanupTestContext(context);
    }
  });

  it('approves a Notion page by sending an empty review', async () => {
    const dir = await tempDataDir();
    const env = readEnv({
      PINPOINT_MODE: 'demo',
      SPLITTER_PROVIDER: 'fixture',
      PINPOINT_DATA_DIR: dir,
    });
    const { thread, source, deck } = notionFixture();
    const attentionThread: AttentionThread = {
      threadId: thread.threadId,
      title: thread.title,
      project: 'Notion',
      attention: 'report',
      updatedAt: '2026-11-27T09:05:00.000Z',
      app: 'notion',
    };
    const attentionSource: AttentionSource = { ...source, kind: 'reply' };
    const delivered: ReviewDraft[] = [];
    const reviewSource: ReviewSource = {
      app: 'notion',
      async listAttention() {
        return [attentionThread];
      },
      async getSource() {
        return { source: attentionSource, app: 'notion' };
      },
      async deliver(input) {
        delivered.push(input.draft);
        return {
          delivered: 'notion',
          receipt: notionReceipt({
            comments: input.draft.notes.length,
            failed: 0,
            name: 'Launch post',
            status: input.draft.notes.length > 0 ? 'Changes requested' : 'Approved',
            link: 'https://www.notion.so/pinpoint-launch-post',
          }),
        };
      },
    };
    const telegram = new FakeTelegramNotifier();
    const service = new PinpointService({
      env,
      t3: new FakeT3Client([]),
      t3Live: false,
      telegram,
      splitter: createNaiveSplitter(),
      decks: new DeckStore(dir),
      reviews: new ReviewStore(dir),
      voice: stubVoice,
      precomputed: new Map([[thread.threadId, deck]]),
      sources: [reviewSource],
    });
    await service.start();
    try {
      await service.putDraft(thread.threadId, {
        notes: [{ pointId: 'p1', verdict: 'note', text: 'Saved note' }],
      });
      await service.approve(thread.threadId);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.notes).toEqual([]);
      expect(telegram.reviewCalls.map((call) => call.threadId)).toEqual([thread.threadId]);
    } finally {
      await service.stop();
    }
  });
});

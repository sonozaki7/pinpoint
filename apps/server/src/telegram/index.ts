// Pinpoint Telegram notifier.
//
// One forum topic per thread in one private supergroup with Topics enabled:
//   header  "Needs you · plan · 7 points" + [Agree all & continue]
//   source  the full agent reply as Telegram HTML, split at paragraph boundaries
//   review  the composed review as a reply to the header, each objection/note as a
//           quote-reply on the exact source sentence
// Without TELEGRAM_BOT_TOKEN everything runs in dry-run: every intended Bot API call is
// written as one JSON line to .data/telegram-dryrun.log and fake links are returned.
import { fileURLToPath } from 'node:url';
import { Bot } from 'grammy';
import type { Deck, Point, ReviewDraft, Note } from '../../../../shared/contract.js';
import { AGREE_PREFIX, handleCallbackQuery } from './callbacks.js';
import { headerText, messageLink, pointReplyText, reviewLine, topicName } from './format.js';
import { renderParts, splitPlainText } from './markdown.js';
import { findQuoteMatch } from './quotes.js';
import { JsonStateStore, type StoredPart, type TopicRecord } from './store.js';
import { TelegramApiError, TelegramTransport, type TelegramMessage } from './transport.js';
import type { SourceRef, ThreadRef } from './types.js';

export type { SourceRef, ThreadRef } from './types.js';

export { markdownToHtml, renderParts, splitPlainText } from './markdown.js';
export { findQuoteMatch } from './quotes.js';
export { messageLink } from './format.js';
export { TelegramApiError } from './transport.js';

export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string | undefined;
  TELEGRAM_CHAT_ID?: string | undefined;
  /** Aliases accepted for the server's parsed config object (src/core/env.ts). */
  telegramToken?: string | undefined;
  telegramBotToken?: string | undefined;
  telegramChatId?: string | undefined;
  /** apps/server/.data override; PINPOINT_DATA_DIR wins there. */
  dataDir?: string | undefined;
}

export interface NotifierOptions {
  /** Called when the phone taps "Agree all & continue"; receives the thread id. */
  onAgreeAll(threadId: string): Promise<void>;
  /** Override for tests; defaults to apps/server/.data. */
  dataDir?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum gap between calls in the same chat; default 1000 ms. */
  minIntervalMs?: number;
}

export interface TelegramNotifier {
  mode: 'live' | 'dry-run';
  onAttention(thread: ThreadRef, source: SourceRef, deck: Deck): Promise<void>;
  onReviewSent(
    thread: ThreadRef,
    deck: Deck,
    draft: ReviewDraft,
    composedMessage: string,
  ): Promise<{ link?: string }>;
  readOnPhone(thread: ThreadRef, deck: Deck, point: Point): Promise<{ link?: string }>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const REVIEWED_VERDICTS: ReadonlyArray<Note['verdict']> = ['object', 'note'];

export function createTelegramNotifier(env: TelegramEnv, opts: NotifierOptions): TelegramNotifier {
  const token = pick(env.TELEGRAM_BOT_TOKEN, env.telegramBotToken, env.telegramToken);
  const configuredChatId = pick(env.TELEGRAM_CHAT_ID, env.telegramChatId);
  const dryRun = token.length === 0;
  if (!dryRun && !configuredChatId) {
    throw new Error('TELEGRAM_CHAT_ID is required when TELEGRAM_BOT_TOKEN is set');
  }

  const chatId = configuredChatId || '-1001234567890';
  const envDataDir = typeof env.dataDir === 'string' && env.dataDir.trim() ? env.dataDir.trim() : '';
  const dataDir = opts.dataDir ?? (envDataDir || fileURLToPath(new URL('../../.data/', import.meta.url)));
  const store = new JsonStateStore(`${dataDir}/telegram.json`);
  const clock = opts.now ?? Date.now;
  const nowIso = () => new Date(clock()).toISOString();

  const transport = new TelegramTransport({
    token,
    dryRun,
    logPath: `${dataDir}/telegram-dryrun.log`,
    allocateId: () =>
      store.update((state) => {
        const id = state.fakeNextId;
        state.fakeNextId = id + 1;
        return id;
      }),
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    now: opts.now,
    minIntervalMs: opts.minIntervalMs,
  });

  let bot: Bot | undefined;
  let polling: Promise<void> | undefined;

  function agreeKeyboard(threadId: string): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    const data = `${AGREE_PREFIX}${threadId}`;
    if (Buffer.byteLength(data, 'utf8') > 64) {
      throw new Error(`threadId is too long for Telegram callback_data (max 64 bytes): ${data.length} chars`);
    }
    return { inline_keyboard: [[{ text: 'Agree all & continue', callback_data: data }]] };
  }

  async function saveRecord(
    threadId: string,
    mutate: (record: TopicRecord) => void,
  ): Promise<TopicRecord | undefined> {
    return store.update((state) => {
      const record = state.topics[threadId];
      if (!record) return undefined;
      mutate(record);
      record.updatedAt = nowIso();
      return record;
    });
  }

  async function ensureTopic(thread: ThreadRef): Promise<TopicRecord> {
    const state = await store.get();
    const existing = state.topics[thread.threadId];
    if (existing && existing.topicId) {
      if (existing.title !== thread.title) {
        await transport.call('editForumTopic', {
          chat_id: chatId,
          message_thread_id: existing.topicId,
          name: topicName(thread.title),
        });
        await saveRecord(thread.threadId, (record) => {
          record.title = thread.title;
        });
      }
      return existing;
    }

    const created = await transport.call<{ message_thread_id: number }>('createForumTopic', {
      chat_id: chatId,
      name: topicName(thread.title),
    });
    const record: TopicRecord = {
      threadId: thread.threadId,
      chatId,
      topicId: created.message_thread_id,
      title: thread.title,
      project: thread.project ?? '',
      attention: thread.attention,
      pointCount: 0,
      sourceMessageIds: [],
      parts: [],
      updatedAt: nowIso(),
    };
    await store.update((next) => {
      next.topics[thread.threadId] = { ...record };
    });
    return record;
  }

  async function ensureHeader(thread: ThreadRef, deck: Deck, current: TopicRecord): Promise<TopicRecord> {
    const text = headerText(thread.attention, deck.points.length);
    const keyboard = agreeKeyboard(thread.threadId);

    if (current.headerMessageId === undefined) {
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chatId,
        message_thread_id: current.topicId,
        text,
        reply_markup: keyboard,
      });
      return (
        (await saveRecord(thread.threadId, (record) => {
          record.headerMessageId = sent.message_id;
          record.headerText = text;
          record.attention = thread.attention;
          record.pointCount = deck.points.length;
        })) ?? current
      );
    }

    if (current.headerText !== text || current.agreedAt) {
      await transport.call('editMessageText', {
        chat_id: chatId,
        message_id: current.headerMessageId,
        text,
        reply_markup: keyboard,
      });
      return (
        (await saveRecord(thread.threadId, (record) => {
          record.headerText = text;
          record.attention = thread.attention;
          record.pointCount = deck.points.length;
          delete record.agreedAt;
        })) ?? current
      );
    }

    if (current.pointCount !== deck.points.length || current.attention !== thread.attention) {
      return (
        (await saveRecord(thread.threadId, (record) => {
          record.attention = thread.attention;
          record.pointCount = deck.points.length;
        })) ?? current
      );
    }
    return current;
  }

  async function postSource(current: TopicRecord, source: SourceRef): Promise<TopicRecord> {
    if (current.sourceMessageId === source.sourceMessageId && current.parts.length > 0) {
      return current;
    }

    const parts = renderParts(source.text);
    const posted: StoredPart[] = [];
    for (const part of parts) {
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chatId,
        message_thread_id: current.topicId,
        text: part.html,
        parse_mode: 'HTML',
        disable_notification: true,
        link_preview_options: { is_disabled: true },
      });
      posted.push({ messageId: sent.message_id, plain: part.plain });
      await store.update((state) => {
        const record = state.topics[current.threadId];
        if (!record) return;
        record.parts = [...posted];
        record.sourceMessageIds = posted.map((entry) => entry.messageId);
        record.sourceMessageId = source.sourceMessageId;
        record.updatedAt = nowIso();
      });
    }

    return (await store.get()).topics[current.threadId] ?? current;
  }

  async function sendQuoteReply(
    topicId: number,
    targetMessageId: number,
    quote: string,
    text: string,
  ): Promise<number> {
    try {
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chatId,
        message_thread_id: topicId,
        text,
        reply_parameters: {
          message_id: targetMessageId,
          quote,
          allow_sending_without_reply: true,
        },
      });
      return sent.message_id;
    } catch (error) {
      // Telegram answers 400 QUOTE_TEXT_INVALID (or "quote not found") when the quote is not
      // an exact substring. Retry as a plain reply so the note is never lost.
      if (error instanceof TelegramApiError && error.code === 400 && /quote/i.test(error.description)) {
        const sent = await transport.call<TelegramMessage>('sendMessage', {
          chat_id: chatId,
          message_thread_id: topicId,
          text,
          reply_parameters: { message_id: targetMessageId, allow_sending_without_reply: true },
        });
        return sent.message_id;
      }
      throw error;
    }
  }

  async function sendReply(topicId: number, targetMessageId: number, text: string): Promise<number> {
    const sent = await transport.call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      message_thread_id: topicId,
      text,
      reply_parameters: { message_id: targetMessageId, allow_sending_without_reply: true },
    });
    return sent.message_id;
  }

  async function onAttention(thread: ThreadRef, source: SourceRef, deck: Deck): Promise<void> {
    const topic = await ensureTopic(thread);
    const withHeader = await ensureHeader(thread, deck, topic);
    await postSource(withHeader, source);
    await saveRecord(thread.threadId, (next) => {
      next.title = thread.title;
      next.project = thread.project ?? '';
      next.attention = thread.attention;
      next.pointCount = deck.points.length;
    });
  }

  async function onReviewSent(
    thread: ThreadRef,
    deck: Deck,
    draft: ReviewDraft,
    composedMessage: string,
  ): Promise<{ link?: string }> {
    const topic = await ensureTopic(thread);
    const record = await ensureHeader(thread, deck, topic);

    const reviewChunks = splitPlainText(composedMessage.trim() || '✓ Reviewed on G2. Continue.');
    const reviewMessageIds: number[] = [];
    for (let index = 0; index < reviewChunks.length; index += 1) {
      const chunk = reviewChunks[index] ?? '';
      const replyTo = index === 0 ? record.headerMessageId : undefined;
      const sent =
        replyTo !== undefined
          ? await sendReply(record.topicId, replyTo, chunk)
          : (
              await transport.call<TelegramMessage>('sendMessage', {
                chat_id: chatId,
                message_thread_id: record.topicId,
                text: chunk,
              })
            ).message_id;
      reviewMessageIds.push(sent);
    }
    if (reviewMessageIds.length > 0) {
      await saveRecord(thread.threadId, (next) => {
        next.reviewMessageId = reviewMessageIds[0];
      });
    }

    const quoteTargets = (draft.notes ?? []).filter(
      (note) => REVIEWED_VERDICTS.includes(note.verdict) && Boolean(note.text?.trim()),
    );
    for (const note of quoteTargets) {
      const point = deck.points.find((candidate) => candidate.id === note.pointId);
      if (!point) continue;
      const text = reviewLine(point, note);
      const match = findQuoteMatch(record.parts, point.quote);
      const target = match ? record.parts[match.partIndex] : undefined;
      if (match && target) {
        await sendQuoteReply(record.topicId, target.messageId, match.quote, text);
      } else if (record.headerMessageId !== undefined) {
        await sendReply(record.topicId, record.headerMessageId, text);
      } else {
        await transport.call('sendMessage', {
          chat_id: chatId,
          message_thread_id: record.topicId,
          text,
        });
      }
    }

    const first = reviewMessageIds[0];
    return first === undefined
      ? {}
      : { link: messageLink(chatId, first, record.topicId) };
  }

  async function readOnPhone(thread: ThreadRef, deck: Deck, point: Point): Promise<{ link?: string }> {
    const topic = await ensureTopic(thread);
    const text = pointReplyText(point);
    const match = findQuoteMatch(topic.parts, point.quote);
    const target = match ? topic.parts[match.partIndex] : undefined;

    let messageId: number;
    if (match && target) {
      messageId = await sendQuoteReply(topic.topicId, target.messageId, match.quote, text);
    } else if (topic.headerMessageId !== undefined) {
      messageId = await sendReply(topic.topicId, topic.headerMessageId, text);
    } else {
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chatId,
        message_thread_id: topic.topicId,
        text,
      });
      messageId = sent.message_id;
    }

    return { link: messageLink(chatId, messageId, topic.topicId) };
  }

  async function start(): Promise<void> {
    if (dryRun) {
      // Nothing to poll without a token; log the intent so the dry-run trail is complete.
      await transport
        .call('getUpdates', {
          offset: -1,
          timeout: 25,
          allowed_updates: ['callback_query'],
          note: 'dry-run: long polling not started',
        })
        .catch(() => undefined);
      return;
    }
    if (bot) return;

    const instance = new Bot(token, { client: { timeoutSeconds: 20 } });
    instance.on('callback_query', async (ctx) => {
      await handleCallbackQuery(
        { chatId, transport, store, onAgreeAll: opts.onAgreeAll, nowIso },
        { id: ctx.callbackQuery.id, data: ctx.callbackQuery.data },
      );
    });
    instance.catch((error) => {
      console.error(
        `[telegram] update handler failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    // Validate the token before reporting live, so /api/health can show a real error
    // instead of `ok` while polling silently fails in the background.
    await instance.init();
    bot = instance;
    polling = instance.start({ allowed_updates: ['callback_query'] }).catch((error: unknown) => {
      console.error(`[telegram] long polling stopped: ${(error as Error).message}`);
    });
  }

  async function stop(): Promise<void> {
    const instance = bot;
    const running = polling;
    bot = undefined;
    polling = undefined;
    if (instance) {
      try {
        await instance.stop();
      } catch {
        // already stopped
      }
    }
    if (running) await running.catch(() => undefined);
  }

  return {
    mode: dryRun ? 'dry-run' : 'live',
    onAttention,
    onReviewSent,
    readOnPhone,
    start,
    stop,
  };
}

function pick(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

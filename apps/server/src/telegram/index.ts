// Pinpoint Telegram notifier.
//
// One forum topic per agent task in one private supergroup with Topics enabled:
//   card    "🟡 Needs you: plan, 7 steps" + the one-line points, [✅ Agree all]
//           [📄 Read full plan]; the only message that notifies when the agent needs you
//   source  the full agent reply, silent, quote-safe, collapsed when long
//   review  one silent quote-reply per note on the exact sentence, then one summary
//   read    "📖 Step 4: you opened this from your glasses" + the paragraph (notifies)
// General topic: one pinned "How Pinpoint Desk works" legend.
// Without TELEGRAM_BOT_TOKEN everything runs in dry-run: every intended Bot API call is
// written as one JSON line to .data/telegram-dryrun.log and fake links are returned.
import { fileURLToPath } from 'node:url';
import { Bot } from 'grammy';
import type { AppId, Deck, Point, Receipt, ReviewDraft } from '../../../../shared/contract.js';
import { errorMessage } from '../core/errors.js';
import {
  AGREE_PREFIX,
  ANSWER_PREFIX,
  APPROVE_PREFIX,
  MAIL_PREFIX,
  handleCallbackQuery,
} from './callbacks.js';
import {
  AGREED_FIRST_LINE,
  LEGEND_TEXT,
  clipAround,
  fullTextLabel,
  messageLink,
  needsCard,
  noteBody,
  noteReplyText,
  readOnPhoneText,
  receiptFirstLine,
  renderCard,
  reviewCountsFor,
  reviewedFirstLine,
  summaryText,
  topicStatusForAttention,
  type CardContext,
  type TopicStatus,
} from './format.js';
import {
  LONG_FULL_TEXT_CHARS,
  escapeHtml,
  renderParts,
  splitPlainText,
  wrapExpandable,
  type RenderedPart,
} from './markdown.js';
import { findQuoteMatch, paragraphContaining } from './quotes.js';
import { applyTopicStatus, createTopicIconResolver, topicNameFor } from './status.js';
import { JsonStateStore, type StoredPart, type TopicRecord } from './store.js';
import { TelegramApiError, TelegramTransport, type TelegramMessage } from './transport.js';
import type { SourceRef, ThreadRef } from './types.js';

export type { SourceRef, ThreadRef } from './types.js';

export { markdownToHtml, renderParts, splitPlainText } from './markdown.js';

/**
 * Render an agent reply for the phone. Quote replies are a core feature, and Telegram
 * refuses a quote that lands inside bold or italic text, so replies are rendered
 * quote-safe (code, links and block quotes stay). The header, review and notes keep
 * their formatting.
 */
export function renderSourceParts(
  text: string,
  maxChars?: number,
  options: { collapseLong?: boolean } = {},
): RenderedPart[] {
  return renderParts(text, maxChars, {
    quoteSafe: true,
    ...(options.collapseLong === false ? { collapseLong: false } : {}),
  });
}
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
  /** Called when the phone taps "✅ Agree all"; receives the thread id. */
  onAgreeAll(threadId: string): Promise<void>;
  /**
   * Called when a question card option is tapped. The server should wire this to the
   * same answer path the glasses use. Without it, question cards show no option buttons.
   */
  onAnswer?(threadId: string, pointId: string, option: string): Promise<void>;
  /** Called when "✅ Approve" is tapped on a Notion card. */
  onApprove?(threadId: string): Promise<void>;
  /** Called when the phone confirms "Send" on a Gmail draft. */
  onSend?(threadId: string): Promise<void>;
  /** Called when Telegram refuses a quote and the note is posted as a plain reply. */
  onQuoteFallback?(info: { quote: string; text: string; reason: string }): void;
  /** Override for tests; defaults to apps/server/.data. */
  dataDir?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum gap between calls in the same chat; default 1000 ms. */
  minIntervalMs?: number;
}

export interface SentMessageRef {
  kind: 'card' | 'full-text' | 'note' | 'summary' | 'receipt' | 'read-on-phone';
  messageId: number;
  link: string;
  pointId?: string;
}

export interface ReviewSentResult {
  link?: string;
  messages?: SentMessageRef[];
  /** First line now shown on the card, when a receipt produced it. */
  firstLine?: string;
}

export interface ReadOnPhoneResult {
  link?: string;
  messageId?: number;
}

export interface TelegramNotifier {
  mode: 'live' | 'dry-run';
  onAttention(thread: ThreadRef, source: SourceRef, deck: Deck): Promise<void>;
  onReviewSent(
    thread: ThreadRef,
    deck: Deck,
    draft: ReviewDraft,
    composedMessage: string,
    receipt?: Receipt,
    options?: { via?: 'g2' | 'telegram' },
  ): Promise<ReviewSentResult>;
  /**
   * The live inbox polling saw a new agent message on a thread that was already
   * reviewed. Posts it silently and returns true when it was handled, so the
   * caller does not post a fresh card for the same message.
   */
  onAgentReply(
    thread: ThreadRef,
    source: SourceRef,
    options?: { needsYou?: boolean },
  ): Promise<boolean>;
  readOnPhone(thread: ThreadRef, deck: Deck, point: Point): Promise<ReadOnPhoneResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

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
  const icons = createTopicIconResolver(transport);

  let bot: Bot | undefined;
  let polling: Promise<void> | undefined;
  let legendTask: Promise<void> | undefined;

  const chatOf = (record: TopicRecord): string => record.chatId || chatId;

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

  function assertCallbackData(data: string): void {
    if (Buffer.byteLength(data, 'utf8') > 64) {
      throw new Error(`callback_data is too long for Telegram (max 64 bytes): ${data.length} chars`);
    }
  }

  function isMessageNotModified(error: unknown): boolean {
    return (
      error instanceof TelegramApiError &&
      error.code === 400 &&
      /message is not modified/i.test(error.description)
    );
  }

  /** Edit calls are idempotent: "message is not modified" means the wanted state is already shown. */
  async function callIgnoringNotModified(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      await transport.call(method, params);
    } catch (error) {
      if (!isMessageNotModified(error)) throw error;
    }
  }

  function contextFor(thread: ThreadRef, source?: SourceRef): CardContext {
    const app = source?.app ?? thread.app ?? 't3';
    return {
      app,
      ...(source?.target ? { target: source.target } : {}),
    };
  }

  function cardKeyboard(
    thread: ThreadRef,
    deck: Deck,
    source?: SourceRef,
    link?: string,
  ): {
    keyboard: InlineKeyboard;
    answerPointId?: string;
    answerOptions?: string[];
  } {
    const rows: InlineButton[][] = [];
    const app = source?.app ?? thread.app ?? 't3';

    if (app === 'notion') {
      const row: InlineButton[] = [];
      if (opts.onApprove) {
        const data = `${APPROVE_PREFIX}${thread.threadId}`;
        assertCallbackData(data);
        row.push({ text: '✅ Approve', callback_data: data });
      }
      if (source?.target?.link) row.push({ text: '📄 Read page', url: source.target.link });
      if (row.length > 0) rows.push(row);
      return { keyboard: { inline_keyboard: rows } };
    }

    if (app === 'gmail') {
      const row: InlineButton[] = [];
      if (source?.target?.link) row.push({ text: '📄 Read draft', url: source.target.link });
      if (opts.onSend) {
        const data = `${MAIL_PREFIX}${thread.threadId}`;
        assertCallbackData(data);
        row.push({ text: '✉️ Send as written', callback_data: data });
      }
      if (row.length > 0) rows.push(row);
      return { keyboard: { inline_keyboard: rows } };
    }

    const question = opts.onAnswer
      ? deck.points.find((point) => point.kind === 'question' && (point.options?.length ?? 0) > 0)
      : undefined;

    if (question?.options) {
      question.options.forEach((option, index) => {
        const data = `${ANSWER_PREFIX}${thread.threadId}:${index}`;
        assertCallbackData(data);
        rows.push([{ text: option, callback_data: data }]);
      });
    }

    const agreeData = `${AGREE_PREFIX}${thread.threadId}`;
    assertCallbackData(agreeData);
    rows.push([
      { text: '✅ Agree all', callback_data: agreeData },
      ...(link ? [{ text: '📄 Read full plan', url: link }] : []),
    ]);

    return {
      keyboard: { inline_keyboard: rows },
      ...(question ? { answerPointId: question.id, answerOptions: question.options } : {}),
    };
  }

  async function ensureLegend(): Promise<void> {
    if (legendTask) return legendTask;
    legendTask = (async () => {
      const state = await store.get();
      if (state.generalMessageId !== undefined) {
        if (state.legendText !== LEGEND_TEXT) {
          await transport
            .call('editMessageText', {
              chat_id: chatId,
              message_id: state.generalMessageId,
              text: LEGEND_TEXT,
              link_preview_options: { is_disabled: true },
            })
            .catch(() => undefined);
          await store.update((next) => {
            next.legendText = LEGEND_TEXT;
          });
        }
        return;
      }

      // A previous process may have pinned the legend without this store knowing.
      if (!dryRun) {
        try {
          const chat = await transport.call<{
            pinned_message?: { message_id?: number; text?: string };
          }>('getChat', { chat_id: chatId });
          const pinned = chat?.pinned_message;
          if (pinned?.message_id !== undefined && pinned.text?.startsWith('How Pinpoint Desk works')) {
            await store.update((next) => {
              next.generalMessageId = pinned.message_id;
              next.legendText = pinned.text;
            });
            return;
          }
        } catch {
          // No getChat rights or no pinned message; post the legend normally.
        }
      }

      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chatId,
        text: LEGEND_TEXT,
        disable_notification: true,
        link_preview_options: { is_disabled: true },
      });
      await store.update((next) => {
        next.generalMessageId = sent.message_id;
        next.legendText = LEGEND_TEXT;
      });
      try {
        await transport.call('pinChatMessage', {
          chat_id: chatId,
          message_id: sent.message_id,
          disable_notification: true,
        });
      } catch (error) {
        console.warn(`[telegram] could not pin the legend: ${errorMessage(error)}`);
      }
    })().catch((error) => {
      legendTask = undefined;
      throw error;
    });
    return legendTask;
  }

  function isMissingTopic(error: unknown): boolean {
    return (
      error instanceof TelegramApiError &&
      error.code === 400 &&
      /TOPIC_ID_INVALID|thread not found|topic.*not found/i.test(error.description)
    );
  }

  async function createTopic(thread: ThreadRef, status: TopicStatus): Promise<number> {
    const icon = await icons.iconId(status);
    if (icon) {
      try {
        const created = await transport.call<{ message_thread_id: number }>('createForumTopic', {
          chat_id: chatId,
          name: topicNameFor(thread.title, status, icons),
          icon_custom_emoji_id: icon,
        });
        return created.message_thread_id;
      } catch (error) {
        if (
          !(error instanceof TelegramApiError) ||
          error.code !== 400 ||
          !/emoji|icon/i.test(error.description)
        ) {
          throw error;
        }
        icons.markUnsupported();
      }
    }
    const created = await transport.call<{ message_thread_id: number }>('createForumTopic', {
      chat_id: chatId,
      name: topicNameFor(thread.title, status, icons),
    });
    return created.message_thread_id;
  }

  async function ensureTopic(thread: ThreadRef, status?: TopicStatus): Promise<TopicRecord> {
    const state = await store.get();
    const existing = state.topics[thread.threadId];
    const target = status ?? existing?.status ?? topicStatusForAttention(thread.attention);

    let missing = false;
    if (existing?.topicId) {
      try {
        await applyTopicStatus(
          transport,
          chatOf(existing),
          { topicId: existing.topicId, title: thread.title },
          target,
          icons,
        );
      } catch (error) {
        if (!isMissingTopic(error)) throw error;
        missing = true;
      }
      if (!missing) {
        return (
          (await saveRecord(thread.threadId, (record) => {
            record.title = thread.title;
            record.project = thread.project ?? '';
            record.attention = thread.attention;
            record.status = target;
          })) ?? existing
        );
      }
    }

    const topicId = await createTopic(thread, target);
    const record: TopicRecord = {
      threadId: thread.threadId,
      chatId,
      topicId,
      title: thread.title,
      project: thread.project ?? '',
      app: thread.app ?? 't3',
      attention: thread.attention,
      status: target,
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

  async function ensureCard(
    thread: ThreadRef,
    deck: Deck,
    current: TopicRecord,
    source?: SourceRef,
  ): Promise<TopicRecord> {
    const context = contextFor(thread, source);
    const parts = needsCard(thread, deck, context);
    const text = renderCard(parts);
    const { keyboard, answerPointId, answerOptions } = cardKeyboard(thread, deck, source);
    const markup =
      keyboard.inline_keyboard.length > 0
        ? ({ reply_markup: keyboard } as { reply_markup: InlineKeyboard })
        : {};
    const app = context.app ?? 't3';
    const recipient = source?.target?.recipient ?? source?.target?.name;
    const targetLink = source?.target?.link;

    if (current.headerMessageId === undefined) {
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chatOf(current),
        message_thread_id: current.topicId,
        text,
        ...markup,
        link_preview_options: { is_disabled: true },
      });
      // Telegram auto-pins the first message in a new topic. The card must not stay
      // pinned, so unpin it right away; a failure is cosmetic and never blocks the card.
      try {
        await transport.call('unpinChatMessage', {
          chat_id: chatOf(current),
          message_id: sent.message_id,
        });
      } catch (error) {
        if (
          !(error instanceof TelegramApiError) ||
          !/not pinned|can't be pinned|message to unpin not found/i.test(error.description)
        ) {
          console.warn(`[telegram] could not unpin the card: ${errorMessage(error)}`);
        }
      }
      return (
        (await saveRecord(thread.threadId, (record) => {
          record.headerMessageId = sent.message_id;
          record.headerText = text;
          record.cardTitleLine = parts.titleLine;
          record.cardLines = parts.points;
          record.app = app;
          if (recipient) record.recipient = recipient;
          if (targetLink) record.targetLink = targetLink;
          record.attention = thread.attention;
          record.pointCount = deck.points.length;
          record.answerPointId = answerPointId;
          record.answerOptions = answerOptions;
          delete record.cardKeyboardKey;
          delete record.agreedAt;
          delete record.reviewedAt;
          delete record.summaryMessageId;
        })) ?? current
      );
    }

    if (
      current.headerText !== text ||
      current.agreedAt ||
      current.reviewedAt ||
      current.attention !== thread.attention ||
      current.pointCount !== deck.points.length
    ) {
      await callIgnoringNotModified('editMessageText', {
        chat_id: chatOf(current),
        message_id: current.headerMessageId,
        text,
        ...markup,
      });
      return (
        (await saveRecord(thread.threadId, (record) => {
          record.headerText = text;
          record.cardTitleLine = parts.titleLine;
          record.cardLines = parts.points;
          record.app = app;
          if (recipient) record.recipient = recipient;
          if (targetLink) record.targetLink = targetLink;
          record.attention = thread.attention;
          record.pointCount = deck.points.length;
          record.answerPointId = answerPointId;
          record.answerOptions = answerOptions;
          delete record.cardKeyboardKey;
          delete record.agreedAt;
          delete record.reviewedAt;
          delete record.summaryMessageId;
        })) ?? current
      );
    }
    return current;
  }

  async function postSource(
    thread: ThreadRef,
    current: TopicRecord,
    source: SourceRef,
  ): Promise<TopicRecord> {
    if (current.sourceMessageId === source.sourceMessageId && current.parts.length > 0) {
      return current;
    }

    const rendered = renderSourceParts(source.text, undefined, { collapseLong: false });
    const longText = source.text.replace(/\s+/g, ' ').trim().length > LONG_FULL_TEXT_CHARS;
    const body = longText ? wrapExpandable(rendered) : rendered;
    const label = fullTextLabel(thread.attention, source.app ?? thread.app ?? 't3');
    const posted: StoredPart[] = [];

    for (let index = 0; index < body.length; index += 1) {
      const part = body[index] as RenderedPart;
      const header = index === 0 ? label : undefined;
      const html = header ? `${escapeHtml(header)}\n\n${part.html}` : part.html;
      const plain = header ? `${header}\n\n${part.plain}` : part.plain;
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chatOf(current),
        message_thread_id: current.topicId,
        text: html,
        parse_mode: 'HTML',
        disable_notification: true,
        link_preview_options: { is_disabled: true },
      });
      posted.push({ messageId: sent.message_id, plain });
      await store.update((state) => {
        const record = state.topics[current.threadId];
        if (!record) return;
        record.parts = [...posted];
        record.sourceMessageIds = posted.map((entry) => entry.messageId);
        record.updatedAt = nowIso();
      });
    }

    // Mark the source complete only after every part is posted, so a failure midway
    // causes a full repost next time instead of a permanently truncated plan.
    await store.update((state) => {
      const record = state.topics[current.threadId];
      if (!record) return;
      record.sourceMessageId = source.sourceMessageId;
      record.updatedAt = nowIso();
    });

    return (await store.get()).topics[thread.threadId] ?? current;
  }

  async function refreshCardKeyboard(
    thread: ThreadRef,
    deck: Deck,
    current: TopicRecord,
    source?: SourceRef,
  ): Promise<TopicRecord> {
    const first = current.parts[0];
    if (current.headerMessageId === undefined || !first) return current;
    const link = messageLink(chatOf(current), first.messageId, current.topicId);
    const { keyboard, answerPointId, answerOptions } = cardKeyboard(thread, deck, source, link);
    const key = `${first.messageId}|${JSON.stringify(keyboard.inline_keyboard)}`;
    if (current.cardKeyboardKey === key) return current;

    await callIgnoringNotModified('editMessageReplyMarkup', {
      chat_id: chatOf(current),
      message_id: current.headerMessageId,
      reply_markup: keyboard,
    });
    return (
      (await saveRecord(thread.threadId, (record) => {
        record.cardKeyboardKey = key;
        record.answerPointId = answerPointId;
        record.answerOptions = answerOptions;
      })) ?? current
    );
  }

  async function sendQuoteReply(
    chat: string,
    topicId: number,
    targetMessageId: number,
    quote: string,
    text: string,
    notify: boolean,
  ): Promise<number> {
    const base = {
      chat_id: chat,
      message_thread_id: topicId,
      text,
      ...(notify ? {} : { disable_notification: true }),
    };
    try {
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        ...base,
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
        opts.onQuoteFallback?.({ quote, text, reason: error.description });
        const sent = await transport.call<TelegramMessage>('sendMessage', {
          ...base,
          reply_parameters: { message_id: targetMessageId, allow_sending_without_reply: true },
        });
        return sent.message_id;
      }
      throw error;
    }
  }

  async function sendReply(
    chat: string,
    topicId: number,
    targetMessageId: number,
    text: string,
    notify: boolean,
  ): Promise<number> {
    const sent = await transport.call<TelegramMessage>('sendMessage', {
      chat_id: chat,
      message_thread_id: topicId,
      text,
      ...(notify ? {} : { disable_notification: true }),
      reply_parameters: { message_id: targetMessageId, allow_sending_without_reply: true },
    });
    return sent.message_id;
  }

  async function finishCard(record: TopicRecord, firstLine: string): Promise<void> {
    if (record.headerMessageId === undefined) return;
    const text = renderCard({
      firstLine,
      titleLine: record.cardTitleLine ?? record.title,
      points: record.cardLines ?? [],
    });
    const chat = chatOf(record);
    await callIgnoringNotModified('editMessageText', {
      chat_id: chat,
      message_id: record.headerMessageId,
      text,
    });
    await callIgnoringNotModified('editMessageReplyMarkup', {
      chat_id: chat,
      message_id: record.headerMessageId,
      reply_markup: { inline_keyboard: [] },
    });
    await saveRecord(record.threadId, (next) => {
      next.headerText = text;
      delete next.cardKeyboardKey;
      delete next.answerOptions;
      delete next.answerPointId;
    });
  }

  async function setTopicStatus(record: TopicRecord, status: TopicStatus): Promise<void> {
    try {
      await applyTopicStatus(transport, chatOf(record), record, status, icons);
      await saveRecord(record.threadId, (next) => {
        next.status = status;
      });
    } catch (error) {
      console.warn(`[telegram] could not update the topic status: ${errorMessage(error)}`);
    }
  }

  async function onAttention(thread: ThreadRef, source: SourceRef, deck: Deck): Promise<void> {
    await ensureLegend();
    const app = source.app ?? thread.app ?? 't3';
    const topic = await ensureTopic(thread, topicStatusForAttention(thread.attention));
    const withCard = await ensureCard(thread, deck, topic, source);
    const withSource = await postSource(thread, withCard, source);
    // The agent card's "Read full plan" needs the posted full-text message id; the
    // Notion/Gmail buttons already carry their own links on the first send.
    if (app === 't3') await refreshCardKeyboard(thread, deck, withSource, source);
    await saveRecord(thread.threadId, (next) => {
      next.title = thread.title;
      next.project = thread.project ?? '';
      next.app = app;
      next.attention = thread.attention;
      next.pointCount = deck.points.length;
    });
  }

  async function onReviewSent(
    thread: ThreadRef,
    deck: Deck,
    draft: ReviewDraft,
    _composedMessage: string,
    receipt?: Receipt,
    options: { via?: 'g2' | 'telegram' } = {},
  ): Promise<ReviewSentResult> {
    await ensureLegend();
    const app = thread.app ?? 't3';
    const via = options.via ?? 'g2';
    const topic = await ensureTopic(thread);
    const record = topic.headerMessageId !== undefined ? topic : await ensureCard(thread, deck, topic);
    const cardContext: CardContext = { app };
    const chat = chatOf(record);
    const messages: SentMessageRef[] = [];
    if (record.headerMessageId !== undefined) {
      messages.push({
        kind: 'card',
        messageId: record.headerMessageId,
        link: messageLink(chat, record.headerMessageId, record.topicId),
      });
    }

    // One silent quote-reply per note, on the exact source sentence, body only.
    for (const note of draft.notes ?? []) {
      const point = deck.points.find((candidate) => candidate.id === note.pointId);
      if (!point || noteBody(note).length === 0) continue;
      const text = noteReplyText(note, app);
      const match = findQuoteMatch(record.parts, point.quote);
      const target = match ? record.parts[match.partIndex] : undefined;
      let messageId: number;
      if (match && target) {
        messageId = await sendQuoteReply(
          chat,
          record.topicId,
          target.messageId,
          match.quote,
          text,
          false,
        );
      } else if (record.headerMessageId !== undefined) {
        messageId = await sendReply(chat, record.topicId, record.headerMessageId, text, false);
      } else {
        const sent = await transport.call<TelegramMessage>('sendMessage', {
          chat_id: chat,
          message_thread_id: record.topicId,
          text,
          disable_notification: true,
        });
        messageId = sent.message_id;
      }
      messages.push({
        kind: 'note',
        pointId: point.id,
        messageId,
        link: messageLink(chat, messageId, record.topicId),
      });
    }

    const counts = reviewCountsFor(app, deck, draft.notes);
    const summary = summaryText(counts, { app, via });
    const sentSummary = await transport.call<TelegramMessage>('sendMessage', {
      chat_id: chat,
      message_thread_id: record.topicId,
      text: summary,
      disable_notification: true,
    });
    messages.push({
      kind: 'summary',
      messageId: sentSummary.message_id,
      link: messageLink(chat, sentSummary.message_id, record.topicId),
    });

    let receiptMessageId: number | undefined;
    if (receipt && receipt.lines.length > 0) {
      const sentReceipt = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chat,
        message_thread_id: record.topicId,
        text: receiptText(receipt),
        parse_mode: 'HTML',
        disable_notification: true,
        link_preview_options: { is_disabled: true },
      });
      receiptMessageId = sentReceipt.message_id;
      messages.push({
        kind: 'receipt',
        messageId: sentReceipt.message_id,
        link: messageLink(chat, sentReceipt.message_id, record.topicId),
      });
    }

    const firstLine =
      receiptFirstLine(receipt, draft, app) ?? reviewedFirstLine(counts, via);
    await finishCard(record, firstLine);
    await setTopicStatus(record, 'done');
    await saveRecord(thread.threadId, (next) => {
      next.reviewMessageId = sentSummary.message_id;
      next.summaryMessageId = sentSummary.message_id;
      if (receiptMessageId !== undefined) next.receiptMessageId = receiptMessageId;
      next.reviewedAt = nowIso();
      next.pointCount = deck.points.length;
      const card = needsCard(thread, deck, cardContext);
      next.cardLines = card.points;
      next.cardTitleLine = record.cardTitleLine ?? card.titleLine;
      next.app = app;
    });

    return {
      link: messageLink(chat, sentSummary.message_id, record.topicId),
      messages,
      firstLine,
    };
  }

  /**
   * A new message on a thread that was already reviewed. The live inbox polling
   * calls this before posting any fresh card, so the topic shows one calm
   * "Agent replied" message instead of a second notifying card.
   */
  async function onAgentReply(
    thread: ThreadRef,
    source: SourceRef,
    options: { needsYou?: boolean } = {},
  ): Promise<boolean> {
    const app = thread.app ?? source.app ?? 't3';
    if (app !== 't3') return false;
    const state = await store.get();
    const record = state.topics[thread.threadId];
    if (!record || record.headerMessageId === undefined) return false;
    if (!record.reviewedAt && !record.agreedAt) return false;
    if (!record.sourceMessageId || record.sourceMessageId === source.sourceMessageId) {
      return false;
    }

    const rendered = renderSourceParts(source.text, undefined, { collapseLong: false });
    const longText = source.text.replace(/\s+/g, ' ').trim().length > LONG_FULL_TEXT_CHARS;
    const body = longText ? wrapExpandable(rendered) : rendered;
    const label = '🤖 Agent replied';
    const posted: StoredPart[] = [];
    for (let index = 0; index < body.length; index += 1) {
      const part = body[index] as RenderedPart;
      const header = index === 0 ? label : undefined;
      const html = header ? `${escapeHtml(header)}\n\n${part.html}` : part.html;
      const plain = header ? `${header}\n\n${part.plain}` : part.plain;
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chatOf(record),
        message_thread_id: record.topicId,
        text: html,
        parse_mode: 'HTML',
        disable_notification: true,
        link_preview_options: { is_disabled: true },
      });
      posted.push({ messageId: sent.message_id, plain });
    }

    const withReply = await saveRecord(thread.threadId, (next) => {
      next.sourceMessageId = source.sourceMessageId;
      next.parts = posted;
      next.sourceMessageIds = posted.map((entry) => entry.messageId);
      next.attention = thread.attention;
      next.title = thread.title;
    });
    const needsYou = options.needsYou !== false;
    if (needsYou && withReply) {
      await setTopicStatus(withReply, 'needs');
    }
    return true;
  }

  async function readOnPhone(
    thread: ThreadRef,
    _deck: Deck,
    point: Point,
  ): Promise<ReadOnPhoneResult> {
    const topic = await ensureTopic(thread);
    const chat = chatOf(topic);
    const match = findQuoteMatch(topic.parts, point.quote);
    const target = match ? topic.parts[match.partIndex] : undefined;

    let text = readOnPhoneText(point);
    let messageId: number;
    if (match && target) {
      const paragraph = paragraphContaining(target.plain, match.quote);
      text = readOnPhoneText(point, paragraph ? clipAround(paragraph, match.quote) : undefined);
      // The owner explicitly asked for this message, so it notifies.
      messageId = await sendQuoteReply(chat, topic.topicId, target.messageId, match.quote, text, true);
    } else if (topic.headerMessageId !== undefined) {
      messageId = await sendReply(chat, topic.topicId, topic.headerMessageId, text, true);
    } else {
      const sent = await transport.call<TelegramMessage>('sendMessage', {
        chat_id: chat,
        message_thread_id: topic.topicId,
        text,
      });
      messageId = sent.message_id;
    }

    return { link: messageLink(chat, messageId, topic.topicId), messageId };
  }

  async function start(): Promise<void> {
    await ensureLegend().catch((error: unknown) => {
      console.warn(`[telegram] could not post the General-topic legend: ${errorMessage(error)}`);
    });
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
        {
          chatId,
          transport,
          store,
          onAgreeAll: opts.onAgreeAll,
          ...(opts.onAnswer ? { onAnswer: opts.onAnswer } : {}),
          ...(opts.onApprove ? { onApprove: opts.onApprove } : {}),
          ...(opts.onSend ? { onSend: opts.onSend } : {}),
          setTopicStatus,
          nowIso,
        },
        { id: ctx.callbackQuery.id, data: ctx.callbackQuery.data },
      );
    });
    instance.catch((error) => {
      console.error(`[telegram] update handler failed: ${errorMessage(error)}`);
    });
    // Validate the token before reporting live, so /api/health can show a real error
    // instead of `ok` while polling silently fails in the background.
    await instance.init();
    bot = instance;
    polling = instance.start({ allowed_updates: ['callback_query'] }).catch((error: unknown) => {
      console.error(`[telegram] long polling stopped: ${errorMessage(error)}`);
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
    onAgentReply,
    readOnPhone,
    start,
    stop,
  };
}

/**
 * The silent receipt message: one line per place the review landed, linked to
 * the result (Notion page, Gmail sent message). Failed lines keep a warning.
 */
function receiptText(receipt: Receipt): string {
  const lines = receipt.lines.map((line) => {
    const mark = line.ok ? '•' : '⚠️';
    const label = escapeHtml(line.text);
    if (line.link && /^https?:\/\//i.test(line.link)) {
      const href = line.link.replace(/&/g, '&amp;').replace(/"/g, '%22');
      return `${mark} <a href="${href}">${label}</a>`;
    }
    return `${mark} ${label}`;
  });
  return `📍 Where it landed\n${lines.join('\n')}`;
}

function pick(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

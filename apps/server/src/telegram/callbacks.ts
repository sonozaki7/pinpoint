// Inline button callbacks.
//
//   agree:<threadId>          "✅ Agree all" on a card -> approve the whole plan
//   ans:<threadId>:<index>    one option of a question card -> same answer path as the glasses
import { errorMessage } from '../core/errors.js';
import { AGREED_FIRST_LINE, renderCard, type TopicStatus } from './format.js';
import type { JsonStateStore, TopicRecord } from './store.js';
import type { TelegramTransport } from './transport.js';

export const AGREE_PREFIX = 'agree:';
export const ANSWER_PREFIX = 'ans:';

export interface CallbackDeps {
  chatId: string;
  transport: TelegramTransport;
  store: JsonStateStore;
  /** Called with the thread id; the server's AgreeAllHook also accepts a bare id. */
  onAgreeAll(threadId: string): Promise<void>;
  /** Same path the glasses use to answer a question; only present when the server wired it. */
  onAnswer?(threadId: string, pointId: string, option: string): Promise<void>;
  /** Change the topic icon/name (needs you / done / failed). */
  setTopicStatus(record: TopicRecord, status: TopicStatus): Promise<void>;
  nowIso(): string;
}

export interface CallbackQueryRef {
  id: string;
  data?: string;
}

export async function handleCallbackQuery(deps: CallbackDeps, query: CallbackQueryRef): Promise<void> {
  const data = query.data ?? '';
  if (data.startsWith(AGREE_PREFIX)) {
    await handleAgree(deps, query, data.slice(AGREE_PREFIX.length));
    return;
  }
  if (data.startsWith(ANSWER_PREFIX)) {
    await handleAnswer(deps, query, data.slice(ANSWER_PREFIX.length));
    return;
  }
  await deps.transport
    .call('answerCallbackQuery', { callback_query_id: query.id, text: 'Unknown action' })
    .catch(() => undefined);
}

async function handleAgree(deps: CallbackDeps, query: CallbackQueryRef, threadId: string): Promise<void> {
  try {
    await deps.onAgreeAll(threadId);
  } catch (error) {
    console.error(`[telegram] onAgreeAll failed: ${errorMessage(error)}`);
    await deps.transport
      .call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Could not reach T3. Try again.',
        show_alert: true,
      })
      .catch(() => undefined);
    return;
  }

  const record = await updateRecord(deps, threadId, (next) => {
    next.agreedAt = deps.nowIso();
  });
  await deps.transport
    .call('answerCallbackQuery', { callback_query_id: query.id, text: 'Agreed — sent to T3' })
    .catch(() => undefined);

  if (!record) return;
  await markCardReviewed(deps, record, AGREED_FIRST_LINE);
  await setStatus(deps, record, 'done');
}

async function handleAnswer(deps: CallbackDeps, query: CallbackQueryRef, payload: string): Promise<void> {
  const splitAt = payload.lastIndexOf(':');
  const threadId = splitAt >= 0 ? payload.slice(0, splitAt) : payload;
  const index = Number.parseInt(splitAt >= 0 ? payload.slice(splitAt + 1) : '', 10);

  const state = await deps.store.get();
  const record = state.topics[threadId];
  const option = record?.answerOptions?.[index];
  const pointId = record?.answerPointId;
  if (!record || !option || !pointId || !deps.onAnswer) {
    await deps.transport
      .call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Answering from Telegram is not set up. Use your G2.',
      })
      .catch(() => undefined);
    return;
  }

  try {
    await deps.onAnswer(threadId, pointId, option);
  } catch (error) {
    console.error(`[telegram] onAnswer failed: ${errorMessage(error)}`);
    await deps.transport
      .call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Could not send that answer. Try again.',
        show_alert: true,
      })
      .catch(() => undefined);
    return;
  }

  await deps.transport
    .call('answerCallbackQuery', { callback_query_id: query.id, text: 'Answer sent' })
    .catch(() => undefined);
}

async function markCardReviewed(
  deps: CallbackDeps,
  record: TopicRecord,
  firstLine: string,
): Promise<void> {
  if (record.headerMessageId === undefined) return;
  const text = renderCard({
    firstLine,
    titleLine: record.cardTitleLine ?? record.title,
    points: record.cardLines ?? [],
  });
  const chatId = record.chatId || deps.chatId;
  await ignoreNotModified(
    deps.transport.call('editMessageText', {
      chat_id: chatId,
      message_id: record.headerMessageId,
      text,
    }),
  );
  await ignoreNotModified(
    deps.transport.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: record.headerMessageId,
      reply_markup: { inline_keyboard: [] },
    }),
  );
  await updateRecord(deps, record.threadId, (next) => {
    next.headerText = text;
    delete next.cardKeyboardKey;
    delete next.answerOptions;
    delete next.answerPointId;
  });
}

async function setStatus(deps: CallbackDeps, record: TopicRecord, status: TopicStatus): Promise<void> {
  try {
    await deps.setTopicStatus(record, status);
  } catch (error) {
    console.error(`[telegram] could not set topic ${status}: ${errorMessage(error)}`);
  }
  await updateRecord(deps, record.threadId, (next) => {
    next.status = status;
  });
}

async function updateRecord(
  deps: CallbackDeps,
  threadId: string,
  mutate: (record: TopicRecord) => void,
): Promise<TopicRecord | undefined> {
  return deps.store.update((state) => {
    const record = state.topics[threadId];
    if (!record) return undefined;
    mutate(record);
    record.updatedAt = deps.nowIso();
    return record;
  });
}

/** Editing a card that already shows the wanted state is success, not a failure. */
async function ignoreNotModified(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    if (!/message is not modified/i.test(description)) throw error;
  }
}

// Inline button callbacks.
//
//   agree:<threadId>       "✅ Agree all" on an agent card -> approve the whole plan
//   ans:<threadId>:<index> one option of a question card -> same answer path as the glasses
//   approve:<threadId>     "✅ Approve" on a Notion card -> set the page status to Approved
//   mail:<threadId>        "✉️ Send as written" on a Gmail card -> ask on the phone first
//   mailsend:<threadId>    "Send" on that confirmation -> send the draft
//   mailcancel:<threadId>  "Cancel" on that confirmation -> nothing leaves
import { errorMessage } from '../core/errors.js';
import {
  AGREED_FIRST_LINE,
  answeredFirstLine,
  renderCard,
  sendConfirmText,
  type TopicStatus,
} from './format.js';
import type { JsonStateStore, TopicRecord } from './store.js';
import type { TelegramMessage, TelegramTransport } from './transport.js';

export const AGREE_PREFIX = 'agree:';
export const ANSWER_PREFIX = 'ans:';
export const APPROVE_PREFIX = 'approve:';
export const MAIL_PREFIX = 'mail:';
export const MAIL_SEND_PREFIX = 'mailsend:';
export const MAIL_CANCEL_PREFIX = 'mailcancel:';

export interface CallbackDeps {
  chatId: string;
  transport: TelegramTransport;
  store: JsonStateStore;
  /** Called with the thread id; the server's AgreeAllHook also accepts a bare id. */
  onAgreeAll(threadId: string): Promise<void>;
  /** Same path the glasses use to answer a question; only present when the server wired it. */
  onAnswer?(threadId: string, pointId: string, option: string): Promise<void>;
  /** Approve a Notion page (send an empty review so its status becomes Approved). */
  onApprove?(threadId: string): Promise<void>;
  /** Send a Gmail draft after the phone confirmation. */
  onSend?(threadId: string): Promise<void>;
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
  if (data.startsWith(APPROVE_PREFIX)) {
    await handleApprove(deps, query, data.slice(APPROVE_PREFIX.length));
    return;
  }
  if (data.startsWith(MAIL_SEND_PREFIX)) {
    await handleMailSend(deps, query, data.slice(MAIL_SEND_PREFIX.length));
    return;
  }
  if (data.startsWith(MAIL_CANCEL_PREFIX)) {
    await handleMailCancel(deps, query, data.slice(MAIL_CANCEL_PREFIX.length));
    return;
  }
  if (data.startsWith(MAIL_PREFIX)) {
    await handleMailConfirm(deps, query, data.slice(MAIL_PREFIX.length));
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

  // The review path already removed the buttons and set the topic done. Show the
  // answer on the card itself so the topic reads correctly at a glance.
  const fresh = (await deps.store.get()).topics[threadId];
  if (!fresh) return;
  await markCardReviewed(deps, fresh, answeredFirstLine(option));
  await setStatus(deps, fresh, 'done');
}

async function handleApprove(deps: CallbackDeps, query: CallbackQueryRef, threadId: string): Promise<void> {
  if (!deps.onApprove) {
    await deps.transport
      .call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Approving from Telegram is not set up. Use your G2.',
      })
      .catch(() => undefined);
    return;
  }
  try {
    await deps.onApprove(threadId);
  } catch (error) {
    console.error(`[telegram] onApprove failed: ${errorMessage(error)}`);
    await deps.transport
      .call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Could not approve that page. Try again.',
        show_alert: true,
      })
      .catch(() => undefined);
    return;
  }
  await deps.transport
    .call('answerCallbackQuery', { callback_query_id: query.id, text: 'Approved' })
    .catch(() => undefined);
}

/** "✉️ Send as written" asks once, on the phone, because an email cannot be unsent. */
async function handleMailConfirm(
  deps: CallbackDeps,
  query: CallbackQueryRef,
  threadId: string,
): Promise<void> {
  const record = (await deps.store.get()).topics[threadId];
  if (!record || !deps.onSend) {
    await deps.transport
      .call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Sending from Telegram is not set up. Use your G2.',
      })
      .catch(() => undefined);
    return;
  }

  const text = sendConfirmText(record.recipient ?? 'them');
  const keyboard = confirmKeyboard(threadId);
  const sent = await deps.transport.call<TelegramMessage>('sendMessage', {
    chat_id: record.chatId || deps.chatId,
    message_thread_id: record.topicId,
    text,
    disable_notification: true,
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
    ...(record.headerMessageId !== undefined
      ? {
          reply_parameters: {
            message_id: record.headerMessageId,
            allow_sending_without_reply: true,
          },
        }
      : {}),
  });
  await updateRecord(deps, threadId, (next) => {
    next.confirmMessageId = sent.message_id;
  });
  await deps.transport
    .call('answerCallbackQuery', { callback_query_id: query.id, text: 'Confirm on the phone' })
    .catch(() => undefined);
}

async function handleMailSend(
  deps: CallbackDeps,
  query: CallbackQueryRef,
  threadId: string,
): Promise<void> {
  const record = (await deps.store.get()).topics[threadId];
  if (!record || !deps.onSend) {
    await deps.transport
      .call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Sending from Telegram is not set up. Use your G2.',
      })
      .catch(() => undefined);
    return;
  }
  try {
    await deps.onSend(threadId);
  } catch (error) {
    console.error(`[telegram] onSend failed: ${errorMessage(error)}`);
    await deps.transport
      .call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Could not send the draft. Try again.',
        show_alert: true,
      })
      .catch(() => undefined);
    return;
  }

  await deps.transport
    .call('answerCallbackQuery', { callback_query_id: query.id, text: 'Sent' })
    .catch(() => undefined);
  const to = record.recipient?.trim() || 'them';
  await finishConfirmation(deps, record, `✅ Sent to ${to} as written.`);
  await setStatus(deps, record, 'done');
}

async function handleMailCancel(
  deps: CallbackDeps,
  query: CallbackQueryRef,
  threadId: string,
): Promise<void> {
  const record = (await deps.store.get()).topics[threadId];
  await deps.transport
    .call('answerCallbackQuery', { callback_query_id: query.id, text: 'Cancelled' })
    .catch(() => undefined);
  if (!record) return;
  await finishConfirmation(deps, record, 'Cancelled — nothing sent.');
}

async function finishConfirmation(
  deps: CallbackDeps,
  record: TopicRecord,
  text: string,
): Promise<void> {
  if (record.confirmMessageId === undefined) return;
  const chatId = record.chatId || deps.chatId;
  await ignoreNotModified(
    deps.transport.call('editMessageText', {
      chat_id: chatId,
      message_id: record.confirmMessageId,
      text,
    }),
  );
  await ignoreNotModified(
    deps.transport.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: record.confirmMessageId,
      reply_markup: { inline_keyboard: [] },
    }),
  );
  await updateRecord(deps, record.threadId, (next) => {
    delete next.confirmMessageId;
  });
}

function confirmKeyboard(threadId: string): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [
      [
        { text: 'Send', callback_data: `${MAIL_SEND_PREFIX}${threadId}` },
        { text: 'Cancel', callback_data: `${MAIL_CANCEL_PREFIX}${threadId}` },
      ],
    ],
  };
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

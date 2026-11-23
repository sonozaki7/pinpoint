// Inline button callbacks. The only button Pinpoint posts is "Agree all & continue" on a
// thread header; tapping it approves the whole plan from the phone.
import { headerText } from './format.js';
import type { JsonStateStore, TopicRecord } from './store.js';
import type { TelegramTransport } from './transport.js';

export const AGREE_PREFIX = 'agree:';

export interface CallbackDeps {
  chatId: string;
  transport: TelegramTransport;
  store: JsonStateStore;
  /** Called with the thread id; the server's AgreeAllHook also accepts a bare id. */
  onAgreeAll(threadId: string): Promise<void>;
  nowIso(): string;
}

export interface CallbackQueryRef {
  id: string;
  data?: string;
}

export async function handleCallbackQuery(deps: CallbackDeps, query: CallbackQueryRef): Promise<void> {
  const data = query.data ?? '';
  if (!data.startsWith(AGREE_PREFIX)) {
    await deps.transport
      .call('answerCallbackQuery', { callback_query_id: query.id, text: 'Unknown action' })
      .catch(() => undefined);
    return;
  }
  const threadId = data.slice(AGREE_PREFIX.length);

  try {
    await deps.onAgreeAll(threadId);
  } catch (error) {
    console.error(`[telegram] onAgreeAll failed: ${(error as Error).message}`);
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

  if (record?.headerMessageId === undefined) return;
  const text = headerText(record.attention, record.pointCount, true);
  await deps.transport
    .call('editMessageText', {
      chat_id: record.chatId || deps.chatId,
      message_id: record.headerMessageId,
      text,
      reply_markup: { inline_keyboard: [] },
    })
    .catch(() => undefined);
  await updateRecord(deps, threadId, (next) => {
    next.headerText = text;
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

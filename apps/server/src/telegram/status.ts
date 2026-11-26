// Forum-topic status: one custom-icon emoji per state, with a name-prefix fallback.
//
// Telegram's getForumTopicIconStickers list has no yellow circle or warning triangle,
// so the closest reading icons are used: ❗️ needs you, ✅ done, ‼️ failed. If Telegram
// ever refuses the custom icon for this bot, the topic name is prefixed with
// 🟡 / ✅ / ⚠️ instead, and the caller remembers that for the rest of the process.
import type { TopicStatus } from './format.js';
import { TOPIC_ICON_EMOJI, TOPIC_STATUS_EMOJI, topicName } from './format.js';
import { TelegramApiError, type TelegramTransport } from './transport.js';

interface IconSticker {
  emoji: string;
  custom_emoji_id: string;
}

export interface TopicIconResolver {
  /** Custom emoji id for the status, or undefined when icons are unavailable. */
  iconId(status: TopicStatus): Promise<string | undefined>;
  /** True once Telegram refused a custom topic icon in this process. */
  unsupported(): boolean;
  markUnsupported(): void;
}

export function createTopicIconResolver(transport: TelegramTransport): TopicIconResolver {
  let cache: Map<string, string> | undefined;
  let unsupported = false;
  return {
    async iconId(status) {
      if (unsupported) return undefined;
      if (!cache) {
        try {
          const stickers = await transport.call<IconSticker[]>('getForumTopicIconStickers');
          cache = new Map();
          if (Array.isArray(stickers)) {
            for (const sticker of stickers) {
              if (sticker?.emoji && sticker.custom_emoji_id && !cache.has(sticker.emoji)) {
                cache.set(sticker.emoji, sticker.custom_emoji_id);
              }
            }
          }
        } catch {
          cache = new Map();
        }
      }
      return cache.get(TOPIC_ICON_EMOJI[status]);
    },
    unsupported: () => unsupported,
    markUnsupported: () => {
      unsupported = true;
    },
  };
}

/** Topic name for a status: plain with an icon, prefixed when icons are unavailable. */
export function topicNameFor(title: string, status: TopicStatus, icons: TopicIconResolver): string {
  return icons.unsupported() ? topicName(`${TOPIC_STATUS_EMOJI[status]} ${title}`) : topicName(title);
}

function isNotModified(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.code === 400 &&
    /TOPIC_NOT_MODIFIED/i.test(error.description)
  );
}

function refusesIcon(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.code === 400 &&
    /emoji|icon/i.test(error.description)
  );
}

/**
 * Edit the topic to show `status`. Tries the custom icon first; if Telegram refuses it,
 * remembers that and switches to a prefixed name. TOPIC_NOT_MODIFIED means the wanted
 * state is already shown and counts as success.
 */
export async function applyTopicStatus(
  transport: TelegramTransport,
  chatId: string,
  record: { topicId: number; title: string },
  status: TopicStatus,
  icons: TopicIconResolver,
): Promise<void> {
  const icon = await icons.iconId(status);
  if (icon) {
    try {
      await transport.call('editForumTopic', {
        chat_id: chatId,
        message_thread_id: record.topicId,
        name: topicName(record.title),
        icon_custom_emoji_id: icon,
      });
      return;
    } catch (error) {
      if (isNotModified(error)) return;
      if (!refusesIcon(error)) throw error;
      icons.markUnsupported();
    }
  }
  try {
    await transport.call('editForumTopic', {
      chat_id: chatId,
      message_thread_id: record.topicId,
      name: topicNameFor(record.title, status, icons),
    });
  } catch (error) {
    if (isNotModified(error)) return;
    throw error;
  }
}

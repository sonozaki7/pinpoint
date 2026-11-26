// Durable thread -> topic/message map in apps/server/.data/telegram.json.
// Writes are serialised and atomic (temp file + rename) so a crash never leaves a
// half-written JSON file.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThreadAttention } from '../../../../shared/contract.js';
import type { AppId } from '../../../../shared/contract.js';
import type { TopicStatus } from './format.js';

export interface StoredPart {
  messageId: number;
  /** Visible text of the message, used to build exact quote-replies. */
  plain: string;
}

export interface TopicRecord {
  threadId: string;
  chatId: string;
  topicId: number;
  title: string;
  /** Display-only; copied from the thread so the agree-all hook can receive the whole ref. */
  project?: string;
  /** Which review surface the topic belongs to; absent means an agent thread. */
  app?: AppId;
  /** First name a Gmail draft is addressed to, for the send confirmation. */
  recipient?: string;
  /** Deep link to the source item (Notion page, Gmail draft). */
  targetLink?: string;
  attention: ThreadAttention;
  /** Topic icon/name state: needs you, done, failed. */
  status?: TopicStatus;
  pointCount: number;
  /** The card is the first message in the topic. Old field names kept for state compatibility. */
  headerMessageId?: number;
  headerText?: string;
  /** Card body kept so callbacks can rebuild it without the deck. */
  cardTitleLine?: string;
  cardLines?: string[];
  /** Question options shown as buttons; set only for an active question card. */
  answerPointId?: string;
  answerOptions?: string[];
  /** Signature of the current reply keyboard, so it is not edited twice. */
  cardKeyboardKey?: string;
  sourceMessageId?: string;
  sourceMessageIds: number[];
  parts: StoredPart[];
  reviewMessageId?: number;
  summaryMessageId?: number;
  /** Where-the-send-landed receipt message, when the source returned one. */
  receiptMessageId?: number;
  /** The Gmail "Send as written?" confirmation message, while it waits. */
  confirmMessageId?: number;
  reviewedAt?: string;
  agreedAt?: string;
  updatedAt: string;
}

export interface TelegramState {
  version: 1;
  topics: Record<string, TopicRecord>;
  /** Message id of the pinned "How Pinpoint Desk works" legend in the General topic. */
  generalMessageId?: number;
  legendText?: string;
  /** Next fake message id used by dry-run (kept so ids never repeat across restarts). */
  fakeNextId: number;
}

export function emptyState(): TelegramState {
  return { version: 1, topics: {}, fakeNextId: 1000 };
}

export class JsonStateStore {
  private state: TelegramState | undefined;
  private loading: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async get(): Promise<TelegramState> {
    await this.load();
    return this.state as TelegramState;
  }

  update<T>(mutate: (state: TelegramState) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      await this.load();
      const result = await mutate(this.state as TelegramState);
      await this.persist();
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private load(): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const raw = await readFile(this.file, 'utf8');
          const parsed = JSON.parse(raw) as Partial<TelegramState>;
          this.state = {
            ...emptyState(),
            ...parsed,
            topics: parsed.topics ?? {},
          };
        } catch {
          this.state = emptyState();
        }
      })();
    }
    return this.loading;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(temp, this.file);
  }
}

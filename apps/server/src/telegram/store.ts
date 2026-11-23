// Durable thread -> topic/message map in apps/server/.data/telegram.json.
// Writes are serialised and atomic (temp file + rename) so a crash never leaves a
// half-written JSON file.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThreadAttention } from '../../../../shared/contract.js';

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
  attention: ThreadAttention;
  pointCount: number;
  headerMessageId?: number;
  headerText?: string;
  sourceMessageId?: string;
  sourceMessageIds: number[];
  parts: StoredPart[];
  reviewMessageId?: number;
  agreedAt?: string;
  updatedAt: string;
}

export interface TelegramState {
  version: 1;
  topics: Record<string, TopicRecord>;
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

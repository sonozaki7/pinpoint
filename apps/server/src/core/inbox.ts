import fs from 'node:fs';
import path from 'node:path';
import type { Deck, InboxItem, ThreadAttention } from '../../../../shared/contract.js';
import type { AttentionSource, AttentionThread, TelegramNotifier, T3Client } from './types.js';
import type { Env } from './env.js';
import type { DeckStore } from './decks.js';
import { buildDeck, deckFromPrecomputed } from './decks.js';
import type { ReviewStore } from './reviews.js';
import { makeGlance, toAscii } from './text.js';
import type { Splitter } from './splitter/types.js';

const ATTENTION_RANK: Record<ThreadAttention, number> = {
  question: 0,
  plan: 1,
  failed: 2,
  report: 3,
};

const SOURCE_TTL_MS = 5_000;
const NOTIFY_RETRY_MS = 5 * 60_000;
const LIVE_REFRESH_MS = 20_000;

export interface InboxDeps {
  env: Env;
  t3: T3Client;
  telegram: TelegramNotifier;
  splitter: Splitter;
  decks: DeckStore;
  reviews: ReviewStore;
  precomputed?: Map<string, Deck>;
}

export type DeckLookup =
  | { status: 'ready'; deck: Deck }
  | { status: 'pending' }
  | { status: 'missing' };

interface CachedSource {
  source: AttentionSource;
  at: number;
}

/**
 * Owns attention threads, deck warm-up, inbox sorting and one-time Telegram alerts.
 * Deck builds run one at a time so a slow splitter cannot spawn a burst of models.
 */
export class InboxService {
  private readonly env: Env;
  private readonly t3: T3Client;
  private readonly telegram: TelegramNotifier;
  private readonly splitter: Splitter;
  private readonly decks: DeckStore;
  private readonly reviews: ReviewStore;
  private readonly precomputed?: Map<string, Deck>;
  private readonly notified = new Set<string>();
  private readonly notifyFailures = new Map<string, number>();
  private readonly notifyTasks = new Set<Promise<void>>();
  private readonly notifiedFile: string;

  private readonly threads = new Map<string, AttentionThread>();
  private threadsPromise: Promise<AttentionThread[]> | null = null;
  private readonly sources = new Map<string, CachedSource>();
  private readonly sourcePromises = new Map<string, Promise<AttentionSource>>();
  private readonly builds = new Map<string, Promise<Deck>>();
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private notifiedSave: Promise<void> = Promise.resolve();

  constructor(deps: InboxDeps) {
    this.env = deps.env;
    this.t3 = deps.t3;
    this.telegram = deps.telegram;
    this.splitter = deps.splitter;
    this.decks = deps.decks;
    this.reviews = deps.reviews;
    this.precomputed = deps.precomputed;
    this.notifiedFile = path.join(deps.env.dataDir, 'notified.json');
  }

  async init(): Promise<void> {
    // Dry-run deliveries are not real posts, so they are deliberately not persisted:
    // enabling a bot later must still announce every current thread.
    if (this.telegram.mode === 'live') {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(this.notifiedFile, 'utf8'));
        if (Array.isArray(raw)) {
          for (const value of raw) if (typeof value === 'string') this.notified.add(value);
        }
      } catch {
        // No notification history yet.
      }
    }
    if (this.env.mode === 'live' && !this.timer) {
      this.timer = setInterval(() => {
        void this.listInbox().catch((error: unknown) => {
          console.warn(`[inbox] background refresh failed: ${(error as Error).message}`);
        });
      }, LIVE_REFRESH_MS);
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Warm decks and deliver any Telegram alerts that are still due. */
  async preload(): Promise<void> {
    await this.listInbox().catch((error: unknown) => {
      console.warn(`[inbox] preload failed: ${(error as Error).message}`);
    });
    await this.flush();
  }

  private async flush(): Promise<void> {
    await Promise.allSettled([...this.builds.values()]);
    while (this.notifyTasks.size > 0) {
      await Promise.allSettled([...this.notifyTasks]);
    }
    await this.notifiedSave;
  }

  async lookupThread(threadId: string): Promise<AttentionThread | undefined> {
    if (this.threads.has(threadId)) return this.threads.get(threadId);
    await this.refreshThreads().catch(() => []);
    return this.threads.get(threadId);
  }

  async sourceForThread(threadId: string): Promise<AttentionSource> {
    const thread = await this.lookupThread(threadId);
    if (!thread) throw new Error(`Unknown thread ${threadId}`);
    return this.fetchSource(thread);
  }

  private async refreshThreads(): Promise<AttentionThread[]> {
    if (this.threadsPromise) return this.threadsPromise;
    this.threadsPromise = (async () => {
      try {
        const list = await this.t3.listAttention();
        for (const thread of list) this.threads.set(thread.threadId, thread);
        return list;
      } finally {
        this.threadsPromise = null;
      }
    })();
    return this.threadsPromise;
  }

  private async fetchSource(thread: AttentionThread): Promise<AttentionSource> {
    const cached = this.sources.get(thread.threadId);
    if (cached && Date.now() - cached.at < SOURCE_TTL_MS) return cached.source;
    const loading = this.sourcePromises.get(thread.threadId);
    if (loading) return loading;

    const promise = this.t3
      .getSource(thread.threadId)
      .then((source) => {
        this.sources.set(thread.threadId, { source, at: Date.now() });
        return source;
      })
      .catch((error: unknown) => {
        if (cached) {
          console.warn(
            `[inbox] source refresh failed for ${thread.title}, using cached source: ${(error as Error).message}`,
          );
          return cached.source;
        }
        throw error;
      })
      .finally(() => {
        this.sourcePromises.delete(thread.threadId);
      });
    this.sourcePromises.set(thread.threadId, promise);
    return promise;
  }

  private sameDeck(a: Deck, b: Deck): boolean {
    if (a.sourceMessageId !== b.sourceMessageId || a.headline !== b.headline) return false;
    if (a.attention !== b.attention || a.title !== b.title) return false;
    if (a.points.length !== b.points.length) return false;
    return a.points.every((point, index) => {
      const other = b.points[index];
      return (
        point.kind === other.kind &&
        point.glance === other.glance &&
        point.quote === other.quote &&
        point.risk === other.risk &&
        point.questionId === other.questionId &&
        JSON.stringify(point.options ?? []) === JSON.stringify(other.options ?? [])
      );
    });
  }

  /** Demo fixture decks always win over an older on-disk copy. */
  private refreshPrecomputed(
    threads: AttentionThread[],
    sources: Map<string, AttentionSource | undefined>,
  ): void {
    if (!this.precomputed) return;
    for (const thread of threads) {
      const precomputed = this.precomputed.get(thread.threadId);
      const source = sources.get(thread.threadId);
      if (!precomputed || !source) continue;
      const fresh = deckFromPrecomputed(precomputed, thread, source);
      const cached = this.decks.getForThread(thread.threadId);
      if (!cached || !this.sameDeck(cached, fresh)) this.decks.put(fresh);
    }
  }

  private validDeck(thread: AttentionThread, source: AttentionSource): Deck | undefined {
    const byThread = this.decks.getForThread(thread.threadId);
    if (byThread && byThread.sourceMessageId === source.sourceMessageId) return byThread;
    const bySource = this.decks.getForSource(source.sourceMessageId);
    if (bySource) {
      this.decks.adopt(bySource);
      return bySource;
    }
    return undefined;
  }

  private ensureBuild(thread: AttentionThread, source: AttentionSource): Promise<Deck> {
    const existing = this.builds.get(thread.threadId);
    if (existing) return existing;

    const run = this.queue.then(async () => {
      const runStarted = Date.now();
      const precomputed = this.precomputed?.get(thread.threadId);
      const deck = precomputed
        ? deckFromPrecomputed(precomputed, thread, source)
        : await buildDeck(this.splitter, thread, source);
      this.decks.put(deck);
      console.info(
        `[inbox] deck for ${thread.title}: ${deck.points.length} points via ${deck.splitter} in ${Date.now() - runStarted}ms`,
      );
      void this.maybeNotify(thread, source, deck);
      return deck;
    });

    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    this.builds.set(thread.threadId, run);
    const cleanup = () => {
      if (this.builds.get(thread.threadId) === run) this.builds.delete(thread.threadId);
    };
    void run.then(cleanup, cleanup);
    return run;
  }

  isBuilding(threadId: string): boolean {
    return this.builds.has(threadId);
  }

  /**
   * GET /api/deck semantics: wait=false returns `pending` while a build runs,
   * wait=true builds if needed (used by preview/send/phone).
   */
  async getDeck(threadId: string, wait: boolean): Promise<DeckLookup> {
    const thread = await this.lookupThread(threadId);
    if (!thread) return { status: 'missing' };
    const source = await this.fetchSource(thread);
    if (this.precomputed?.has(thread.threadId)) {
      const precomputed = this.precomputed.get(thread.threadId)!;
      const fresh = deckFromPrecomputed(precomputed, thread, source);
      const cached = this.decks.getForThread(thread.threadId);
      if (!cached || !this.sameDeck(cached, fresh)) this.decks.put(fresh);
      void this.maybeNotify(thread, source, fresh);
      return { status: 'ready', deck: fresh };
    }
    const cached = this.validDeck(thread, source);
    if (cached) {
      void this.maybeNotify(thread, source, cached);
      return { status: 'ready', deck: cached };
    }

    if (wait) {
      let deck = await (this.builds.get(threadId) ?? this.ensureBuild(thread, source));
      if (deck.sourceMessageId !== source.sourceMessageId) {
        deck = await this.ensureBuild(thread, source);
      }
      return { status: 'ready', deck };
    }

    if (!this.builds.has(threadId)) {
      void this.ensureBuild(thread, source).catch((error: unknown) => {
        console.warn(`[inbox] deck build failed for ${thread.title}: ${(error as Error).message}`);
      });
    }
    return { status: 'pending' };
  }

  private maybeNotify(thread: AttentionThread, source: AttentionSource, deck: Deck): Promise<void> {
    const id = source.sourceMessageId;
    if (this.notified.has(id)) return Promise.resolve();
    const failureKey = `${thread.threadId}:${id}`;
    const lastFailure = this.notifyFailures.get(failureKey) ?? 0;
    if (Date.now() - lastFailure < NOTIFY_RETRY_MS) return Promise.resolve();

    const task = (async () => {
      try {
        await this.telegram.onAttention(thread, source, deck);
        this.notified.add(id);
        this.notifyFailures.delete(failureKey);
        if (this.telegram.mode === 'live') {
          this.notifiedSave = this.notifiedSave
            .then(() =>
              fs.promises.writeFile(
                this.notifiedFile,
                JSON.stringify([...this.notified], null, 2),
                'utf8',
              ),
            )
            .catch((error: unknown) => {
              console.warn(`[inbox] could not persist notifications: ${(error as Error).message}`);
            });
        }
      } catch (error) {
        this.notifyFailures.set(failureKey, Date.now());
        console.warn(
          `[inbox] telegram onAttention failed for ${thread.title}: ${(error as Error).message}`,
        );
      }
    })();
    this.notifyTasks.add(task);
    void task.finally(() => this.notifyTasks.delete(task));
    return task;
  }

  private summary(thread: AttentionThread, deck: Deck | undefined): string {
    const drafts = deck?.points.filter((point) => point.kind === 'draft').length ?? 0;
    let base: string;
    switch (thread.attention) {
      case 'plan':
        base = deck ? `plan, ${deck.points.length} steps` : 'plan';
        break;
      case 'question':
        base = 'question';
        break;
      case 'failed':
        base = 'run failed';
        break;
      case 'report':
        base = deck ? (drafts > 0 ? `${drafts} drafts` : `${deck.points.length} points`) : 'report';
        break;
    }
    return makeGlance(toAscii(base), 30);
  }

  /** GET /api/inbox. Also warms missing decks and posts pending Telegram alerts. */
  async listInbox(): Promise<{ items: InboxItem[]; updatedAt: string }> {
    const threads = await this.refreshThreads();
    const sourceEntries = await Promise.all(
      threads.map(async (thread) => {
        try {
          return [thread.threadId, await this.fetchSource(thread)] as const;
        } catch (error) {
          console.warn(
            `[inbox] no source for ${thread.title}: ${(error as Error).message}`,
          );
          return [thread.threadId, undefined] as const;
        }
      }),
    );
    const sources = new Map(sourceEntries);
    this.refreshPrecomputed(threads, sources);

    const items = await Promise.all(
      threads.map(async (thread): Promise<InboxItem> => {
        const source = sources.get(thread.threadId);
        const deck = source ? this.validDeck(thread, source) : undefined;
        if (source && !deck) {
          void this.ensureBuild(thread, source).catch((error: unknown) => {
            console.warn(`[inbox] deck build failed for ${thread.title}: ${(error as Error).message}`);
          });
        }
        if (source && deck) void this.maybeNotify(thread, source, deck);
        return {
          threadId: thread.threadId,
          title: thread.title,
          project: thread.project,
          attention: thread.attention,
          summary: this.summary(thread, deck),
          updatedAt: thread.updatedAt,
          deckReady: Boolean(deck),
          pointCount: deck?.points.length ?? 0,
          draftNotes: await this.reviews.noteCount(thread.threadId),
        };
      }),
    );

    items.sort((a, b) => {
      const rank = ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention];
      if (rank !== 0) return rank;
      const timeA = Date.parse(a.updatedAt) || 0;
      const timeB = Date.parse(b.updatedAt) || 0;
      if (timeA !== timeB) return timeB - timeA;
      return a.title.localeCompare(b.title);
    });

    return { items, updatedAt: new Date().toISOString() };
  }
}

import type {
  Deck,
  EditResult,
  InboxItem,
  Note,
  PreviewResult,
  ReviewDraft,
  SendResult,
} from '../../../../shared/contract.js';
import { composeReview } from '../core/composer.js';
import { deckFromPrecomputed, publicDeck } from '../core/decks.js';
import { applyDraftEdits, receiptName } from '../core/draft.js';
import { editSentence } from '../core/edit.js';
import { HttpError } from '../core/errors.js';
import { emptyDraft, mergeDraft } from '../core/reviews.js';
import { makeGlance, toAscii } from '../core/text.js';
import type { AttentionSource, AttentionThread } from '../core/types.js';
import { gmailReceipt, notionReceipt } from '../sources/receipts.js';
import { DeviceStore } from './deviceStore.js';
import {
  CLOUD_DEVICE_TTL_MS,
  CLOUD_MAX_DEVICES,
} from './limits.js';
import { buildSampleReply } from './reply.js';
import type { SampleWorkspaceDefinition } from './sample.js';

export interface WorkspaceDraftInput {
  sourceMessageId?: string;
  notes?: Note[];
  seen?: string[];
}

export interface InboxSnapshot {
  items: InboxItem[];
  updatedAt: string;
}

/**
 * One device's workspace. Phase 2 adds a desk implementation that relays to
 * the paired computer; the router below is the only place that chooses one.
 */
export interface DeviceWorkspace {
  readonly kind: 'sample' | 'desk';
  listInbox(): Promise<InboxSnapshot>;
  getDeck(threadId: string): Deck;
  sourceForThread(threadId: string): AttentionSource;
  getDraft(threadId: string): ReviewDraft;
  putDraft(threadId: string, input: WorkspaceDraftInput): ReviewDraft;
  /** Apply one spoken note to one draft sentence (deterministic, no LLM). */
  edit(threadId: string, pointId: string, text: string): Promise<EditResult>;
  preview(threadId: string): PreviewResult;
  send(threadId: string): Promise<SendResult>;
  phone(threadId: string, pointId: string): { ok: boolean; link?: string };
  reset(): void;
  dispose(): void;
}

export interface DeviceRouter {
  workspaceFor(deviceId: string): DeviceWorkspace;
  readonly deviceCount: number;
  sweep(): number;
  stop(): void;
}

interface ActiveThread {
  kind: 'base' | 'reply';
  thread: AttentionThread;
  source: AttentionSource;
  deck: Deck;
}

interface SentReview {
  threadId: string;
  message: string;
  deliveredAt: string;
}

function summaryFor(thread: AttentionThread, deck: Deck): string {
  const drafts = deck.points.filter((point) => point.kind === 'draft').length;
  if (thread.app === 'gmail') {
    return makeGlance(toAscii(`${drafts} draft${drafts === 1 ? '' : 's'}`), 30);
  }
  if (thread.app === 'notion') {
    return makeGlance(toAscii(`page, ${deck.points.length} points`), 30);
  }
  let base: string;
  switch (thread.attention) {
    case 'plan':
      base = `plan, ${deck.points.length} steps`;
      break;
    case 'question':
      base = 'question';
      break;
    case 'failed':
      base = 'run failed';
      break;
    case 'report':
      base = drafts > 0 ? `${drafts} drafts` : `${deck.points.length} points`;
      break;
  }
  return makeGlance(toAscii(base), 30);
}

/**
 * The sample agent workspace: fixture threads, per-device drafts and sends,
 * and one delayed agent reply after each plan/report/question send.
 *
 * Everything is in memory by design. A restart restores the sample, and a
 * reset restores it for one device without touching other devices.
 */
export class SampleDeviceWorkspace implements DeviceWorkspace {
  readonly kind = 'sample' as const;
  private readonly sample: SampleWorkspaceDefinition;
  private readonly replyMs: number;
  private active = new Map<string, ActiveThread>();
  private drafts = new Map<string, ReviewDraft>();
  private sentReviews: SentReview[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private sending = new Set<string>();
  private generation = 0;
  private disposed = false;

  constructor(options: { sample: SampleWorkspaceDefinition; replyMs: number }) {
    this.sample = options.sample;
    this.replyMs = Math.max(0, options.replyMs);
    this.reset();
  }

  reset(): void {
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.active.clear();
    this.drafts.clear();
    this.sentReviews = [];
    this.sending.clear();
    for (const definition of this.sample.threads) {
      this.active.set(definition.thread.threadId, {
        kind: 'base',
        thread: { ...definition.thread },
        source: definition.source,
        deck: deckFromPrecomputed(definition.deck, definition.thread, definition.source),
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.active.clear();
    this.drafts.clear();
    this.sentReviews = [];
    this.sending.clear();
  }

  private require(threadId: string): ActiveThread {
    const entry = this.active.get(threadId);
    if (!entry) throw new HttpError(404, `Unknown thread ${threadId}`, 'not_found');
    return entry;
  }

  async listInbox(): Promise<InboxSnapshot> {
    const items: InboxItem[] = [];
    for (const [threadId, entry] of this.active) {
      items.push({
        threadId,
        title: entry.thread.title,
        project: entry.thread.project,
        attention: entry.thread.attention,
        summary: entry.kind === 'reply' ? 'agent replied' : summaryFor(entry.thread, entry.deck),
        updatedAt: entry.thread.updatedAt,
        deckReady: true,
        pointCount: entry.deck.points.length,
        draftNotes: this.drafts.get(threadId)?.notes.length ?? 0,
        ...(entry.thread.app ? { app: entry.thread.app } : {}),
      });
    }
    return { items, updatedAt: new Date().toISOString() };
  }

  getDeck(threadId: string): Deck {
    return publicDeck(this.require(threadId).deck);
  }

  sourceForThread(threadId: string): AttentionSource {
    return this.require(threadId).source;
  }

  getDraft(threadId: string): ReviewDraft {
    const entry = this.require(threadId);
    return this.drafts.get(threadId) ?? emptyDraft(threadId, entry.deck.sourceMessageId);
  }

  putDraft(threadId: string, input: WorkspaceDraftInput): ReviewDraft {
    const entry = this.require(threadId);
    const existing = this.drafts.get(threadId) ?? null;
    const merged = mergeDraft(existing, threadId, {
      ...input,
      sourceMessageId: input.sourceMessageId ?? existing?.sourceMessageId ?? entry.deck.sourceMessageId,
    });
    this.drafts.set(threadId, merged);
    return merged;
  }

  async edit(threadId: string, pointId: string, text: string): Promise<EditResult> {
    const entry = this.require(threadId);
    const point = entry.deck.points.find((candidate) => candidate.id === pointId);
    if (!point) throw new HttpError(404, `Unknown point ${pointId}`, 'not_found');
    if (entry.thread.app !== 'gmail') {
      return {
        ok: false,
        pointId,
        before: point.quote,
        error: "This item can't be edited here",
      };
    }

    const draft = this.getDraft(threadId);
    const existing = draft.notes.find((note) => note.pointId === pointId);
    const before =
      existing?.after !== undefined && existing.after.length > 0 ? existing.after : point.quote;
    const result = await editSentence({ before, note: text });
    if (!result.ok) {
      return { ok: false, pointId, before, error: result.error ?? "Couldn't change this line" };
    }
    const after = result.method === 'delete' ? '' : result.after;
    if (after === undefined) {
      return { ok: false, pointId, before, error: "Couldn't change this line" };
    }
    const notes: Note[] = draft.notes.filter((note) => note.pointId !== pointId);
    notes.push({
      pointId,
      verdict: existing?.verdict ?? 'note',
      text: existing?.text ?? text,
      ...(existing?.option ? { option: existing.option } : {}),
      after,
    });
    this.drafts.set(
      threadId,
      mergeDraft(draft, threadId, {
        notes,
        sourceMessageId: entry.deck.sourceMessageId,
      }),
    );
    return {
      ok: true,
      pointId,
      before,
      after: result.after,
      ...(result.method ? { method: result.method } : {}),
    };
  }

  preview(threadId: string): PreviewResult {
    const entry = this.require(threadId);
    return composeReview(entry.deck, this.getDraft(threadId));
  }

  async send(threadId: string): Promise<SendResult> {
    if (this.sending.has(threadId)) {
      throw new HttpError(409, 'A review is already being sent for this thread', 'conflict');
    }
    this.sending.add(threadId);
    try {
      const entry = this.require(threadId);
      const draft = this.getDraft(threadId);
      const preview = composeReview(entry.deck, draft);

      this.sentReviews.push({
        threadId,
        message: preview.message,
        deliveredAt: new Date().toISOString(),
      });

      const receipt = this.sampleReceipt(entry, draft);
      this.drafts.delete(threadId);
      this.active.delete(threadId);

      // A T3 fixture thread gets one delayed agent reply. Notion pages and
      // Gmail drafts are the finished work itself: sending is the last step.
      const app = entry.thread.app ?? 't3';
      if (entry.kind === 'base' && app === 't3') {
        this.scheduleReply(threadId, entry.thread, entry.deck, draft);
      }

      return { ok: true, delivered: 'sample', ...(receipt ? { receipt } : {}) };
    } finally {
      this.sending.delete(threadId);
    }
  }

  /** What the sample send would have done, marked "(sample)" so nothing looks real. */
  private sampleReceipt(
    entry: ActiveThread,
    draft: ReviewDraft,
  ): SendResult['receipt'] | undefined {
    const app = entry.thread.app;
    const byId = new Set(entry.deck.points.map((point) => point.id));
    const notes = draft.notes.filter((note) => byId.has(note.pointId));
    const link = entry.source.target?.link;
    if (app === 'gmail') {
      const edited = applyDraftEdits(entry.source.text, entry.deck, draft);
      if (edited.applied > 0) {
        console.info(`[cloud sample] gmail: ${edited.applied} edit(s) applied; nothing was sent`);
      }
      const to =
        entry.source.target?.recipient ??
        receiptName(entry.thread.title.replace(/^draft reply to\s+/i, '').split(':')[0] ?? '');
      return gmailReceipt({ to, link, suffix: ' (sample)' });
    }
    if (app === 'notion') {
      return notionReceipt({
        comments: notes.length,
        failed: 0,
        name: entry.source.target?.name ?? entry.thread.title,
        status: notes.length > 0 ? 'Changes requested' : 'Approved',
        link,
        suffix: ' (sample)',
      });
    }
    return undefined;
  }

  private scheduleReply(
    threadId: string,
    thread: AttentionThread,
    deck: Deck,
    draft: ReviewDraft,
  ): void {
    const generation = this.generation;
    const timer = setTimeout(() => {
      this.timers.delete(threadId);
      if (this.disposed || generation !== this.generation) return;

      const reply = buildSampleReply({ thread, deck, draft });
      this.active.set(threadId, {
        kind: 'reply',
        thread: {
          ...thread,
          attention: 'report',
          updatedAt: new Date().toISOString(),
        },
        source: reply.source,
        deck: reply.deck,
      });
    }, this.replyMs);
    this.timers.set(threadId, timer);
  }

  phone(threadId: string, pointId: string): { ok: boolean; link?: string } {
    const deck = this.require(threadId).deck;
    if (!deck.points.some((point) => point.id === pointId)) {
      throw new HttpError(404, `Unknown point ${pointId}`, 'not_found');
    }
    // The sample workspace has no Telegram topic to link to.
    return { ok: false };
  }
}

export interface SampleDeviceRouterOptions {
  sample: SampleWorkspaceDefinition;
  replyMs: number;
  maxDevices?: number;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Phase-2 seam: one router per cloud process decides which kind of workspace a
 * device sees. Today every device gets a private sample workspace; a desk
 * router can later choose a relay-backed workspace for paired devices.
 */
export class SampleDeviceRouter implements DeviceRouter {
  private readonly store: DeviceStore<SampleDeviceWorkspace>;

  constructor(options: SampleDeviceRouterOptions) {
    this.store = new DeviceStore<SampleDeviceWorkspace>({
      maxDevices: options.maxDevices ?? CLOUD_MAX_DEVICES,
      ttlMs: options.ttlMs ?? CLOUD_DEVICE_TTL_MS,
      create: () =>
        new SampleDeviceWorkspace({ sample: options.sample, replyMs: options.replyMs }),
      dispose: (workspace) => workspace.dispose(),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  workspaceFor(deviceId: string): DeviceWorkspace {
    return this.store.get(deviceId);
  }

  get deviceCount(): number {
    return this.store.size;
  }

  sweep(): number {
    return this.store.sweep();
  }

  stop(): void {
    this.store.clear();
  }
}

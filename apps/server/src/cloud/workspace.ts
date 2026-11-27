import { randomUUID } from 'node:crypto';
import type {
  AgentStatus,
  AskResult,
  Deck,
  EditResult,
  InboxItem,
  Note,
  PreviewResult,
  ReviewDraft,
  SendResult,
  TaskResult,
} from '../../../../shared/contract.js';
import type { LlmConnector } from '../connectors/types.js';
import {
  buildCatchUp,
  CATCH_UP_ID,
  CATCH_UP_TITLE,
  type CatchUp,
} from '../core/activity.js';
import { askOutput } from '../core/ask.js';
import { composeReview } from '../core/composer.js';
import { deckFromPrecomputed, publicDeck } from '../core/decks.js';
import { applyDraftEdits, receiptName } from '../core/draft.js';
import { editSentence } from '../core/edit.js';
import { HttpError } from '../core/errors.js';
import { formatNeedsSummary, needsYouCount } from '../core/evidence.js';
import { emptyDraft, mergeDraft } from '../core/reviews.js';
import { RevisionTracker } from '../core/revisions.js';
import { buildSampleTaskResult, normalizeTaskText, taskTitle } from '../core/task.js';
import { clipText, makeGlance, oneLine, toAscii } from '../core/text.js';
import type { AttentionSource, AttentionThread } from '../core/types.js';
import { gmailReceipt, notionReceipt } from '../sources/receipts.js';
import { DeviceStore } from './deviceStore.js';
import {
  CLOUD_DEVICE_TTL_MS,
  CLOUD_MAX_DEVICES,
} from './limits.js';
import { buildSampleReply } from './reply.js';
import {
  DEFAULT_PERSONA,
  type SamplePersona,
  type SampleThreadDefinition,
  type SampleWorkspaceDefinition,
} from './sample.js';

export interface WorkspaceDraftInput {
  sourceMessageId?: string;
  notes?: Note[];
  seen?: string[];
}

export interface InboxSnapshot {
  items: InboxItem[];
  /** The glance line across all agents (sample numbers in the cloud sample). */
  status: AgentStatus;
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
  /** Exact-sentence Ask; `llm:false` forces retrieval-only (budget or no key). */
  ask(threadId: string, question: string, options?: { llm?: boolean }): Promise<AskResult>;
  getDraft(threadId: string): ReviewDraft;
  putDraft(threadId: string, input: WorkspaceDraftInput): ReviewDraft;
  /** Apply one spoken note to one draft sentence (deterministic, no LLM). */
  edit(threadId: string, pointId: string, text: string): Promise<EditResult>;
  preview(threadId: string): PreviewResult;
  send(threadId: string): Promise<SendResult>;
  phone(threadId: string, pointId: string): { ok: boolean; link?: string };
  /** Hand off a new task by voice; the sample only simulates it, and says so. */
  task(text: string): Promise<TaskResult>;
  reset(): void;
  dispose(): void;
}

export interface DeviceRouter {
  workspaceFor(deviceId: string, persona?: SamplePersona): DeviceWorkspace;
  readonly deviceCount: number;
  sweep(): number;
  stop(): void;
}

interface ActiveThread {
  /** base: fixture · reply: the agent's answer · revised: a plan changed by your review · task: a hand-off result */
  kind: 'base' | 'reply' | 'revised' | 'task';
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
  let base: string;
  if (thread.app === 'gmail') {
    base = `${drafts} line${drafts === 1 ? '' : 's'}`;
  } else if (thread.app === 'notion') {
    base = `${deck.points.length} points`;
  } else {
    switch (thread.attention) {
      case 'plan':
        base = `${deck.points.length} steps`;
        break;
      case 'question':
        base = 'question';
        break;
      case 'failed':
        base = 'run failed';
        break;
      case 'report':
        base = drafts > 0 ? `${drafts} draft${drafts === 1 ? '' : 's'}` : `${deck.points.length} points`;
        break;
    }
  }
  return formatNeedsSummary(base, needsYouCount(deck.points));
}

const MAX_SAMPLE_TASKS = 5;
const REVISION_NOTE_CHARS = 150;

/**
 * The sample agent workspace: fixture threads, per-device drafts and sends,
 * one delayed agent reply (or revised plan) after each send, simulated voice
 * hand-offs, and a "Since you looked" line per agent update.
 *
 * Everything is in memory by design. A restart restores the sample, and a
 * reset restores it for one device without touching other devices.
 */
export class SampleDeviceWorkspace implements DeviceWorkspace {
  readonly kind = 'sample' as const;
  private readonly sample: SampleWorkspaceDefinition;
  private readonly replyMs: number;
  private readonly taskMs: number;
  private readonly persona: SamplePersona;
  private readonly llm?: LlmConnector;
  private readonly revisions = new RevisionTracker();
  private active = new Map<string, ActiveThread>();
  /** Fixture threads that only a catch-up line points at; opening one is allowed, listing it is not. */
  private hidden = new Map<string, ActiveThread>();
  private drafts = new Map<string, ReviewDraft>();
  private sentReviews: SentReview[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private sending = new Set<string>();
  private seenCatchUp = new Set<string>();
  private pendingTasks = 0;
  private taskSeq = 0;
  private generation = 0;
  private disposed = false;

  constructor(options: {
    sample: SampleWorkspaceDefinition;
    replyMs: number;
    taskMs?: number;
    persona?: SamplePersona;
    llm?: LlmConnector;
  }) {
    this.sample = options.sample;
    this.replyMs = Math.max(0, options.replyMs);
    this.taskMs = Math.max(0, options.taskMs ?? 6_000);
    this.persona = options.persona ?? DEFAULT_PERSONA;
    this.llm = options.llm;
    this.reset();
  }

  reset(): void {
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.active.clear();
    this.hidden.clear();
    this.drafts.clear();
    this.sentReviews = [];
    this.sending.clear();
    this.seenCatchUp.clear();
    this.pendingTasks = 0;
    this.revisions.clear();
    for (const id of this.sample.personas[this.persona]) {
      const definition = this.sample.byId.get(id);
      if (definition) this.active.set(id, this.fromDefinition(definition));
    }
    for (const entry of this.sample.catchUp[this.persona]) {
      const definition = this.sample.byId.get(entry.threadRef);
      if (definition && !this.active.has(entry.threadRef)) {
        this.hidden.set(entry.threadRef, this.fromDefinition(definition));
      }
    }
  }

  private fromDefinition(definition: SampleThreadDefinition): ActiveThread {
    return {
      kind: 'base',
      thread: { ...definition.thread },
      source: definition.source,
      deck: deckFromPrecomputed(definition.deck, definition.thread, definition.source),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.active.clear();
    this.hidden.clear();
    this.drafts.clear();
    this.sentReviews = [];
    this.sending.clear();
  }

  /** Unseen "Since you looked" lines for this device. */
  private catchUp(): CatchUp | undefined {
    return buildCatchUp(
      this.sample.catchUp[this.persona].filter((entry) => !this.seenCatchUp.has(entry.key)),
    );
  }

  private require(threadId: string): ActiveThread {
    if (threadId === CATCH_UP_ID) {
      const catchUp = this.catchUp();
      if (!catchUp) throw new HttpError(404, 'Nothing new since you looked', 'not_found');
      return { kind: 'base', thread: catchUp.thread, source: catchUp.source, deck: catchUp.deck };
    }
    const entry = this.active.get(threadId) ?? this.hidden.get(threadId);
    if (!entry) throw new HttpError(404, `Unknown thread ${threadId}`, 'not_found');
    return entry;
  }

  async listInbox(): Promise<InboxSnapshot> {
    const items: InboxItem[] = [];
    for (const [threadId, entry] of this.active) {
      const needs = needsYouCount(entry.deck.points);
      const changed = entry.deck.points.filter((point) => point.changed).length;
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
        ...(needs > 0 ? { needsYou: needs } : {}),
        ...(changed > 0 ? { changed } : {}),
      });
    }
    const status: AgentStatus = {
      needYou: items.length,
      ...this.sample.status[this.persona],
    };
    const catchUp = this.catchUp();
    if (catchUp) {
      const count = catchUp.entries.length;
      const needs = catchUp.entries.filter((entry) => entry.needsYou).length;
      items.unshift({
        threadId: CATCH_UP_ID,
        title: CATCH_UP_TITLE,
        project: catchUp.thread.project,
        attention: 'report',
        summary: formatNeedsSummary(`${count} update${count === 1 ? '' : 's'}`, needs),
        updatedAt: catchUp.thread.updatedAt,
        deckReady: true,
        pointCount: count,
        draftNotes: 0,
        kind: 'catch-up',
        ...(needs > 0 ? { needsYou: needs } : {}),
      });
    }
    return { items, status, updatedAt: new Date().toISOString() };
  }

  getDeck(threadId: string): Deck {
    return publicDeck(this.require(threadId).deck);
  }

  sourceForThread(threadId: string): AttentionSource {
    return this.require(threadId).source;
  }

  async ask(
    threadId: string,
    question: string,
    options: { llm?: boolean } = {},
  ): Promise<AskResult> {
    const entry = this.require(threadId);
    return askOutput({
      question,
      sourceText: entry.source.text,
      points: entry.deck.points,
      ...(options.llm !== false && this.llm ? { llm: this.llm } : {}),
    });
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
      if (threadId === CATCH_UP_ID) return this.markCatchUpSeen();
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
      this.hidden.delete(threadId);
      this.revisions.remember(entry.deck);

      // A T3 thread gets one delayed agent answer: a revised plan when you
      // objected to a plan step, a short reply otherwise. Notion pages and
      // Gmail drafts are the finished work itself: sending is the last step.
      const app = entry.thread.app ?? 't3';
      if (entry.kind !== 'reply' && app === 't3') this.scheduleAnswer(threadId, entry, draft);

      return { ok: true, delivered: 'sample', ...(receipt ? { receipt } : {}) };
    } finally {
      this.sending.delete(threadId);
    }
  }

  private markCatchUpSeen(): SendResult {
    const catchUp = this.catchUp();
    for (const entry of catchUp?.entries ?? []) this.seenCatchUp.add(entry.key);
    this.drafts.delete(CATCH_UP_ID);
    const count = catchUp?.entries.length ?? 0;
    return {
      ok: true,
      delivered: 'sample',
      receipt: {
        lines: [
          { app: 't3', text: `Marked ${count} update${count === 1 ? '' : 's'} seen (sample)`, ok: true },
        ],
      },
    };
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

  /**
   * The plan the sample agent comes back with after you objected: your note
   * replaces the objected step, every other step stays word for word, so only
   * that one line shows up as "changed since your review".
   */
  private revisedPlan(entry: ActiveThread, draft: ReviewDraft): ActiveThread | undefined {
    if (entry.thread.attention !== 'plan') return undefined;
    let text = entry.source.text;
    const points = entry.deck.points.map((point) => ({ ...point }));
    let replaced = 0;
    for (const note of draft.notes) {
      const point = points.find((candidate) => candidate.id === note.pointId);
      const original = entry.deck.points.find((candidate) => candidate.id === note.pointId);
      const said = note.verdict === 'object' ? toAscii(oneLine(note.text ?? '')) : '';
      if (!point || !original || said.length === 0 || !text.includes(original.quote)) continue;
      const sentence = `As you asked: ${clipText(said, REVISION_NOTE_CHARS)}`;
      text = text.replace(original.quote, () => sentence);
      point.quote = sentence;
      point.glance = makeGlance(sentence, 44);
      point.kind = 'step';
      delete point.risk;
      delete point.flag;
      delete point.why;
      replaced += 1;
    }
    if (replaced === 0) return undefined;
    const now = new Date();
    const thread: AttentionThread = { ...entry.thread, updatedAt: now.toISOString() };
    const source: AttentionSource = {
      ...entry.source,
      sourceMessageId: `sample-revision-${randomUUID()}`,
      text,
    };
    const built = deckFromPrecomputed({ ...entry.deck, points }, thread, source);
    return {
      kind: 'revised',
      thread,
      source,
      deck: this.revisions.annotate(thread.threadId, {
        ...built,
        headline: makeGlance(`${thread.title}: revised plan`, 44),
      }),
    };
  }

  private scheduleAnswer(threadId: string, entry: ActiveThread, draft: ReviewDraft): void {
    const generation = this.generation;
    const timer = setTimeout(() => {
      this.timers.delete(threadId);
      if (this.disposed || generation !== this.generation) return;

      const revised = this.revisedPlan(entry, draft);
      if (revised) {
        this.active.set(threadId, revised);
        return;
      }
      const reply = buildSampleReply({ thread: entry.thread, deck: entry.deck, draft });
      this.active.set(threadId, {
        kind: 'reply',
        thread: {
          ...entry.thread,
          attention: 'report',
          updatedAt: new Date().toISOString(),
        },
        source: reply.source,
        deck: reply.deck,
      });
    }, this.replyMs);
    this.timers.set(threadId, timer);
  }

  /** POST /api/task in the sample: a result shows up after a few seconds, marked as a sample. */
  async task(raw: string): Promise<TaskResult> {
    const text = normalizeTaskText(raw);
    if (!text) return { ok: false, error: 'Say what you want done.' };
    if (this.pendingTasks >= MAX_SAMPLE_TASKS) {
      return { ok: false, error: 'Wait for your earlier tasks first.' };
    }
    this.taskSeq += 1;
    this.pendingTasks += 1;
    const id = `sample-task-${this.taskSeq}`;
    // "Find a dentist open (sample)": the mark always fits inside 30 characters.
    const title = `${clipText(taskTitle(text), 21).replace(/[\s,;:-]+$/g, '')} (sample)`;
    const generation = this.generation;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      if (this.disposed || generation !== this.generation) return;
      this.pendingTasks = Math.max(0, this.pendingTasks - 1);
      const result = buildSampleTaskResult(text, { id, title });
      this.active.set(id, { kind: 'task', ...result });
    }, this.taskMs);
    this.timers.set(id, timer);
    return { ok: true, threadId: id, title, agent: 'Sample agent' };
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
  taskMs?: number;
  llm?: LlmConnector;
  maxDevices?: number;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Phase-2 seam: one router per cloud process decides which kind of workspace a
 * device sees. Today every device gets a private sample workspace (one per
 * persona it asks for); a desk router can later choose a relay-backed one.
 */
export class SampleDeviceRouter implements DeviceRouter {
  private readonly store: DeviceStore<SampleDeviceWorkspace>;

  constructor(options: SampleDeviceRouterOptions) {
    this.store = new DeviceStore<SampleDeviceWorkspace>({
      maxDevices: options.maxDevices ?? CLOUD_MAX_DEVICES,
      ttlMs: options.ttlMs ?? CLOUD_DEVICE_TTL_MS,
      create: (key) =>
        new SampleDeviceWorkspace({
          sample: options.sample,
          replyMs: options.replyMs,
          ...(options.taskMs === undefined ? {} : { taskMs: options.taskMs }),
          persona: key.split(':', 1)[0] as SamplePersona,
          ...(options.llm ? { llm: options.llm } : {}),
        }),
      dispose: (workspace) => workspace.dispose(),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  workspaceFor(deviceId: string, persona: SamplePersona = DEFAULT_PERSONA): DeviceWorkspace {
    return this.store.get(`${persona}:${deviceId}`);
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

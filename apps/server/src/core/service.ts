import type {
  Deck,
  Health,
  PreviewResult,
  ReviewDraft,
  SendResult,
} from '../../../../shared/contract.js';
import { allAgreedReview, composeReview } from './composer.js';
import type { DeckStore } from './decks.js';
import type { Env } from './env.js';
import { HttpError, errorMessage } from './errors.js';
import { InboxService, type DeckLookup } from './inbox.js';
import { emptyDraft, mergeDraft, normalizeDraft } from './reviews.js';
import type { ReviewStore } from './reviews.js';
import type { Splitter } from './splitter/types.js';
import type { AttentionThread, TelegramNotifier, T3Client } from './types.js';
import type { VoiceHint, VoiceTranscriber } from '../voice/service.js';
import { verdictForTranscript } from '../voice/verdict.js';

export interface ServiceDeps {
  env: Env;
  t3: T3Client;
  t3Live: boolean;
  telegram: TelegramNotifier;
  splitter: Splitter;
  decks: DeckStore;
  reviews: ReviewStore;
  voice: VoiceTranscriber;
  precomputed?: Map<string, Deck>;
}

interface DraftInput {
  sourceMessageId?: string;
  notes?: ReviewDraft['notes'];
  seen?: string[];
}

const PHONE_AGREE_MESSAGE = '✓ Reviewed on phone: all points agreed. Continue.';

/** The T3 web app's plan-implementation prefix (see docs/t3-api-notes.md §4). */
const PLAN_IMPLEMENT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:\n';

export class PinpointService {
  readonly env: Env;
  readonly inbox: InboxService;
  private readonly t3: T3Client;
  private readonly t3Live: boolean;
  private readonly telegram: TelegramNotifier;
  private readonly splitter: Splitter;
  private readonly decks: DeckStore;
  private readonly reviews: ReviewStore;
  private readonly voice: VoiceTranscriber;
  private t3Probe: { at: number; value: Health['t3'] } | null = null;
  private telegramStarted = false;
  /** Thread ids with a send in flight, so a double tap cannot post twice. */
  private readonly sends = new Set<string>();

  constructor(deps: ServiceDeps) {
    this.env = deps.env;
    this.t3 = deps.t3;
    this.t3Live = deps.t3Live;
    this.telegram = deps.telegram;
    this.splitter = deps.splitter;
    this.decks = deps.decks;
    this.reviews = deps.reviews;
    this.voice = deps.voice;
    this.inbox = new InboxService({
      env: deps.env,
      t3: deps.t3,
      telegram: deps.telegram,
      splitter: deps.splitter,
      decks: deps.decks,
      reviews: deps.reviews,
      precomputed: deps.precomputed,
    });
  }

  async start(): Promise<void> {
    try {
      await this.telegram.start();
      this.telegramStarted = true;
    } catch (error) {
      this.telegramStarted = false;
      console.warn(`[service] telegram start failed: ${errorMessage(error)}`);
    }
    await this.inbox.init();
  }

  async preload(): Promise<void> {
    await this.inbox.preload();
  }

  async stop(): Promise<void> {
    await this.inbox.stop();
    try {
      await this.telegram.stop();
    } catch (error) {
      console.warn(`[service] telegram stop failed: ${errorMessage(error)}`);
    }
  }

  async health(): Promise<Health> {
    let telegram: Health['telegram'];
    if (this.telegram.mode === 'dry-run') telegram = 'dry-run';
    else telegram = this.telegramStarted ? 'ok' : 'error';
    return {
      ok: true,
      mode: this.env.mode,
      t3: await this.probeT3(),
      telegram,
      splitter: this.splitter.label,
    };
  }

  private async probeT3(): Promise<Health['t3']> {
    if (this.env.mode === 'demo' || !this.t3Live) return 'off';
    if (this.t3Probe && Date.now() - this.t3Probe.at < 10_000) return this.t3Probe.value;
    const probe = this.t3.listAttention().then(
      (): Health['t3'] => 'ok',
      (error: unknown): Health['t3'] =>
        /401|403|unauthor|forbidden|bearer|token/i.test(errorMessage(error))
          ? 'unauthorized'
          : 'unreachable',
    );
    const timeout = new Promise<Health['t3']>((resolve) => {
      const timer = setTimeout(() => resolve('unreachable'), 2_500);
      timer.unref?.();
    });
    const value = await Promise.race([probe, timeout]);
    this.t3Probe = { at: Date.now(), value };
    return value;
  }

  async listInbox() {
    return this.inbox.listInbox();
  }

  async getDeckHttp(threadId: string): Promise<DeckLookup> {
    try {
      return await this.inbox.getDeck(threadId, false);
    } catch (error) {
      throw new HttpError(502, `Could not load deck: ${errorMessage(error)}`, 't3_error');
    }
  }

  private async requireThread(threadId: string): Promise<AttentionThread> {
    let thread: AttentionThread | undefined;
    try {
      thread = await this.inbox.lookupThread(threadId);
    } catch (error) {
      throw new HttpError(502, `Could not reach T3: ${errorMessage(error)}`, 't3_error');
    }
    if (!thread) throw new HttpError(404, `Unknown thread ${threadId}`, 'not_found');
    return thread;
  }

  private async requireDeck(threadId: string): Promise<Deck> {
    let lookup: DeckLookup;
    try {
      lookup = await this.inbox.getDeck(threadId, true);
    } catch (error) {
      throw new HttpError(502, `Could not build deck: ${errorMessage(error)}`, 'splitter_error');
    }
    if (lookup.status === 'missing') {
      throw new HttpError(404, `Unknown thread ${threadId}`, 'not_found');
    }
    if (lookup.status === 'pending') {
      throw new HttpError(503, 'Deck is still being built', 'pending');
    }
    return lookup.deck;
  }

  private async draftFor(threadId: string, deck: Deck): Promise<ReviewDraft> {
    const existing = await this.reviews.get(threadId);
    return normalizeDraft({
      ...(existing ?? emptyDraft(threadId)),
      threadId,
      sourceMessageId: deck.sourceMessageId,
    });
  }

  async getDraft(threadId: string): Promise<ReviewDraft> {
    const existing = await this.reviews.get(threadId);
    if (existing) return existing;
    const deck = this.decks.getForThread(threadId);
    if (deck) return emptyDraft(threadId, deck.sourceMessageId);
    // Same privacy gate as PUT: a guessed thread id outside T3_PROJECTS is a
    // 404, not an empty draft that confirms the id exists.
    let known = false;
    try {
      known = Boolean(await this.inbox.lookupThread(threadId));
    } catch {
      known = false;
    }
    if (!known) throw new HttpError(404, `Unknown thread ${threadId}`, 'not_found');
    return emptyDraft(threadId);
  }

  async putDraft(threadId: string, input: DraftInput): Promise<ReviewDraft> {
    const existing = await this.reviews.get(threadId);
    const knownDeck = this.decks.getForThread(threadId);
    let found = false;
    try {
      found = Boolean(await this.inbox.lookupThread(threadId));
    } catch {
      found = false;
    }
    if (!found && !knownDeck && !existing) {
      throw new HttpError(404, `Unknown thread ${threadId}`, 'not_found');
    }
    const sourceMessageId =
      input.sourceMessageId ?? knownDeck?.sourceMessageId ?? existing?.sourceMessageId ?? '';
    const merged = mergeDraft(existing, threadId, { ...input, sourceMessageId });
    return this.reviews.put(merged);
  }

  async preview(threadId: string): Promise<PreviewResult> {
    const deck = await this.requireDeck(threadId);
    const draft = await this.draftFor(threadId, deck);
    return composeReview(deck, draft);
  }

  async send(threadId: string): Promise<SendResult> {
    // Register before the first await: two requests that arrive together must
    // not both compose and deliver the same draft.
    if (this.sends.has(threadId)) {
      throw new HttpError(409, 'A review is already being sent for this thread', 'conflict');
    }
    this.sends.add(threadId);
    try {
      return await this.sendOnce(threadId);
    } finally {
      this.sends.delete(threadId);
    }
  }

  private async sendOnce(threadId: string): Promise<SendResult> {
    const thread = await this.requireThread(threadId);
    const deck = await this.requireDeck(threadId);
    const draft = await this.draftFor(threadId, deck);
    const preview = composeReview(deck, draft);
    const delivered: SendResult['delivered'] = this.env.mode === 'demo' ? 'demo-log' : 't3';

    let source: Awaited<ReturnType<InboxService['sourceForThread']>> | undefined;
    try {
      source = await this.inbox.sourceForThread(threadId);
    } catch (error) {
      console.warn(`[service] source unavailable for send: ${errorMessage(error)}`);
    }

    try {
      await this.deliver(thread, deck, draft, preview.message, source);
    } catch (error) {
      return { ok: false, delivered, error: errorMessage(error) };
    }

    let telegramLink: string | undefined;
    let telegramError: string | undefined;
    try {
      const result = await this.telegram.onReviewSent(thread, deck, draft, preview.message);
      telegramLink = result.link;
    } catch (error) {
      telegramError = errorMessage(error);
      console.warn(`[service] telegram onReviewSent failed: ${telegramError}`);
    }

    await this.reviews.clear(threadId);
    return {
      ok: true,
      delivered,
      ...(telegramLink ? { telegramLink } : {}),
      ...(telegramError ? { error: `Telegram: ${telegramError}` } : {}),
    };
  }

  private async deliver(
    thread: AttentionThread,
    deck: Deck,
    draft: ReviewDraft,
    message: string,
    source: Awaited<ReturnType<InboxService['sourceForThread']>> | undefined,
  ): Promise<void> {
    if (source?.kind === 'question' && source.question) {
      const answers: Record<string, string> = {};
      for (const question of source.question.questions) {
        const point = deck.points.find((candidate) => candidate.questionId === question.id);
        const note = point
          ? draft.notes.find((candidate) => candidate.pointId === point.id)
          : undefined;
        const chosen = note?.option ?? note?.text ?? question.options[0];
        if (chosen) answers[question.id] = chosen;
      }
      if (Object.keys(answers).length > 0) {
        await this.t3.answerQuestion(thread.threadId, source.question.requestId, answers);
      }
      const hasComment = draft.notes.some((note) => note.verdict !== 'answer');
      if (hasComment) await this.t3.sendMessage(thread.threadId, message);
      return;
    }

    // Plan approval (SPEC §6, docs/t3-api-notes.md §4): with no objections the
    // user is saying "implement it", so send the plan the way the T3 web app
    // does, with sourcePlanRef. Reviewer notes ride along in the same message.
    if (source?.kind === 'plan') {
      const objections = draft.notes.filter((note) => note.verdict === 'object');
      if (objections.length === 0) {
        const notes = draft.notes
          .map((note) => {
            const point = deck.points.find((candidate) => candidate.id === note.pointId);
            if (!point) return null;
            const text = (note.option ?? note.text ?? '').trim();
            return `● ${point.index}. "${point.quote.slice(0, 140)}" → ${text || 'Note.'}`;
          })
          .filter((line): line is string => line !== null);
        const extra =
          notes.length > 0 ? `\n\nReviewer notes from Pinpoint:\n${notes.join('\n')}` : '';
        await this.t3.sendMessage(
          thread.threadId,
          `${PLAN_IMPLEMENT_PREFIX}${source.text.trim()}${extra}`,
          { sourcePlanId: source.sourceMessageId },
        );
        console.info(`[service] approved plan for ${thread.title} (no objections)`);
        return;
      }
    }

    await this.t3.sendMessage(thread.threadId, message);
  }

  async phone(threadId: string, pointId: string): Promise<{ ok: boolean; link?: string }> {
    const thread = await this.requireThread(threadId);
    const deck = await this.requireDeck(threadId);
    const point = deck.points.find((candidate) => candidate.id === pointId);
    if (!point) throw new HttpError(404, `Unknown point ${pointId}`, 'not_found');
    try {
      const result = await this.telegram.readOnPhone(thread, deck, point);
      return { ok: true, ...(result.link ? { link: result.link } : {}) };
    } catch (error) {
      throw new HttpError(502, `Telegram: ${errorMessage(error)}`, 'telegram_error');
    }
  }

  /** Phone-side "Agree all & continue" shortcut (SPEC §11). */
  async agreeAll(thread: AttentionThread): Promise<void> {
    const deck = await this.requireDeck(thread.threadId);
    let source: Awaited<ReturnType<InboxService['sourceForThread']>> | undefined;
    try {
      source = await this.inbox.sourceForThread(thread.threadId);
    } catch {
      source = undefined;
    }
    if (source?.kind === 'question' && source.question) {
      const answers: Record<string, string> = {};
      for (const question of source.question.questions) {
        if (question.options[0]) answers[question.id] = question.options[0];
      }
      if (Object.keys(answers).length > 0) {
        await this.t3.answerQuestion(thread.threadId, source.question.requestId, answers);
      }
    }
    await this.t3.sendMessage(thread.threadId, PHONE_AGREE_MESSAGE);
    await this.reviews.clear(thread.threadId);
    console.info(`[service] agree-all from phone for ${thread.title}`);
  }

  async transcribe(audio: Buffer, hint?: VoiceHint): Promise<{ text: string; verdict: 'object' | 'note' }> {
    try {
      const result = await this.voice.transcribe(audio, hint);
      return { text: result.text, verdict: verdictForTranscript(result.text) };
    } catch (error) {
      throw new HttpError(502, errorMessage(error), 'voice_error');
    }
  }
}

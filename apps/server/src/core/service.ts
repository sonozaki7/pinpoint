import type {
  Deck,
  EditResult,
  Health,
  Note,
  PreviewResult,
  ReviewDraft,
  SendResult,
} from '../../../../shared/contract.js';
import { composeReview } from './composer.js';
import type { DeckStore } from './decks.js';
import { publicDeck } from './decks.js';
import type { Env } from './env.js';
import { HttpError, errorMessage } from './errors.js';
import { InboxService, type DeckLookup } from './inbox.js';
import { emptyDraft, mergeDraft, normalizeDraft } from './reviews.js';
import type { ReviewStore } from './reviews.js';
import type { Splitter } from './splitter/types.js';
import { runOpencode } from './splitter/opencode.js';
import type { SentenceRewrite } from './edit.js';
import type { AppId } from '../../../../shared/contract.js';
import type { AttentionThread, TelegramNotifier, T3Client } from './types.js';
import type { VoiceHint, VoiceTranscriber } from '../voice/service.js';
import { verdictForTranscript } from '../voice/verdict.js';
import { T3ReviewSource } from '../sources/t3.js';
import type { ReviewSource } from '../sources/types.js';

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
  /** Every configured review source. Default: T3 only (keeps demo/tests unchanged). */
  sources?: ReviewSource[];
  /** Test hook for the one-sentence LLM fallback; live defaults to the opencode path. */
  editLlm?: SentenceRewrite;
}

interface DraftInput {
  sourceMessageId?: string;
  notes?: ReviewDraft['notes'];
  seen?: string[];
}

const PHONE_AGREE_MESSAGE = '✓ Reviewed on phone: all points agreed. Continue.';

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
  private readonly sources: ReviewSource[];
  private readonly editLlm?: SentenceRewrite;
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
    this.sources = deps.sources ?? [new T3ReviewSource(deps.t3, { demo: deps.env.mode === 'demo' })];
    this.editLlm =
      deps.editLlm ??
      (deps.env.mode === 'live' && deps.env.splitterProvider !== 'fixture'
        ? async ({ system, user }) =>
            runOpencode(`${system}\n\n${user}`, deps.env.splitterModel, 20_000)
        : undefined);
    this.inbox = new InboxService({
      env: deps.env,
      sources: this.sources,
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
      const lookup = await this.inbox.getDeck(threadId, false);
      return lookup.status === 'ready' ? { status: 'ready', deck: publicDeck(lookup.deck) } : lookup;
    } catch (error) {
      throw new HttpError(502, `Could not load deck: ${errorMessage(error)}`, 't3_error');
    }
  }

  private async requireThread(threadId: string): Promise<AttentionThread> {
    let thread: AttentionThread | undefined;
    try {
      thread = await this.inbox.lookupThread(threadId);
    } catch (error) {
      throw new HttpError(502, `Could not load review items: ${errorMessage(error)}`, 'source_error');
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

  async send(
    threadId: string,
    options: { via?: 'g2' | 'telegram' } = {},
  ): Promise<SendResult> {
    // Register before the first await: two requests that arrive together must
    // not both compose and deliver the same draft.
    if (this.sends.has(threadId)) {
      throw new HttpError(409, 'A review is already being sent for this thread', 'conflict');
    }
    this.sends.add(threadId);
    try {
      return await this.sendOnce(threadId, options.via ?? 'g2');
    } finally {
      this.sends.delete(threadId);
    }
  }

  private async sendOnce(threadId: string, via: 'g2' | 'telegram'): Promise<SendResult> {
    const thread = await this.requireThread(threadId);
    const deck = await this.requireDeck(threadId);
    const draft = await this.draftFor(threadId, deck);
    const preview = composeReview(deck, draft);
    const source = this.inbox.sourceFor(threadId) ?? this.sources[0];
    const delivered = this.deliveredFor(source?.app);

    let detail: Awaited<ReturnType<InboxService['sourceForThread']>> | undefined;
    try {
      detail = await this.inbox.sourceForThread(threadId);
    } catch (error) {
      console.warn(`[service] source unavailable for send: ${errorMessage(error)}`);
    }

    if (!source || !detail) {
      return { ok: false, delivered, error: 'No review source is available for this item' };
    }

    let delivery;
    try {
      delivery = await source.deliver({
        thread,
        deck,
        draft,
        message: preview.message,
        source: detail,
      });
    } catch (error) {
      return { ok: false, delivered, error: errorMessage(error) };
    }

    let telegramLink: string | undefined;
    let telegramError: string | undefined;
    try {
      const result = await this.telegram.onReviewSent(
        thread,
        deck,
        draft,
        preview.message,
        delivery.receipt,
        { via },
      );
      telegramLink = result.link;
    } catch (error) {
      telegramError = errorMessage(error);
      console.warn(`[service] telegram onReviewSent failed: ${telegramError}`);
    }

    if (!delivery.error) await this.reviews.clear(threadId);
    return {
      ok: !delivery.error,
      delivered: delivery.delivered,
      ...(delivery.receipt ? { receipt: delivery.receipt } : {}),
      ...(telegramLink ? { telegramLink } : {}),
      ...(delivery.error ?? telegramError
        ? { error: [delivery.error, telegramError ? `Telegram: ${telegramError}` : ''].filter(Boolean).join('; ') }
        : {}),
    };
  }

  private deliveredFor(app: AppId | undefined): SendResult['delivered'] {
    if (this.env.mode === 'demo') return 'demo-log';
    if (app === 'notion') return 'notion';
    if (app === 'gmail') return 'gmail';
    return 't3';
  }

  /**
   * POST /api/edit/:threadId — apply one spoken note to one draft sentence.
   * The result is saved on the note (`Note.after`) so preview and send use it.
   */
  async edit(threadId: string, pointId: string, text: string): Promise<EditResult> {
    const thread = await this.requireThread(threadId);
    const deck = await this.requireDeck(threadId);
    const point = deck.points.find((candidate) => candidate.id === pointId);
    if (!point) throw new HttpError(404, `Unknown point ${pointId}`, 'not_found');

    const draft = await this.draftFor(threadId, deck);
    const existing = draft.notes.find((note) => note.pointId === pointId);
    const before =
      existing?.after !== undefined && existing.after.length > 0 ? existing.after : point.quote;
    const source = this.inbox.sourceFor(threadId) ?? this.sources[0];
    if (!source?.edit) {
      return {
        ok: false,
        pointId,
        before,
        error: "This item can't be edited here",
      };
    }

    let result: EditResult;
    try {
      result = await source.edit({
        thread,
        point,
        before,
        text,
        ...(this.editLlm ? { llm: this.editLlm } : {}),
      });
    } catch (error) {
      console.warn(`[service] edit failed: ${errorMessage(error)}`);
      return { ok: false, pointId, before, error: "Couldn't change this line" };
    }
    if (!result.ok) return result;

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
    await this.reviews.put(mergeDraft(draft, threadId, { notes }));
    return result;
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

  /**
   * Telegram question button: exactly the glasses answer path. Save one answer
   * note on the draft, then send it through the same source delivery.
   */
  async answer(threadId: string, pointId: string, option: string): Promise<void> {
    const deck = await this.requireDeck(threadId);
    const point = deck.points.find((candidate) => candidate.id === pointId);
    if (!point || point.kind !== 'question') {
      throw new HttpError(404, `Unknown question ${pointId}`, 'not_found');
    }
    if (point.options && !point.options.includes(option)) {
      throw new HttpError(400, `Unknown option for ${pointId}`, 'bad_request');
    }
    const draft = await this.draftFor(threadId, deck);
    const notes: Note[] = draft.notes.filter((note) => note.pointId !== pointId);
    notes.push({ pointId, verdict: 'answer', option });
    await this.reviews.put(mergeDraft(draft, threadId, { notes }));
    const result = await this.send(threadId, { via: 'telegram' });
    if (!result.ok) {
      throw new HttpError(502, result.error ?? 'Could not send the answer', 'send_error');
    }
  }

  /**
   * Telegram "✅ Approve" on a Notion card: no notes, so the source sets the page
   * status to Approved. Any notes saved on the phone are deliberately cleared.
   */
  async approve(threadId: string): Promise<void> {
    const thread = await this.requireThread(threadId);
    if (thread.app !== 'notion') {
      throw new HttpError(400, 'Only a Notion page can be approved here', 'bad_request');
    }
    const deck = await this.requireDeck(threadId);
    const existing = await this.draftFor(threadId, deck);
    await this.reviews.put(emptyDraft(threadId, deck.sourceMessageId));
    const result = await this.send(threadId, { via: 'telegram' });
    if (!result.ok) {
      // Approval clears the notes; put them back when the page update failed.
      if (existing.notes.length > 0) await this.reviews.put(existing);
      throw new HttpError(502, result.error ?? 'Could not approve the page', 'send_error');
    }
  }

  /** Telegram "Send" after the phone confirmation on a Gmail draft. */
  async sendFromTelegram(threadId: string): Promise<void> {
    const result = await this.send(threadId, { via: 'telegram' });
    if (!result.ok) {
      throw new HttpError(502, result.error ?? 'Could not send the draft', 'send_error');
    }
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

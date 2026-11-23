import type { Deck, Point, ReviewDraft } from '../../../../shared/contract.js';
import type { Fixture } from './builtinFixtures.js';
import { cloneFixtures } from './builtinFixtures.js';
import type {
  AttentionSource,
  AttentionThread,
  TelegramNotifier,
  T3Client,
} from './types.js';

/** In-memory T3 stand-in used in demo mode and whenever src/t3 is unavailable. */
export class FakeT3Client implements T3Client {
  readonly sent: { threadId: string; text: string }[] = [];
  readonly answered: { threadId: string; requestId: string; answers: Record<string, string> }[] = [];
  private readonly fixtures: Fixture[];

  constructor(fixtures: Fixture[] = []) {
    this.fixtures = cloneFixtures(fixtures);
  }

  private sourceFor(threadId: string): AttentionSource {
    const fixture = this.fixtures.find((item) => item.thread.threadId === threadId);
    if (!fixture) throw new Error(`No demo fixture for thread ${threadId}`);
    return fixture.source;
  }

  async listAttention(): Promise<AttentionThread[]> {
    return this.fixtures.map((fixture) => ({ ...fixture.thread }));
  }

  async getSource(threadId: string): Promise<AttentionSource> {
    return { ...this.sourceFor(threadId) };
  }

  async sendMessage(threadId: string, text: string): Promise<void> {
    this.sent.push({ threadId, text });
    console.info(`[t3 demo] message to ${threadId} (${text.length} chars)`);
  }

  async answerQuestion(
    threadId: string,
    requestId: string,
    answers: Record<string, string>,
  ): Promise<void> {
    this.answered.push({ threadId, requestId, answers: { ...answers } });
    console.info(
      `[t3 demo] answers to ${threadId}/${requestId}: ${Object.entries(answers)
        .map(([id, value]) => `${id}=${value}`)
        .join(', ')}`,
    );
  }
}

/** Dry-run Telegram stand-in. Never talks to Telegram; logs every intended call. */
export class FakeTelegramNotifier implements TelegramNotifier {
  readonly mode = 'dry-run' as const;
  readonly attentionCalls: { threadId: string; sourceMessageId: string; pointCount: number }[] = [];
  readonly reviewCalls: { threadId: string; message: string }[] = [];
  readonly phoneCalls: { threadId: string; pointId: string }[] = [];
  started = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async onAttention(
    thread: AttentionThread,
    source: AttentionSource,
    deck: Deck,
  ): Promise<void> {
    this.attentionCalls.push({
      threadId: thread.threadId,
      sourceMessageId: source.sourceMessageId,
      pointCount: deck.points.length,
    });
    console.info(
      `[telegram dry-run] topic "${thread.title}" + source post (${source.text.length} chars, ${deck.points.length} points)`,
    );
  }

  async onReviewSent(
    thread: AttentionThread,
    _deck: Deck,
    draft: ReviewDraft,
    composedMessage: string,
  ): Promise<{ link?: string }> {
    this.reviewCalls.push({ threadId: thread.threadId, message: composedMessage });
    console.info(
      `[telegram dry-run] review for "${thread.title}" (${draft.notes.length} notes)`,
    );
    return {};
  }

  async readOnPhone(thread: AttentionThread, _deck: Deck, point: Point): Promise<{ link?: string }> {
    this.phoneCalls.push({ threadId: thread.threadId, pointId: point.id });
    console.info(`[telegram dry-run] read-on-phone ${thread.title} point ${point.index}`);
    return {};
  }
}

import type { AgentStatus, Deck, Point, Receipt, ReviewDraft, TaskResult } from '../../../../shared/contract.js';
import type { Fixture } from './builtinFixtures.js';
import { cloneFixtures } from './builtinFixtures.js';
import type {
  AgentUpdate,
  AttentionSource,
  AttentionThread,
  SendOptions,
  TelegramNotifier,
  T3Client,
} from './types.js';

/** In-memory T3 stand-in used in demo mode and whenever src/t3 is unavailable. */
export class FakeT3Client implements T3Client {
  readonly sent: { threadId: string; text: string; sourcePlanId?: string }[] = [];
  readonly answered: { threadId: string; requestId: string; answers: Record<string, string> }[] = [];
  readonly tasks: { text: string; title: string }[] = [];
  /** Tests set these to drive the glance status and the catch-up from "T3 thread activity". */
  statusValue: Pick<AgentStatus, 'working' | 'doneToday'> = { working: 2, doneToday: 3 };
  updates: AgentUpdate[] = [];
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

  async status(): Promise<Pick<AgentStatus, 'working' | 'doneToday'>> {
    return { ...this.statusValue };
  }

  async activity(sinceMs: number): Promise<AgentUpdate[]> {
    return this.updates.filter((update) => Date.parse(update.at) >= sinceMs);
  }

  async startTask(input: { text: string; title: string }): Promise<TaskResult> {
    this.tasks.push({ ...input });
    console.info(`[t3 demo] task "${input.title}" (nothing was started)`);
    return {
      ok: true,
      threadId: `demo-task-${this.tasks.length}`,
      title: input.title,
      agent: 'Demo agent',
    };
  }

  async sendMessage(threadId: string, text: string, options?: SendOptions): Promise<void> {
    this.sent.push({
      threadId,
      text,
      ...(options?.sourcePlanId === undefined ? {} : { sourcePlanId: options.sourcePlanId }),
    });
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
  readonly agentReplyCalls: { threadId: string; sourceMessageId: string }[] = [];
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
    _receipt?: Receipt,
    _options?: { via?: 'g2' | 'telegram' },
  ): Promise<{ link?: string }> {
    this.reviewCalls.push({ threadId: thread.threadId, message: composedMessage });
    console.info(
      `[telegram dry-run] review for "${thread.title}" (${draft.notes.length} notes)`,
    );
    return {};
  }

  async onAgentReply(
    thread: AttentionThread,
    source: AttentionSource,
    _options?: { needsYou?: boolean },
  ): Promise<boolean> {
    this.agentReplyCalls.push({
      threadId: thread.threadId,
      sourceMessageId: source.sourceMessageId,
    });
    return false;
  }

  async readOnPhone(thread: AttentionThread, _deck: Deck, point: Point): Promise<{ link?: string }> {
    this.phoneCalls.push({ threadId: thread.threadId, pointId: point.id });
    console.info(`[telegram dry-run] read-on-phone ${thread.title} point ${point.index}`);
    return {};
  }
}

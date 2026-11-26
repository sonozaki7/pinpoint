import type { Deck, ReviewDraft } from '../../../../shared/contract.js';
import type { AttentionSource, AttentionThread, T3Client } from '../core/types.js';
import type { ReviewSource, SourceDelivery, SourceDeliveryInput, SourceDetail } from './types.js';


/** The T3 web app's plan-implementation prefix (see docs/t3-api-notes.md §4). */
const PLAN_IMPLEMENT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:\n';

/**
 * T3 Code threads, wrapped so they look like any other review source. The
 * delivery behaviour is the pre-existing one: questions go through
 * answerQuestion, an all-agreed plan is approved the way the T3 web app does,
 * and everything else is a plain message to the thread.
 */
export class T3ReviewSource implements ReviewSource {
  readonly app = 't3' as const;
  private readonly t3: T3Client;
  private readonly demo: boolean;

  constructor(t3: T3Client, options: { demo?: boolean } = {}) {
    this.t3 = t3;
    this.demo = options.demo === true;
  }

  async listAttention(): Promise<AttentionThread[]> {
    const threads = await this.t3.listAttention();
    return threads
      .filter((thread) => !thread.app || thread.app === 't3')
      .map((thread) => ({ ...thread, app: 't3' as const }));
  }

  async getSource(threadId: string): Promise<SourceDetail> {
    const source = await this.t3.getSource(threadId);
    return { source: { ...source, app: source.app ?? 't3' }, app: 't3' };
  }

  async deliver(input: SourceDeliveryInput): Promise<SourceDelivery> {
    await this.deliverOnce(input.thread, input.deck, input.draft, input.message, input.source);
    return { delivered: this.demo ? 'demo-log' : 't3' };
  }

  private async deliverOnce(
    thread: AttentionThread,
    deck: Deck,
    draft: ReviewDraft,
    message: string,
    source: AttentionSource,
  ): Promise<void> {
    if (source.kind === 'question' && source.question) {
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
    if (source.kind === 'plan') {
      const objections = draft.notes.filter((note) => note.verdict === 'object');
      if (objections.length === 0) {
        const notes = draft.notes
          .map((note) => {
            const point = deck.points.find((candidate) => candidate.id === note.pointId);
            if (!point) return null;
            const text = (note.option ?? note.text ?? '').trim();
            return `● ${point.index}. "${point.quote.slice(0, 140)}" → ${text || 'Note.'}`;
          })
          .filter((entry): entry is string => entry !== null);
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
}

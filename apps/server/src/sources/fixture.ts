import type { AppId, EditResult } from '../../../../shared/contract.js';
import { applyDraftEdits } from '../core/draft.js';
import { editSentence } from '../core/edit.js';
import type { T3Client } from '../core/types.js';
import { gmailReceipt, notionReceipt } from './receipts.js';
import type {
  ReviewSource,
  SourceDelivery,
  SourceDeliveryInput,
  SourceDetail,
  SourceEditInput,
} from './types.js';

/**
 * Demo mode has no Notion or Gmail account: fixture threads marked with an app
 * still review and send, and the receipt says what would have happened. The
 * console gets a one-line summary; no content is logged.
 */
export class FixtureReviewSource implements ReviewSource {
  readonly app: 'notion' | 'gmail';
  private readonly t3: T3Client;

  constructor(app: 'notion' | 'gmail', t3: T3Client) {
    this.app = app;
    this.t3 = t3;
  }

  async listAttention() {
    const threads = await this.t3.listAttention();
    return threads.filter((thread) => thread.app === this.app);
  }

  async getSource(threadId: string): Promise<SourceDetail> {
    const source = await this.t3.getSource(threadId);
    return { source: { ...source, app: this.app }, app: this.app };
  }

  async edit(input: SourceEditInput): Promise<EditResult> {
    if (this.app !== 'gmail') {
      return {
        ok: false,
        pointId: input.point.id,
        before: input.before,
        error: "This item can't be edited here",
      };
    }
    const result = await editSentence({ before: input.before, note: input.text });
    return {
      ok: result.ok,
      pointId: input.point.id,
      before: input.before,
      ...(result.after !== undefined ? { after: result.after } : {}),
      ...(result.method ? { method: result.method } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }

  async deliver(input: SourceDeliveryInput): Promise<SourceDelivery> {
    const byId = new Set(input.deck.points.map((point) => point.id));
    const notes = input.draft.notes.filter((note) => byId.has(note.pointId));
    if (this.app === 'notion') {
      const status = notes.length > 0 ? 'Changes requested' : 'Approved';
      const receipt = notionReceipt({
        comments: notes.length,
        failed: 0,
        name: input.source.target?.name ?? input.thread.title,
        status,
        link: input.source.target?.link,
      });
      console.info(
        `[demo] notion: ${notes.length} comment${notes.length === 1 ? '' : 's'}, status ${status}`,
      );
      return { delivered: 'demo-log', receipt };
    }
    const edited = applyDraftEdits(input.source.text, input.deck, input.draft);
    console.info(`[demo] gmail: ${edited.applied} change${edited.applied === 1 ? '' : 's'} applied`);
    return {
      delivered: 'demo-log',
      receipt: gmailReceipt({
        to: input.source.target?.recipient ?? input.thread.title,
        link: input.source.target?.link,
      }),
    };
  }
}

export type FixtureApp = Extract<AppId, 'notion' | 'gmail'>;

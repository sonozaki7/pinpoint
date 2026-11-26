import { createHash } from 'node:crypto';
import type { Note, Point } from '../../../../shared/contract.js';
import type { ReviewConnector, ReviewPage } from '../connectors/types.js';
import { blockForQuote } from '../core/flags.js';
import type { AttentionSource, AttentionThread } from '../core/types.js';
import { notionReceipt } from './receipts.js';
import type {
  ReviewSource,
  SourceDelivery,
  SourceDeliveryInput,
  SourceDetail,
} from './types.js';

export interface NotionReviewSourceOptions {
  notion: ReviewConnector;
  /** A short page name may still need clipping for the receipt (<= 30 chars). */
  maxTitleChars?: number;
}

const THREAD_PREFIX = 'notion:';

/** A page title's first segment: "Launch post: Pinpoint 1.0" -> "Launch post". */
function shortName(title: string, max = 28): string {
  const head = title.split(/\s*[|:—–]\s*/)[0]?.trim() || title.trim();
  return head.length > max ? `${head.slice(0, Math.max(1, max - 3)).trimEnd()}...` : head;
}

function pageId(threadId: string): string {
  return threadId.startsWith(THREAD_PREFIX) ? threadId.slice(THREAD_PREFIX.length) : threadId;
}

function commentBody(note: Note): string {
  const label = note.verdict === 'object' ? 'Change' : 'Note';
  const text = (note.option ?? note.text ?? '').trim() || 'Reviewed.';
  return `${label}: ${text} — via Pinpoint (G2)`;
}

/**
 * A Notion page waiting for review. Points are anchored to the block that
 * contains their quote, so each note becomes a comment on that exact block;
 * on send the page's status becomes "Changes requested" (or "Approved" when
 * the review has no notes).
 */
export class NotionReviewSource implements ReviewSource {
  readonly app = 'notion' as const;
  private readonly notion: ReviewConnector;
  private readonly maxTitleChars: number;

  constructor(options: NotionReviewSourceOptions) {
    this.notion = options.notion;
    this.maxTitleChars = options.maxTitleChars ?? 28;
  }

  async listAttention(): Promise<AttentionThread[]> {
    const pages = await this.notion.listReviewPages();
    return pages.map((page) => ({
      threadId: `${THREAD_PREFIX}${page.id}`,
      title: page.title,
      project: 'Notion',
      attention: 'report' as const,
      updatedAt: page.updatedAt,
      app: 'notion' as const,
    }));
  }

  async getSource(threadId: string): Promise<SourceDetail> {
    const page = await this.notion.getReviewPage(pageId(threadId));
    const text = page.blocks.map((block) => block.text).join('\n').trim();
    const hash = createHash('sha1')
      .update(`${page.id}\u0000${text}`)
      .digest('hex')
      .slice(0, 12);
    const source: AttentionSource = {
      sourceMessageId: `notion-${page.id}-${hash}`,
      text,
      kind: 'reply',
      app: 'notion',
      blocks: page.blocks,
      target: {
        name: this.nameFor(page),
        link: page.url,
      },
    };
    return { source, app: 'notion' };
  }

  async deliver(input: SourceDeliveryInput): Promise<SourceDelivery> {
    const id = pageId(input.thread.threadId);
    const byId = new Map(input.deck.points.map((point) => [point.id, point]));
    const notes = input.draft.notes.filter((note) => byId.has(note.pointId));
    const status = notes.length > 0 ? 'Changes requested' : 'Approved';

    let comments = 0;
    let failed = 0;
    for (const note of notes) {
      const point = byId.get(note.pointId)!;
      const body = commentBody(note);
      const blockId = point.anchor ?? blockForQuote(point.quote, input.source.blocks)?.id;
      if (blockId) {
        try {
          await this.notion.commentOnBlock(blockId, body);
          comments += 1;
          continue;
        } catch {
          // Some workspaces reject block-parent comments; quote on the page.
        }
      }
      try {
        await this.notion.commentOnPage(id, `"${point.quote}" — ${body}`);
        comments += 1;
      } catch {
        failed += 1;
      }
    }

    let statusOk = true;
    let statusError: string | undefined;
    try {
      await this.notion.setReviewStatus(id, status);
    } catch (error) {
      statusOk = false;
      statusError = error instanceof Error ? error.message : 'status update failed';
    }

    const receipt = notionReceipt({
      comments,
      failed,
      name: this.nameForThread(input.thread, input.source),
      status,
      link: input.source.target?.link,
    });
    const error =
      !statusOk || failed > 0
        ? `Notion: ${statusError ?? `${failed} comment${failed === 1 ? '' : 's'} failed`}`
        : undefined;
    return { delivered: 'notion', receipt, ...(error ? { error } : {}) };
  }

  private nameFor(page: ReviewPage): string {
    return shortName(page.title, this.maxTitleChars);
  }

  private nameForThread(thread: AttentionThread, source: AttentionSource): string {
    return source.target?.name ?? shortName(thread.title, this.maxTitleChars);
  }
}

/** Exported for tests: the exact line a Notion comment carries. */
export function notionCommentBody(note: Note): string {
  return commentBody(note);
}

/** Exported for tests: the block a point's note lands on. */
export function anchorFor(point: Point, source: AttentionSource): string | undefined {
  return point.anchor ?? blockForQuote(point.quote, source.blocks)?.id;
}

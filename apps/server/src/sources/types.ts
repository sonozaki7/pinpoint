import type {
  AppId,
  Deck,
  EditResult,
  Point,
  Receipt,
  ReviewDraft,
  SendResult,
} from '../../../../shared/contract.js';
import type { AttentionSource, AttentionThread } from '../core/types.js';

/** What a source hands the deck builder and the Telegram notifier. */
export interface SourceDetail {
  source: AttentionSource;
  app: AppId;
}

export interface SourceEditInput {
  thread: AttentionThread;
  point: Point;
  /** The sentence as it reads now (an earlier edit's result, or the point quote). */
  before: string;
  /** The note exactly as spoken or typed. */
  text: string;
  /** Optional one-sentence rewrite (live mode only); deterministic rules run first. */
  llm?: (input: { system: string; user: string }) => Promise<string>;
}

export interface SourceDeliveryInput {
  thread: AttentionThread;
  deck: Deck;
  draft: ReviewDraft;
  /** The composed review message (used only by the T3 source). */
  message: string;
  source: AttentionSource;
}

export interface SourceDelivery {
  delivered: SendResult['delivered'];
  receipt?: Receipt;
  /** Set when part of the delivery failed; the review may still be partly landed. */
  error?: string;
}

/**
 * One review surface. T3 wraps the existing client unchanged; Notion and Gmail
 * read the item that is waiting for review and write the notes back into it.
 */
export interface ReviewSource {
  readonly app: AppId;
  listAttention(): Promise<AttentionThread[]>;
  getSource(threadId: string): Promise<SourceDetail>;
  /** Only editable sources (a Gmail draft) implement this. */
  edit?(input: SourceEditInput): Promise<EditResult>;
  deliver(input: SourceDeliveryInput): Promise<SourceDelivery>;
}

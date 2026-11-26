import type {
  AppId,
  Deck,
  Point,
  Receipt,
  ReviewDraft,
  ThreadAttention,
} from '../../../../shared/contract.js';

/** One addressable block in a review source (a Notion paragraph, heading, ...). */
export interface SourceBlock {
  id: string;
  text: string;
}

/** Notes the source app already holds; used only as evidence for a point's flag. */
export interface SourceEvidence {
  notes?: { title: string; text: string; url?: string }[];
}

/** Names and links the receipt needs; never shown as review content. */
export interface SourceTarget {
  /** Short name for a receipt, e.g. "Launch post". */
  name?: string;
  /** First name the mail is addressed to, e.g. "Priya". */
  recipient?: string;
  subject?: string;
  /** Deep link to the source item in its own app. */
  link?: string;
}

/**
 * The message an attention thread wants reviewed. Same shape as T3Client.getSource's result.
 *
 * Review sources add optional fields the deck builder and receipt use:
 * `app` (which surface this came from), `blocks` (Notion block ids and text for
 * server-side anchors), `evidence` (linked notes the flagger may cite) and
 * `target` (receipt names/links). T3 sources leave them unset.
 */
export interface AttentionSource {
  sourceMessageId: string;
  text: string;
  kind: 'plan' | 'reply' | 'question';
  question?: {
    requestId: string;
    questions: { id: string; question: string; options: string[] }[];
  };
  app?: AppId;
  blocks?: SourceBlock[];
  evidence?: SourceEvidence;
  target?: SourceTarget;
}

/** SPEC §6. */
export interface AttentionThread {
  threadId: string;
  title: string;
  project: string;
  attention: ThreadAttention;
  updatedAt: string;
  /** Which surface produced the work; absent means T3. */
  app?: AppId;
}

/** Extra delivery options for a message sent to T3 (plan approval, SPEC §6). */
export interface SendOptions {
  /** T3 plan id the message reviews; T3 records it as the run's source plan. */
  sourcePlanId?: string;
}

/** SPEC §6. Implemented in src/t3, loaded dynamically by src/core/loaders.ts. */
export interface T3Client {
  listAttention(): Promise<AttentionThread[]>;
  getSource(threadId: string): Promise<AttentionSource>;
  sendMessage(threadId: string, text: string, options?: SendOptions): Promise<void>;
  answerQuestion(threadId: string, requestId: string, answers: Record<string, string>): Promise<void>;
}

/**
 * Implemented in src/telegram. The hook is invoked when the phone taps
 * "Agree all & continue" on a thread header. Accepts either the thread object
 * or a bare thread id.
 */
export type AgreeAllHook = (thread: AttentionThread | string) => Promise<void>;

/** SPEC §11. Implemented in src/telegram, loaded dynamically. */
export interface TelegramNotifier {
  mode: 'live' | 'dry-run';
  onAttention(thread: AttentionThread, source: AttentionSource, deck: Deck): Promise<void>;
  onReviewSent(
    thread: AttentionThread,
    deck: Deck,
    draft: ReviewDraft,
    composedMessage: string,
    /** Where the source says the review landed; posted as a silent receipt. */
    receipt?: Receipt,
    /** 'telegram' for a button tap, so the summary says where it came from. */
    options?: { via?: 'g2' | 'telegram' },
  ): Promise<{ link?: string }>;
  /**
   * Called by live inbox polling when a reviewed thread has a new agent message.
   * Returns true when the notifier posted it, so no fresh card is posted too.
   */
  onAgentReply?(
    thread: AttentionThread,
    source: AttentionSource,
    options?: { needsYou?: boolean },
  ): Promise<boolean>;
  readOnPhone(thread: AttentionThread, deck: Deck, point: Point): Promise<{ link?: string }>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

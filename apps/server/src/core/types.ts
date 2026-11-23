import type { Deck, Point, ReviewDraft, ThreadAttention } from '../../../../shared/contract.js';

/** The message an attention thread wants reviewed. Same shape as T3Client.getSource's result. */
export interface AttentionSource {
  sourceMessageId: string;
  text: string;
  kind: 'plan' | 'reply' | 'question';
  question?: {
    requestId: string;
    questions: { id: string; question: string; options: string[] }[];
  };
}

/** SPEC §6. */
export interface AttentionThread {
  threadId: string;
  title: string;
  project: string;
  attention: ThreadAttention;
  updatedAt: string;
}

/** SPEC §6. Implemented in src/t3, loaded dynamically by src/core/loaders.ts. */
export interface T3Client {
  listAttention(): Promise<AttentionThread[]>;
  getSource(threadId: string): Promise<AttentionSource>;
  sendMessage(threadId: string, text: string): Promise<void>;
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
  ): Promise<{ link?: string }>;
  readOnPhone(thread: AttentionThread, deck: Deck, point: Point): Promise<{ link?: string }>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

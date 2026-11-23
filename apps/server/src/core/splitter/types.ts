import type { AttentionSource, AttentionThread } from '../types.js';

export interface SplitInput {
  thread: AttentionThread;
  source: AttentionSource;
}

export interface RawSplit {
  headline: string;
  points: unknown[];
  /** Label stored on the deck, e.g. "opencode:deepseek-v4.1-flash". */
  splitter: string;
}

export interface Splitter {
  /** Configured provider label, used by /api/health before any deck is built. */
  readonly label: string;
  split(input: SplitInput): Promise<RawSplit>;
}

export class SplitterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitterError';
  }
}

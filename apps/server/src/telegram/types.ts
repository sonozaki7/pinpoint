// Shapes shared inside the Telegram module. They mirror shared/contract.ts (and the
// server's src/core/types.ts) structurally, so the server can pass its own objects.
import type { ThreadAttention } from '../../../../shared/contract.js';

/** Minimal view of an inbox thread needed to address a Telegram topic. */
export interface ThreadRef {
  threadId: string;
  title: string;
  project?: string;
  attention: ThreadAttention;
  updatedAt?: string;
}

/** The agent reply a deck was built from. */
export interface SourceRef {
  sourceMessageId: string;
  text: string;
}

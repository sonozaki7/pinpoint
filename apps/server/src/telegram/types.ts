// Shapes shared inside the Telegram module. They mirror shared/contract.ts (and the
// server's src/core/types.ts) structurally, so the server can pass its own objects.
import type { AppId, ThreadAttention } from '../../../../shared/contract.js';

/** Names and links a card's buttons need; mirrors core/types.ts SourceTarget. */
export interface SourceTargetRef {
  name?: string;
  recipient?: string;
  subject?: string;
  link?: string;
}

/** Minimal view of an inbox thread needed to address a Telegram topic. */
export interface ThreadRef {
  threadId: string;
  title: string;
  project?: string;
  attention: ThreadAttention;
  updatedAt?: string;
  app?: AppId;
}

/** The agent reply a deck was built from (or the source item under review). */
export interface SourceRef {
  sourceMessageId: string;
  text: string;
  app?: AppId;
  target?: SourceTargetRef;
}

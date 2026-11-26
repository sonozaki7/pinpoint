// Connector interfaces for the review sources. Real implementations live in
// gmail.ts / notion.ts / googleAuth.ts / opencode.ts. Cloud mode returns none.

/** One email thread that may need a reply (legacy morning-brief shape). */
export interface EmailThread {
  threadId: string;
  messageId: string;
  from: { name: string; email: string };
  to: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: string;
  link: string;
}

export interface MailConnector {
  listNeedsReply(opts: { query: string; max: number }): Promise<EmailThread[]>;
  sendReply(input: {
    threadId: string;
    messageId: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<{ id: string; link: string }>;
}

/** A Gmail draft an agent already wrote. `body` is the plain-text reply. */
export interface DraftMessage {
  /** Draft id, not the message id. */
  id: string;
  messageId: string;
  threadId: string;
  to: string;
  toName: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  updatedAt: string;
  link: string;
}

export interface DraftConnector {
  listDrafts(opts: { query: string; max: number }): Promise<DraftMessage[]>;
  getDraft(draftId: string): Promise<DraftMessage>;
  /** Replace the draft body, keeping recipient, subject and thread. */
  updateDraft(draftId: string, body: string): Promise<{ id: string; link: string }>;
  /** Send the draft exactly as stored. */
  sendDraft(draftId: string): Promise<{ id: string; threadId: string; link: string }>;
}

export interface NoteHit {
  id: string;
  title: string;
  text: string;
  url: string;
}

export interface NotesConnector {
  search(query: string, max: number): Promise<NoteHit[]>;
  createTask(input: {
    title: string;
    due?: string;
    details?: string;
    sourceUrl?: string;
  }): Promise<{ id: string; url: string }>;
}

/** One page waiting for review, with its blocks in document order. */
export interface ReviewPageBlock {
  id: string;
  text: string;
}

export interface ReviewPage {
  id: string;
  url: string;
  title: string;
  updatedAt: string;
}

export interface ReviewPageDetail extends ReviewPage {
  blocks: ReviewPageBlock[];
}

export interface ReviewConnector {
  listReviewPages(): Promise<ReviewPage[]>;
  getReviewPage(pageId: string): Promise<ReviewPageDetail>;
  /** Attach a comment to one block. Throws when the API rejects block parents. */
  commentOnBlock(blockId: string, text: string): Promise<void>;
  /** Attach a comment to the page (quote fallback). */
  commentOnPage(pageId: string, text: string): Promise<void>;
  setReviewStatus(pageId: string, status: string): Promise<void>;
}

export interface LlmConnector {
  name: string;
  complete(input: {
    system: string;
    user: string;
    json?: boolean;
    maxTokens?: number;
  }): Promise<string>;
}

export interface Connectors {
  mail?: MailConnector;
  drafts?: DraftConnector;
  notes?: NotesConnector;
  reviews?: ReviewConnector;
  llm?: LlmConnector;
}

/** Anything that can hand out a fresh Google access token. */
export interface AccessTokenProvider {
  accessToken(): Promise<string>;
}

/**
 * Errors from a connector. Messages are safe to show in a receipt or a log:
 * they never contain response bodies, tokens, email addresses or note text.
 * HTTP status and the provider's machine-readable error code are included when
 * the API returned them.
 */
export class ConnectorError extends Error {
  readonly connector: string;
  readonly status?: number;

  constructor(connector: string, message: string, options?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = 'ConnectorError';
    this.connector = connector;
    if (options?.status !== undefined) this.status = options.status;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** Coerce a requested result count into a sane API page size. */
export function clampCount(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

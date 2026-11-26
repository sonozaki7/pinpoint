// Connector interfaces for the desk integrations behind the Morning brief.
// The brief engine builds against these types only; real implementations live
// in gmail.ts / calendar.ts / notion.ts / openrouter.ts and the demo versions
// in fake.ts. Owner: connectors agent. Do not change without telling the brief
// agent, it codes against this file in parallel.

/** One email thread that may need a reply. */
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

export interface CalEvent {
  calendarId: string;
  eventId: string;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  link: string;
}

export interface CalendarConnector {
  listEvents(opts: { from: string; to: string }): Promise<CalEvent[]>;
  freeBusy(opts: { from: string; to: string }): Promise<Array<{ start: string; end: string }>>;
  moveEvent(input: {
    calendarId: string;
    eventId: string;
    start: string;
    end: string;
  }): Promise<{ link: string }>;
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
  calendar?: CalendarConnector;
  notes?: NotesConnector;
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

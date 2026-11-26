// Shared types between apps/glasses and apps/server. Owner: Opus. Request changes in docs/requests.md.

export type ThreadAttention = 'question' | 'plan' | 'failed' | 'report';
// Planned: 'actions' = things your assistants prepared across your apps (the "Morning brief"): email
// replies, meeting moves, tasks, chat replies; each point carries an Action the server runs on send.
// Added once the glasses app is ready for it (it switches exhaustively on attention).

/** Apps Pinpoint can act in. Shown on G2 as a short tag before the glance (APP_TAG). */
export type AppId = 'gmail' | 'calendar' | 'notion' | 'telegram' | 'slack' | 'discord' | 't3';
export const APP_TAG: Record<AppId, string> = {
  gmail: 'Mail', calendar: 'Cal', notion: 'Task', telegram: 'TG', slack: 'Slack', discord: 'Disc', t3: 'Agent',
};

/** What happens when a point is agreed (silence) and sent. A point with a note is revised first. */
export type Action =
  | { type: 'email.reply'; app: 'gmail'; threadId: string; messageId: string; to: string; subject: string; body: string }
  | { type: 'calendar.move'; app: 'calendar'; calendarId: string; eventId: string; title: string; fromStart: string; toStart: string; durationMin: number }
  | { type: 'task.create'; app: 'notion'; title: string; due?: string; details?: string }
  | { type: 'chat.reply'; app: 'telegram' | 'slack' | 'discord'; chatId: string; chatName: string; replyToId?: string; text: string };

export interface InboxItem {
  threadId: string;
  title: string; // e.g. "auth-refresh-fix"
  project: string;
  attention: ThreadAttention;
  summary: string; // <= 30 chars, ASCII, e.g. "plan, 7 steps"
  updatedAt: string; // ISO
  deckReady: boolean;
  pointCount: number;
  draftNotes: number; // notes already saved for this thread
}

export type PointKind = 'step' | 'claim' | 'question' | 'risk' | 'draft';

export interface Point {
  id: string; // "p1", "p2", ...
  index: number; // 1-based display number
  kind: PointKind;
  glance: string; // <= 44 chars, ASCII, one display line
  quote: string; // exact substring of the source text (verified)
  options?: string[]; // kind === 'question': 2-4 options, <= 24 chars, recommended first
  questionId?: string; // T3 user_input question id, when the point maps to one
  risk?: 'low' | 'high';
  app?: AppId; // set on 'actions' decks (and optionally elsewhere) for the G2 tag
  flag?: string; // <= 24 ASCII chars: why the assistant wants you to look, e.g. "busy Tue 10-12"
  action?: Action; // 'actions' decks only; server-side source of truth, the glasses only display it
}

export interface Deck {
  threadId: string;
  sourceMessageId: string;
  title: string;
  attention: ThreadAttention;
  headline: string; // <= 44 chars
  points: Point[];
  createdAt: string;
  splitter: string; // provider that built it, e.g. "opencode:deepseek-v4.1-flash" or "fixture"
}

export type Verdict = 'object' | 'note' | 'answer';

export interface Note {
  pointId: string;
  verdict: Verdict;
  text?: string; // transcript or typed text
  option?: string; // chosen option for questions
  audioMs?: number;
}

export interface ReviewDraft {
  threadId: string;
  sourceMessageId: string;
  notes: Note[]; // at most one per point
  seen: string[]; // point ids the user focused
  updatedAt: string;
}

export interface PreviewResult {
  message: string; // full composed review (section 8 of SPEC)
  preview: [string, string]; // two ASCII lines for the glasses
  counts: { objections: number; answers: number; notes: number; agreed: number };
}

export interface SendResult {
  ok: boolean;
  delivered: 't3' | 'demo-log' | 'sample'; // 'sample': Pinpoint Cloud sample workspace (no real agent)
  telegramLink?: string;
  error?: string;
  receipt?: Receipt; // 'actions' decks: what actually happened in each app
}

/** Result of sending an 'actions' deck. Agreed points run at once; points with a note are revised
 * (LLM on the desk, template in the sample workspace) and come back as a follow-up 'actions' deck
 * titled "Revised" so nothing you corrected goes out unseen. */
export interface Receipt {
  lines: ReceiptLine[]; // one per executed action, in deck order
  revised: number; // how many points went to the follow-up deck
  followUpThreadId?: string; // inbox item holding the revised points
}

export interface ReceiptLine {
  app: AppId;
  text: string; // <= 44 ASCII chars, e.g. "Sent reply to Priya"
  ok: boolean;
  link?: string; // https link to the result (Gmail thread, Calendar event, Notion page, chat message)
}

export interface Health {
  ok: boolean;
  mode: 'demo' | 'live' | 'cloud';
  t3: 'ok' | 'unreachable' | 'unauthorized' | 'off';
  telegram: 'ok' | 'dry-run' | 'error' | 'off';
  splitter: string;
  version?: string; // server version, e.g. "1.0.0"
  workspace?: 'sample' | 'desk'; // cloud mode: what this device is looking at
  pairing?: boolean; // cloud mode: true once desk pairing (relay) is available
  desk?: { name: string; online: boolean }; // cloud mode: the paired desk, when workspace === 'desk'
}

// Pinpoint Cloud (PINPOINT_MODE=cloud, https://pinpoint-api.qolso.com): every request from the
// glasses carries a device id (random UUID made on first run, kept in SDK storage). The cloud keeps a
// private sample workspace per device. After desk pairing (phase 2) the device also sends its token and
// the cloud relays its requests to the paired desk (the user's own computer running T3 Code).
export const DEVICE_HEADER = 'X-Pinpoint-Device';
export const TOKEN_HEADER = 'X-Pinpoint-Token';
export const CLOUD_URL = 'https://pinpoint-api.qolso.com';

export interface PairResult {
  ok: boolean;
  token?: string; // device token for TOKEN_HEADER; shown once
  desk?: { name: string };
  error?: string;
}

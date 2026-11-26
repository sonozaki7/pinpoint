// Shared types between apps/glasses and apps/server. Owner: Opus. Request changes in docs/requests.md.

export type ThreadAttention = 'question' | 'plan' | 'failed' | 'report';

/**
 * Where a piece of AI work comes from, and where your feedback lands. Pinpoint does one job: review
 * work your AIs already did, point by point, and put your words exactly where they belong.
 *   t3     coding agents (Claude Code, Codex) in T3 Code: the review goes back to the agent
 *   notion a Notion page waiting for review: each note becomes a comment on the exact block
 *   gmail  a Gmail draft an agent wrote: your notes are applied to the draft, shown once, then sent
 *   telegram/slack/discord: companions (alerts, full text, receipts), not review sources
 * Shown on G2 as a short tag before the inbox row (APP_TAG).
 */
export type AppId = 't3' | 'notion' | 'gmail' | 'telegram' | 'slack' | 'discord';
export const APP_TAG: Record<AppId, string> = {
  t3: 'Agent', notion: 'Notion', gmail: 'Mail', telegram: 'TG', slack: 'Slack', discord: 'Discord',
};

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
  app?: AppId; // source of the work; absent = 't3'
  needsYou?: number; // points that need your judgment (flagged); the rest are routine and count as agreed
  changed?: number; // points new or changed since your last review of this thread (revisions only)
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
  flag?: string; // <= 24 ASCII chars: why this line is worth checking, e.g. "signs out everyone"
  why?: string; // <= 60 ASCII chars of evidence shown under a flagged line, e.g. "Your notes say net-45 (Acme, Nov 12)"
  changed?: boolean; // new or changed since your last review of this thread
  anchor?: string; // where feedback lands in the source app, e.g. a Notion block id; server-side only
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
  after?: string; // 'draft' points (e.g. a Gmail draft sentence): the sentence after your note was applied
}

/**
 * POST /api/edit/:threadId { pointId, text } — apply a spoken note to one 'draft' sentence, in place.
 * Deterministic first: "<new>, not <old>" replaces old with new inside that sentence; "delete" /
 * "remove this" drops it; "say …" / "instead …" / "change it to …" replaces it with your words.
 * Only otherwise an LLM rewrites that one sentence, and the server checks nothing else changed.
 * The glasses show `after` right away ("Now: …"), so the draft never needs a second review pass.
 */
export interface EditResult {
  ok: boolean;
  pointId: string;
  before: string;
  after?: string; // absent when the line was deleted or the edit failed
  method?: 'replace' | 'delete' | 'say' | 'rewrite';
  error?: string; // short, shown on the glasses, e.g. "Couldn't change this line"
}

/**
 * POST /api/ask/:threadId { question } — ask about the output instead of scrolling it.
 * The answer always points at an exact sentence of the source (quote is a verified substring), so it
 * can't invent facts; with no good match it says so. Desk: local model picks the sentence and phrases a
 * short answer; cloud sample: deterministic sentence retrieval (shared/ask.ts).
 */
export interface AskResult {
  ok: boolean;
  answer: string; // <= 2 G2 lines, e.g. "All of them: about 12,400 active sessions."
  quote?: string; // exact sentence from the source that supports the answer
  pointId?: string; // the point containing that sentence, to jump to it
  error?: string;
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
  delivered: 't3' | 'notion' | 'gmail' | 'demo-log' | 'sample'; // 'sample': Pinpoint Cloud sample workspace (no real agent)
  telegramLink?: string;
  error?: string;
  receipt?: Receipt; // where your feedback landed
}

/** Where each part of a sent review landed. A Gmail draft you corrected comes back once as a
 * follow-up item ("Revised draft") so nothing you changed goes out unseen. */
export interface Receipt {
  lines: ReceiptLine[];
  followUpThreadId?: string;
}

export interface ReceiptLine {
  app: AppId;
  text: string; // <= 44 ASCII chars, e.g. "2 comments on Pricing page v2"
  ok: boolean;
  link?: string; // https link to the result (agent thread, Notion block, Gmail draft, chat message)
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

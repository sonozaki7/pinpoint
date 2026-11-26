// Small formatting helpers shared by the notifier.
//
// The group is read at a glance, so every string here is plain language and carries
// its own meaning without a legend: "Needs you: plan, 7 steps", "Your change: ...",
// "Sent to the agent from your G2: 1 change, 6 agreed".
import type { Deck, Note, Point, ThreadAttention } from '../../../../shared/contract.js';
import { stripMarkdown } from './quotes.js';

/** Status shown on the topic icon (and in its name when custom icons are unavailable). */
export type TopicStatus = 'needs' | 'done' | 'failed';

export interface CardThread {
  title: string;
  project?: string;
  attention: ThreadAttention;
}

export interface CardParts {
  firstLine: string;
  titleLine: string;
  points: string[];
  footer?: string;
}

export interface ReviewCounts {
  objections: number;
  notes: number;
  answers: number;
  agreed: number;
}

const NEEDS_EMOJI = '🟡';
const FAILED_EMOJI = '⚠️';

export function plural(count: number, singular: string): string {
  const safe = Math.max(0, Math.trunc(count));
  return `${safe} ${singular}${safe === 1 ? '' : 's'}`;
}

function shortTitle(title: string, max = 48): string {
  return shortenQuote(title.replace(/\s+/g, ' ').trim(), max);
}

/**
 * First line of the card, the only line that has to explain the whole message.
 * Preferred wording:
 *   🟡 Needs you: plan, 7 steps
 *   🟡 Needs you: a question
 *   ⚠️ Failed: auth-refresh-fix
 *   🟡 Needs you: reply, 4 points
 */
export function cardFirstLine(thread: CardThread, pointCount: number): string {
  const count = Math.max(0, Math.trunc(pointCount));
  switch (thread.attention) {
    case 'plan':
      return `${NEEDS_EMOJI} Needs you: plan, ${plural(count, 'step')}`;
    case 'question':
      return `${NEEDS_EMOJI} Needs you: a question`;
    case 'failed':
      return `${FAILED_EMOJI} Failed: ${shortTitle(thread.title)}`;
    case 'report':
    default:
      return `${NEEDS_EMOJI} Needs you: reply, ${plural(count, 'point')}`;
  }
}

export function cardTitleLine(thread: CardThread): string {
  const project = thread.project?.trim();
  return project ? `${thread.title} · ${project}` : thread.title;
}

/** One numbered line per glance, exactly as the glasses show them; risks get a warning. */
export function pointLines(deck: Deck): string[] {
  return deck.points.map((point) => `${point.index}. ${point.risk ? `${FAILED_EMOJI} ` : ''}${point.glance}`);
}

export function renderCard(parts: CardParts): string {
  const lines = [parts.firstLine, parts.titleLine, '', ...parts.points];
  if (parts.footer) lines.push('', parts.footer);
  return lines.join('\n').trim();
}

export function needsCard(thread: CardThread, deck: Deck): CardParts {
  return {
    firstLine: cardFirstLine(thread, deck.points.length),
    titleLine: cardTitleLine(thread),
    points: pointLines(deck),
    footer: thread.attention === 'failed' ? 'Open it on your G2, or:' : 'Review it on your G2, or:',
  };
}

export function reviewedFirstLine(counts: ReviewCounts): string {
  if (counts.objections > 0) {
    return `✅ Reviewed from G2: ${plural(counts.objections, 'change')} sent`;
  }
  if (counts.notes > 0) {
    return `✅ Reviewed from G2: ${plural(counts.notes, 'note')} sent`;
  }
  if (counts.answers > 0) {
    return `✅ Answered from G2: ${plural(counts.answers, 'answer')} sent`;
  }
  return `✅ Reviewed from G2: all ${counts.agreed} agreed`;
}

export const AGREED_FIRST_LINE = '✅ Agreed from Telegram';

/** Counts only notes that carry a body; empty notes were never sent and count as agreed. */
export function reviewCounts(deck: Deck, notes: ReadonlyArray<Note> | undefined): ReviewCounts {
  const byPoint = new Map(deck.points.map((point) => [point.id, point]));
  const valid = (notes ?? []).filter((note) => byPoint.has(note.pointId) && noteBody(note).length > 0);
  const counted = new Set(valid.map((note) => note.pointId));
  return {
    objections: valid.filter((note) => note.verdict === 'object').length,
    notes: valid.filter((note) => note.verdict === 'note').length,
    answers: valid.filter((note) => note.verdict === 'answer').length,
    agreed: deck.points.filter((point) => !counted.has(point.id)).length,
  };
}

export function noteBody(note: Note): string {
  const text = (note.verdict === 'answer' ? (note.option ?? note.text) : note.text)?.trim() ?? '';
  return text.replace(/\s+/g, ' ');
}

/** One quote-reply body, no repeated sentence: "❌ Your change: ...". */
export function noteReplyText(note: Note): string {
  const body = noteBody(note);
  switch (note.verdict) {
    case 'object':
      return `❌ Your change: ${body}`;
    case 'answer':
      return `💬 Your answer: ${body}`;
    case 'note':
    default:
      return `📝 Your note: ${body}`;
  }
}

/**
 * One-line summary posted after the quote replies.
 *   ✅ Sent to the agent from your G2: 1 change, 6 agreed
 */
export function summaryText(counts: ReviewCounts): string {
  const parts: string[] = [];
  if (counts.objections > 0) parts.push(plural(counts.objections, 'change'));
  if (counts.notes > 0) parts.push(plural(counts.notes, 'note'));
  if (counts.answers > 0) parts.push(plural(counts.answers, 'answer'));
  if (parts.length === 0) {
    return `✅ Sent to the agent from your G2: all ${counts.agreed} agreed`;
  }
  parts.push(`${counts.agreed} agreed`);
  return `✅ Sent to the agent from your G2: ${parts.join(', ')}`;
}

/** Header of the silent full-text message. */
export function fullTextLabel(attention: ThreadAttention): string {
  switch (attention) {
    case 'plan':
      return "🤖 Agent's plan, full text";
    case 'question':
      return "🤖 Agent's question, full text";
    case 'report':
    case 'failed':
    default:
      return "🤖 Agent's reply, full text";
  }
}

/** Header of the one notifying reply when the owner taps "Read on phone" in the glasses. */
export function readOnPhoneHeader(point: Point): string {
  const label = point.kind === 'question' ? 'Question' : 'Step';
  return `📖 ${label} ${point.index}: you opened this from your glasses`;
}

export function readOnPhoneText(point: Point, paragraph?: string): string {
  const body = paragraph?.trim();
  return body ? `${readOnPhoneHeader(point)}\n\n${body}` : readOnPhoneHeader(point);
}

/** The pinned General-topic legend. Kept short on purpose. */
export const LEGEND_TEXT = [
  'How Pinpoint Desk works: each agent task gets a topic.',
  '❗️ needs you · ✅ reviewed · ‼️ failed.',
  'Review on your G2 (scroll with the ring, tap to talk, double-tap to send) or tap ✅ Agree all here.',
  'Your notes appear attached to the exact sentences.',
].join('\n');

export function topicStatusForAttention(attention: ThreadAttention): TopicStatus {
  return attention === 'failed' ? 'failed' : 'needs';
}

/** Topic-list fallback when Telegram will not accept a custom topic icon. */
export const TOPIC_STATUS_EMOJI: Record<TopicStatus, string> = {
  needs: '🟡',
  done: '✅',
  failed: '⚠️',
};

/** Topic icons from getForumTopicIconStickers. 🟡/⚠️ are not offered, so ❗️/‼️ stand in. */
export const TOPIC_ICON_EMOJI: Record<TopicStatus, string> = {
  needs: '❗️',
  done: '✅',
  failed: '‼️',
};

const MARKERS: Record<Note['verdict'], string> = {
  object: '✗',
  note: '●',
  answer: '?',
};

/** Kept for the older composed-review fixture and its tests. */
export function reviewLine(point: Point, note: Note): string {
  const marker = MARKERS[note.verdict];
  const quote = shortenQuote(stripMarkdown(point.quote), 140);
  const body =
    note.verdict === 'answer' ? (note.option ?? note.text ?? '') : (note.text ?? '');
  return body ? `${marker} ${point.index}. "${quote}" → ${body}` : `${marker} ${point.index}. "${quote}"`;
}

export function shortenQuote(quote: string, max = 140): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const slice = flat.slice(0, max);
  const space = slice.lastIndexOf(' ');
  return `${(space > max * 0.5 ? slice.slice(0, space) : slice).trim()}…`;
}

/** Deep link to a message in a private supergroup, optionally inside a forum topic. */
export function messageLink(chatId: string, messageId: number, topicId?: number): string {
  const internal = chatId.startsWith('-100') ? chatId.slice(4) : chatId.replace(/^-/, '');
  const base = `https://t.me/c/${internal}/${messageId}`;
  return topicId !== undefined ? `${base}?thread=${topicId}` : base;
}

export function topicName(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim();
  return flat.length > 128 ? flat.slice(0, 128) : flat || 'Pinpoint thread';
}

/** Clip a long paragraph around the quoted sentence so a reply stays under the limit. */
export function clipAround(text: string, needle: string, max = 3400): string {
  const flat = text.trim();
  if (flat.length <= max) return flat;
  const at = Math.max(0, flat.indexOf(needle));
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), flat.length - max));
  const slice = flat.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${slice.trim()}${start + max < flat.length ? '…' : ''}`;
}

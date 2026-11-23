// Small formatting helpers shared by the notifier.
import type { Note, Point, ThreadAttention } from '../../../../shared/contract.js';
import { stripMarkdown } from './quotes.js';

export function headerText(attention: ThreadAttention, pointCount: number, done = false): string {
  const count = Math.max(0, Math.trunc(pointCount));
  const noun = count === 1 ? 'point' : 'points';
  const prefix = done ? '✓ Agreed on phone' : 'Needs you';
  return `${prefix} · ${attention} · ${count} ${noun}`;
}

export function pointReplyText(point: Point): string {
  return `Point ${point.index} — from your glasses`;
}

const MARKERS: Record<Note['verdict'], string> = {
  object: '✗',
  note: '●',
  answer: '?',
};

/** One review line in the SPEC section 8 format, used for the quote-replies. */
export function reviewLine(point: Point, note: Note): string {
  const marker = MARKERS[note.verdict];
  const quote = shortenQuote(stripMarkdown(point.quote), 140);
  const body = note.verdict === 'answer' ? (note.option ?? note.text ?? '') : (note.text ?? '');
  return body
    ? `${marker} ${point.index}. "${quote}" → ${body}`
    : `${marker} ${point.index}. "${quote}"`;
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

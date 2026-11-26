import type { Deck, Point, ReviewDraft } from '../../../../shared/contract.js';
import { makeGlance, oneLine } from './text.js';

/**
 * Gmail-draft review: one point per sentence, no model.
 *
 * Quotes are exact substrings of the draft so an edit can be applied in place.
 * Segments shorter than `MIN_SENTENCE` (greetings, a sign-off name) are left
 * out of the review and therefore never edited or dropped.
 */

export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

const MIN_SENTENCE = 10;

function trimSpan(source: string, start: number, end: number): SentenceSpan {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(source[a]!)) a += 1;
  while (b > a && /\s/.test(source[b - 1]!)) b -= 1;
  return { text: source.slice(a, b), start: a, end: b };
}

export function sentenceSpans(source: string, minLength = MIN_SENTENCE): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  try {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    for (const part of segmenter.segment(source)) {
      const span = trimSpan(source, part.index, part.index + part.segment.length);
      if (span.text.length < minLength) continue;
      if (!/[\p{L}\p{N}]/u.test(span.text)) continue;
      out.push(span);
    }
  } catch {
    // Very old runtimes: fall back to punctuation splits.
    const re = /[^.!?]+[.!?]+/g;
    for (const match of source.matchAll(re)) {
      const span = trimSpan(source, match.index ?? 0, (match.index ?? 0) + match[0].length);
      if (span.text.length >= minLength) out.push(span);
    }
  }
  return out;
}

/** One 'draft' point per sentence, glanced to fit one glasses line. */
export function draftPoints(source: string): Point[] {
  return sentenceSpans(source).map((span, index) => ({
    id: `p${index + 1}`,
    index: index + 1,
    kind: 'draft' as const,
    glance: makeGlance(span.text, 44) || `Sentence ${index + 1}`,
    quote: span.text,
  }));
}

export interface AppliedDraftEdits {
  text: string;
  applied: number;
  deleted: number;
}

/**
 * Apply the stored `after` values to a draft body, in point order.
 * `after === ''` deletes the sentence (Notion of the note is kept in the review).
 */
export function applyDraftEdits(body: string, deck: Deck, draft: ReviewDraft): AppliedDraftEdits {
  const byId = new Map(deck.points.map((point) => [point.id, point]));
  const notes = draft.notes
    .filter((note) => byId.has(note.pointId) && note.after !== undefined)
    .sort((a, b) => (byId.get(a.pointId)!.index ?? 0) - (byId.get(b.pointId)!.index ?? 0));

  let text = body;
  let applied = 0;
  let deleted = 0;
  for (const note of notes) {
    const point = byId.get(note.pointId)!;
    if (point.kind !== 'draft') continue;
    const after = note.after ?? '';
    const index = text.indexOf(point.quote);
    if (index < 0) continue;
    const end = index + point.quote.length;
    if (after.trim().length === 0) {
      let cutEnd = end;
      if (text[cutEnd] === ' ') cutEnd += 1;
      text = text.slice(0, index) + text.slice(cutEnd);
      text = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      deleted += 1;
    } else {
      text = text.slice(0, index) + after + text.slice(end);
    }
    applied += 1;
  }
  return { text, applied, deleted };
}

/** First name for a receipt: "Priya Shah" -> "Priya", "priya@acme.com" -> "Priya". */
export function receiptName(value: string): string {
  const clean = oneLine(value).replace(/^"(.*)"$/, '$1').trim();
  if (clean.length === 0) return 'them';
  if (clean.includes('@')) {
    const local = clean.split('@')[0]!.split('+')[0]!.replace(/[._-]+/g, ' ').trim();
    return titleCase(local.split(' ')[0] ?? 'them');
  }
  return titleCase(clean.split(/[\s,]+/)[0] ?? clean);
}

export function titleCase(value: string): string {
  const text = value.trim();
  if (text.length === 0) return text;
  return `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

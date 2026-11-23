import type { Deck, Note, Point, PreviewResult, ReviewDraft } from '../../../../shared/contract.js';
import { clipText, oneLine, stripInlineMarkdown, toAscii } from './text.js';

const MAX_QUOTE = 140;

function quoteFor(point: Point): string {
  const clean = oneLine(stripInlineMarkdown(point.quote)).replace(/"/g, "'");
  return clipText(clean, MAX_QUOTE, '…');
}

function noteText(note: Note, fallback: string): string {
  const text = oneLine(note.option ?? note.text ?? '');
  const value = text.length > 0 ? text : fallback;
  return /[.!?…]$/.test(value) ? value : `${value}.`;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/**
 * SPEC §8. Deterministic: no LLM, no model calls. Unknown point ids are ignored.
 */
export function composeReview(deck: Deck, draft: ReviewDraft): PreviewResult {
  const points = new Map(deck.points.map((point) => [point.id, point]));
  const notes = draft.notes.filter((note) => points.has(note.pointId));

  const objections = notes
    .filter((note) => note.verdict === 'object')
    .sort((a, b) => (points.get(a.pointId)?.index ?? 0) - (points.get(b.pointId)?.index ?? 0));
  const answers = notes
    .filter((note) => note.verdict === 'answer')
    .sort((a, b) => (points.get(a.pointId)?.index ?? 0) - (points.get(b.pointId)?.index ?? 0));
  const plainNotes = notes
    .filter((note) => note.verdict === 'note')
    .sort((a, b) => (points.get(a.pointId)?.index ?? 0) - (points.get(b.pointId)?.index ?? 0));

  const noted = new Set(notes.map((note) => note.pointId));
  const agreedPoints = deck.points.filter((point) => !noted.has(point.id));
  const closing = deck.attention === 'plan' ? 'Go ahead with the rest of the plan.' : 'Continue.';

  const lines: string[] = [`Review from G2 (Pinpoint) — ${deck.points.length} points`];

  for (const note of objections) {
    const point = points.get(note.pointId)!;
    lines.push(`✗ ${point.index}. "${quoteFor(point)}" → ${noteText(note, 'No.')}`);
  }
  for (const note of answers) {
    const point = points.get(note.pointId)!;
    lines.push(`? ${point.index}. "${quoteFor(point)}" → ${noteText(note, 'See my note.')}`);
  }
  for (const note of plainNotes) {
    const point = points.get(note.pointId)!;
    lines.push(`● ${point.index}. "${quoteFor(point)}" → ${noteText(note, 'Note.')}`);
  }

  if (notes.length === 0) {
    lines.push(`✓ Reviewed on G2: all ${deck.points.length} points agreed. Continue.`);
  } else if (agreedPoints.length > 0) {
    lines.push(`✓ Agreed: ${agreedPoints.map((point) => point.index).join(', ')}. ${closing}`);
  } else {
    lines.push(`✓ Agreed: none. ${closing}`);
  }

  const counts = {
    objections: objections.length,
    answers: answers.length,
    notes: plainNotes.length,
    agreed: agreedPoints.length,
  };

  return {
    message: lines.join('\n'),
    preview: [previewCounts(counts, deck.points.length), previewAction(deck)],
    counts,
  };
}

export function allAgreedReview(deck: Deck): PreviewResult {
  return composeReview(deck, {
    threadId: deck.threadId,
    sourceMessageId: deck.sourceMessageId,
    notes: [],
    seen: [],
    updatedAt: new Date().toISOString(),
  });
}

function previewCounts(
  counts: PreviewResult['counts'],
  total: number,
): string {
  if (counts.objections === 0 && counts.answers === 0 && counts.notes === 0) {
    return toAscii(`all ${total} points agreed`);
  }
  const parts: string[] = [];
  if (counts.objections > 0) parts.push(plural(counts.objections, 'objection'));
  if (counts.answers > 0) parts.push(plural(counts.answers, 'answer'));
  if (parts.length === 0 && counts.notes > 0) parts.push(plural(counts.notes, 'note'));
  parts.push(`${counts.agreed} agreed`);
  return toAscii(parts.join(', '));
}

function previewAction(deck: Deck): string {
  return clipText(toAscii(`Tap to send to ${deck.title}`), 34, '...');
}

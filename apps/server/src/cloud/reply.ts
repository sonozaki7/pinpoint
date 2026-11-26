import { randomUUID } from 'node:crypto';
import type { Deck, Point, ReviewDraft } from '../../../../shared/contract.js';
import type { AttentionSource, AttentionThread } from '../core/types.js';
import { verifyQuote } from '../core/splitter/verify.js';
import { clipText, makeGlance, oneLine, stripInlineMarkdown, toAscii } from '../core/text.js';

export interface SampleReply {
  text: string;
  source: AttentionSource;
  deck: Deck;
}

export interface SampleReplyInput {
  thread: AttentionThread;
  deck: Deck;
  draft: ReviewDraft;
  /** Overrides the generated source message id (tests). */
  sourceMessageId?: string;
  now?: Date;
}

const MAX_REPLY_POINTS = 4;
const MAX_NOTE_CHARS = 140;

/** Plain ASCII, one line, with a sentence-ending period. */
function sentence(raw: string | undefined | null, max = MAX_NOTE_CHARS): string {
  const clean = clipText(
    toAscii(oneLine(stripInlineMarkdown(raw ?? ''))),
    max,
    '...',
  ).trim();
  if (clean.length === 0) return '';
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function withoutEnd(text: string): string {
  return text.replace(/[.!?]+$/, '').trim();
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toLowerCase()}${text.slice(1)}`;
}

function noteText(note: ReviewDraft['notes'][number]): string {
  const fallback = note.verdict === 'object' ? 'No' : 'Noted';
  return sentence(note.option ?? note.text ?? fallback);
}

function labelFor(point: Point): string {
  if (point.kind === 'question') return `Question ${point.index}`;
  return `Step ${point.index}`;
}

/**
 * The sample agent's reply, built only from the review the device sent.
 *
 * The text is deterministic except for note wording. Point quotes are full
 * constructed sentences, so each one is an exact substring by construction;
 * verifyQuote is still run as the final gate (SPEC §7).
 */
export function buildSampleReply(input: SampleReplyInput): SampleReply {
  const byId = new Map(input.deck.points.map((point) => [point.id, point]));
  const notes = input.draft.notes
    .filter((note) => byId.has(note.pointId))
    .sort(
      (a, b) => (byId.get(a.pointId)?.index ?? 0) - (byId.get(b.pointId)?.index ?? 0),
    );

  const parts: string[] = [];
  if (input.deck.attention === 'question') {
    const answer = notes.find((note) => note.verdict === 'answer');
    const answerText = answer ? withoutEnd(noteText(answer)) : '';
    parts.push(
      answerText.length > 0
        ? `Thanks. I'll ${lowerFirst(answerText)}.`
        : "Thanks. I'll wait for your go-ahead.",
    );
    for (const note of notes) {
      if (answer && note.pointId === answer.pointId) continue;
      const point = byId.get(note.pointId)!;
      const text = noteText(note);
      if (text.length > 0) parts.push(`${labelFor(point)}: ${text}`);
    }
  } else if (input.deck.attention === 'plan') {
    if (notes.length === 0) {
      parts.push("Thanks. I'll start on step 1 now.");
    } else {
      parts.push("Thanks. I'll apply your review.");
      for (const note of notes.slice(0, 3)) {
        const point = byId.get(note.pointId)!;
        const text = noteText(note);
        parts.push(`Step ${point.index}: ${text.length > 0 ? text : 'No.'}`);
      }
    }
    parts.push('Everything else goes ahead as planned.');
  } else {
    if (notes.length === 0) {
      parts.push("Thanks. I'll keep the rest as it is.");
    } else {
      parts.push("Thanks. I'll apply your review.");
      for (const note of notes.slice(0, 3)) {
        const point = byId.get(note.pointId)!;
        const text = noteText(note);
        parts.push(`Point ${point.index}: ${text.length > 0 ? text : 'Noted.'}`);
      }
      parts.push('The rest looks good.');
    }
  }

  const text = parts.filter((part) => part.length > 0).join(' ');
  const middle = parts.slice(1, -1).slice(0, 2);
  const candidates =
    parts.length <= 1
      ? [text]
      : [parts[0]!, ...middle, parts[parts.length - 1]!];

  const seen = new Set<string>();
  const points: Point[] = [];
  for (const candidate of candidates) {
    if (points.length >= MAX_REPLY_POINTS) break;
    const verified = verifyQuote(text, candidate, 200);
    if (!verified || seen.has(verified.quote)) continue;
    seen.add(verified.quote);
    points.push({
      id: `p${points.length + 1}`,
      index: points.length + 1,
      kind: 'claim',
      glance: makeGlance(verified.quote, 44) || 'Agent replied',
      quote: verified.quote,
    });
  }
  if (points.length === 0) {
    const verified = verifyQuote(text, clipText(text, 200, ''), 200);
    if (verified) {
      points.push({
        id: 'p1',
        index: 1,
        kind: 'claim',
        glance: makeGlance(verified.quote, 44) || 'Agent replied',
        quote: verified.quote,
      });
    }
  }

  const now = input.now ?? new Date();
  const sourceMessageId = input.sourceMessageId ?? `sample-reply-${randomUUID()}`;
  const thread: AttentionThread = {
    ...input.thread,
    attention: 'report',
    updatedAt: now.toISOString(),
  };
  const deck: Deck = {
    threadId: thread.threadId,
    sourceMessageId,
    title: thread.title,
    attention: 'report',
    headline: makeGlance(`${thread.title}: agent replied`, 44) || 'Agent replied',
    points,
    createdAt: now.toISOString(),
    splitter: 'sample-reply',
  };

  return {
    text,
    source: { sourceMessageId, text, kind: 'reply' },
    deck,
  };
}

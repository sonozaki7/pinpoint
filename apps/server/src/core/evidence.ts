import type { Point } from '../../../../shared/contract.js';
import { clipText, oneLine, toAscii } from './text.js';

/**
 * Evidence rules for a flagged line.
 *
 * A flag is only kept when its `why` is grounded in text the reviewer can see:
 *   - the source message itself,
 *   - an earlier user instruction in the same thread,
 *   - a linked note (Notion search / Gmail evidence),
 *   - or one of the four named risk heuristics.
 *
 * A why may not introduce a number, amount or proper noun that appears nowhere
 * in that evidence. Ungrounded flags are dropped rather than guessed at.
 */

export const MAX_FLAG = 24;
export const MAX_WHY = 60;
export const CHANGED_WHY = 'changed since your review';

export const RISK_HEURISTICS = [
  "can't be undone",
  'affects every customer',
  'money or date commitment',
  'external promise',
] as const;

export type RiskHeuristic = (typeof RISK_HEURISTICS)[number];

export interface EvidenceNote {
  title: string;
  text: string;
}

export interface EvidenceContext {
  /** The exact text of the work under review. */
  sourceText: string;
  notes?: EvidenceNote[];
  history?: { role: string; text: string }[];
}

const STOP_PROPER = new Set([
  'the', 'this', 'that', 'these', 'those', 'a', 'an', 'it', 'its', 'we', 'you', 'they', 'i',
  'and', 'but', 'if', 'when', 'after', 'before', 'then', 'also', 'only', 'our', 'your', 'their',
  'there', 'here', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'not', 'no', 'yes', 'so', 'or', 'for', 'with', 'from', 'to', 'of', 'on', 'in', 'at', 'by',
]);

function corpusText(context: EvidenceContext): string {
  const parts = [context.sourceText];
  for (const note of context.notes ?? []) parts.push(note.title, note.text);
  for (const entry of context.history ?? []) parts.push(entry.text);
  return parts.join('\n');
}

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}']+/gu)) out.add(match[0]);
  return out;
}

function numberTokens(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => match[0].replace(/,/g, ''));
}

function properTokens(text: string): { token: string; index: number }[] {
  const out: { token: string; index: number }[] = [];
  for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9'’.-]*/g)) {
    const token = match[0].replace(/[.'’,]+$/, '');
    if (token.length === 0) continue;
    out.push({ token, index: match.index ?? 0 });
  }
  return out;
}

/** One-line plain-ASCII evidence text, clipped to the contract's 60 chars. */
export function normalizeWhy(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = clipText(oneLine(toAscii(raw)), MAX_WHY).trim();
  return clean.length > 0 ? clean : undefined;
}

export function normalizeFlagText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = clipText(oneLine(toAscii(raw)), MAX_FLAG).trim();
  return clean.length > 0 ? clean : undefined;
}

/**
 * True when every number and proper noun in `text` also appears in `reference`.
 * Used for a why and for a short Ask answer.
 */
export function groundedFacts(text: string, reference: string): boolean {
  const knownNumbers = new Set(numberTokens(reference));
  for (const value of numberTokens(text)) {
    if (!knownNumbers.has(value)) return false;
  }
  const knownWords = words(reference);
  for (const { token, index } of properTokens(text)) {
    // A sentence starts with a capital letter whatever the word is: "Logs out 12,400 sessions".
    if (index === 0) continue;
    // "Force-logout" is grounded when each of its parts is.
    for (const part of token.toLowerCase().split(/[-.]+/)) {
      if (part.length === 0 || STOP_PROPER.has(part)) continue;
      if (!knownWords.has(part)) return false;
    }
  }
  return true;
}

/**
 * Validate a model-supplied why against the evidence corpus.
 * Returns the normalized why or undefined when it invents a fact.
 */
export function groundedWhy(raw: unknown, context: EvidenceContext): string | undefined {
  const why = normalizeWhy(raw);
  if (!why) return undefined;
  const lower = why.toLowerCase();
  const heuristic = RISK_HEURISTICS.find((phrase) => lower.startsWith(phrase));
  const remainder = heuristic
    ? why.slice(heuristic.length).replace(/^[\s:,-]+/, '').trim()
    : why;
  if (heuristic && remainder.length === 0) return why;
  return groundedFacts(remainder, corpusText(context)) ? why : undefined;
}

/** A named heuristic can stand alone as grounded evidence when the quote matches it. */
export function heuristicFor(quote: string): RiskHeuristic | undefined {
  if (/\b(?:every|all)\s+(?:customer|user|client|account|team|person|people)\b/i.test(quote)) {
    return 'affects every customer';
  }
  if (/\b(?:can'?t|cannot)\s+be\s+(?:undone|reversed)\b|\birreversible\b|\bpermanent(?:ly)?\b/i.test(quote)) {
    return "can't be undone";
  }
  if (
    /\b(?:sign|log|force[- ]?log)\s*(?:out|off)\b|\bforce[- ]?logout\b|\bdelete\b|\bdestroy\b|\bdrop\b|\btruncate\b|\bwipe\b|\breset\b|\brevoke\b|\boverwrite\b|\bpurge\b/i.test(
      quote,
    )
  ) {
    return "can't be undone";
  }
  if (/\$\s?\d|\b(?:price|pricing|pay|payment|refund|invoice|cost|budget)\b/i.test(quote)) {
    return 'money or date commitment';
  }
  if (
    /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|deadline|due date|by \w+day)\b/i.test(
      quote,
    )
  ) {
    return 'money or date commitment';
  }
  if (/\b(?:promise|guarantee|guaranteed|never|always|100%)\b/i.test(quote)) {
    return 'external promise';
  }
  return undefined;
}

/** A one-line why for a deterministic flag (Notion claim or Gmail note conflict). */
export function heuristicWhy(quote: string): string | undefined {
  return heuristicFor(quote);
}

/** Does this point need the reviewer? A changed line counts even with no new flag. */
export function needsYou(point: Point): boolean {
  return Boolean(point.flag || point.changed);
}

export function needsYouCount(points: readonly Point[] | undefined): number {
  return (points ?? []).filter(needsYou).length;
}

/**
 * "7 steps · 1 needs you" — the G2 firmware has the middle dot (U+00B7), so it
 * can carry this one non-ASCII character. Everything else stays plain ASCII.
 */
export function formatNeedsSummary(base: string, needs: number, max = 30): string {
  const clean = toAscii(oneLine(base));
  if (needs <= 0) return clipText(clean, max).trim();
  const tail = `${needs} ${needs === 1 ? 'needs' : 'need'} you`;
  return clipText(`${clean} \u00b7 ${tail}`, max).trim();
}

import type { EditResult } from '../../../../shared/contract.js';
import { sentenceSpans } from './draft.js';
import { oneLine } from './text.js';

/**
 * Deterministic-first editing of one draft sentence (contract `EditResult`).
 *
 *   1. "delete" / "remove this" / "drop it"      -> drop the sentence
 *   2. "<new>, not <old>"                        -> swap that phrase in place
 *   3. "say …" / "instead …" / "change it to …"  -> replace the sentence
 *   4. anything else                             -> one LLM rewrite, verified
 *
 * The LLM is only consulted when a rewrite is requested and only sees this one
 * sentence. The result must be exactly one sentence, otherwise the edit fails
 * with the short glasses message "Couldn't change this line".
 */

export type SentenceEditMethod = NonNullable<EditResult['method']>;

export interface SentenceEdit {
  ok: boolean;
  after?: string;
  method?: SentenceEditMethod;
  error?: string;
}

export type SentenceRewrite = (input: { system: string; user: string }) => Promise<string>;

export interface EditSentenceInput {
  /** The sentence as it reads now. */
  before: string;
  /** The spoken or typed note. */
  note: string;
  /** Live-mode rewrite. Cloud and demo omit it, so unknown notes simply fail. */
  llm?: SentenceRewrite;
}

export const EDIT_FAILED = "Couldn't change this line";

const DELETE_RE =
  /^(?:delete|remove|drop|cut)(?:\s+(?:this|it|that))?(?:\s+(?:sentence|line|point|bit))?[.!]*$/i;
const REPLACE_RE = /^(?:use\s+)?(.+?),\s*(?:not|instead of|rather than)\s+(.+?)[.!]*$/i;
const SAY_RE = /^(?:say|instead|change it to|make it|write)\b[:,]?\s+(.+)$/i;

function stripWrappingQuotes(value: string): string {
  let text = value.trim();
  for (const [open, close] of [
    ['"', '"'],
    ["'", "'"],
    ['\u201c', '\u201d'],
  ] as const) {
    if (text.startsWith(open) && text.endsWith(close) && text.length >= 2) {
      text = text.slice(1, -1).trim();
    }
  }
  return text;
}

function capitalise(value: string): string {
  const text = value.trim();
  if (text.length === 0) return text;
  return `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

function lowerFirst(value: string): string {
  const text = value.trim();
  if (text.length === 0) return text;
  return `${text[0]!.toLowerCase()}${text.slice(1)}`;
}

/** Keep the casing shape of the phrase being replaced. */
function matchCasing(oldText: string, newText: string): string {
  if (oldText.length > 1 && oldText === oldText.toUpperCase() && /[A-Z]/.test(oldText)) {
    return newText.toUpperCase();
  }
  if (/^[A-Z]/.test(oldText)) return capitalise(newText);
  return lowerFirst(newText);
}

/** Tidy dictated words: one line, capital first letter, one clear ending. */
export function tidySentence(value: string): string {
  let text = oneLine(stripWrappingQuotes(value));
  if (text.length === 0) return '';
  text = capitalise(text);
  if (/[.!?]$/.test(text)) return text.replace(/\.{2,}$/, '.');
  if (/[,;:]$/.test(text)) return `${text.slice(0, -1)}.`;
  return `${text}.`;
}

function findPhrase(haystack: string, needle: string): { index: number; found: string } | null {
  if (needle.length < 2) return null;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { index: exact, found: needle };
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const folded = lowerHay.indexOf(lowerNeedle);
  if (folded >= 0) return { index: folded, found: haystack.slice(folded, folded + needle.length) };
  return null;
}

/**
 * Replace one phrase inside the sentence. Returns null when the old phrase is
 * not present, so the caller can treat the note as a general rewrite.
 */
function replacePhrase(before: string, next: string, oldText: string): string | null {
  const match = findPhrase(before, oldText);
  if (!match) return null;
  const replacement =
    match.index === 0
      ? capitalise(next)
      : matchCasing(match.found, next);
  return (
    before.slice(0, match.index) + replacement + before.slice(match.index + match.found.length)
  );
}

function isOneSentence(value: string): boolean {
  const text = value.trim();
  if (text.length === 0 || text.includes('\n')) return false;
  return sentenceSpans(text, 1).length <= 1;
}

function modelOutput(raw: string): string {
  let text = String(raw ?? '').trim();
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  text = stripWrappingQuotes(text);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return '';
  return lines[0]!;
}

function failure(): SentenceEdit {
  return { ok: false, error: EDIT_FAILED };
}

export async function editSentence(input: EditSentenceInput): Promise<SentenceEdit> {
  const before = oneLine(input.before);
  const note = oneLine(input.note);
  if (before.length === 0) return failure();
  if (note.length === 0) return failure();

  if (DELETE_RE.test(note)) return { ok: true, method: 'delete' };

  const replace = REPLACE_RE.exec(note);
  if (replace) {
    const next = stripWrappingQuotes(replace[1] ?? '');
    const old = stripWrappingQuotes(replace[2] ?? '');
    const replaced = next.length >= 1 ? replacePhrase(before, next, old) : null;
    if (replaced && replaced !== before && isOneSentence(replaced)) {
      return { ok: true, method: 'replace', after: replaced };
    }
  }

  const say = SAY_RE.exec(note);
  if (say) {
    const after = tidySentence(say[1] ?? '');
    if (after.length > 0 && isOneSentence(after)) {
      return { ok: true, method: 'say', after };
    }
    return failure();
  }

  if (!input.llm) return failure();

  try {
    const raw = await input.llm({
      system:
        'You edit exactly one sentence of an email draft. Reply with the edited sentence only: ' +
        'no quotation marks, no explanation, no second sentence.',
      user: `Sentence: ${before}\nNote: ${note}\nWrite the revised sentence.`,
    });
    const after = modelOutput(raw);
    if (after.length === 0 || !isOneSentence(after)) return failure();
    if (after === before) return failure();
    return { ok: true, method: 'rewrite', after };
  } catch {
    return failure();
  }
}

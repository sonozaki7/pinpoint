import type { EditResult } from '../../../../shared/contract.js';
import { applyEdit, EDIT_FAILED, tidySentence } from '../../../../shared/edit.js';
import { sentenceSpans } from './draft.js';
import { oneLine } from './text.js';

/**
 * Editing one draft sentence (contract `EditResult`).
 *
 * The deterministic grammar lives in `shared/edit.ts` so the glasses
 * simulator uses exactly the same rules:
 *
 *   1. "delete" / "remove this" / "drop it"      -> drop the sentence
 *   2. "<new>, not <old>" and spoken variants    -> swap that phrase in place
 *   3. "say …" / "instead …" / "change it to …"  -> replace the sentence
 *   4. anything the grammar can't read           -> one LLM rewrite, verified
 *
 * The LLM only sees this one sentence. Its result must be exactly one
 * sentence, otherwise the edit fails with the short glasses message.
 */

export { EDIT_FAILED, tidySentence };

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

  const grammar = applyEdit(before, note);
  if (grammar.ok) {
    if (grammar.method === 'delete') return { ok: true, method: 'delete' };
    if (grammar.after === undefined) return failure();
    return { ok: true, method: grammar.method, after: grammar.after };
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

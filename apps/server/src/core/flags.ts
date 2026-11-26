import type { Point } from '../../../../shared/contract.js';
import type { SourceBlock, SourceEvidence } from './types.js';
import { oneLine } from './text.js';

/**
 * Evidence-backed point flags (contract `Point.flag`, <= 24 ASCII chars).
 *
 * A flag is only set when the server can point at something: a linked note
 * that disagrees on a number/amount/term, or a claim in a Notion page of the
 * kind that is worth a second look ("every customer", "today", a price).
 */

export interface FlagCandidate {
  quote: string;
  flag: string;
}

const MONTHS: Record<string, string> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
};

const NUMBER_FAMILIES: { name: string; re: RegExp; format: (match: RegExpExecArray) => string }[] = [
  {
    name: 'net',
    re: /\bnet[- ]?(\d{1,3})\b/gi,
    format: (match) => `net-${match[1]}`,
  },
  {
    name: 'percent',
    re: /\b(\d{1,3})\s?%/g,
    format: (match) => `${match[1]}%`,
  },
  {
    name: 'money',
    re: /\$\s?([\d,]+(?:\.\d+)?)/g,
    format: (match) => `$${(match[1] ?? '').replace(/,/g, '')}`,
  },
  {
    name: 'days',
    re: /\b(\d{1,3})\s+(?:business\s+)?days?\b/gi,
    format: (match) => `${match[1]} days`,
  },
  {
    name: 'weekday',
    re: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/gi,
    format: (match) => {
      const value = (match[1] ?? '').toLowerCase();
      return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
    },
  },
  {
    name: 'date',
    re: /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/gi,
    format: (match) => {
      const month = MONTHS[(match[1] ?? '').slice(0, 3).toLowerCase()] ?? match[1] ?? '';
      return `${month} ${Number(match[2] ?? 0)}`;
    },
  },
];

/** Numbers / amounts / terms mentioned in a piece of text, by family. */
export function numberMentions(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const family of NUMBER_FAMILIES) {
    const values: string[] = [];
    for (const match of text.matchAll(family.re)) {
      values.push(family.format(match as RegExpExecArray));
    }
    if (values.length > 0) found.set(family.name, [...new Set(values)]);
  }
  return found;
}

/**
 * A sentence that disagrees with a linked note on a number gets a flag naming
 * the note's value: "notes say net-45". No note, no conflict, no flag.
 */
export function evidenceFlag(quote: string, notes: SourceEvidence['notes']): string | undefined {
  if (!notes || notes.length === 0) return undefined;
  const sentence = numberMentions(quote);
  if (sentence.size === 0) return undefined;

  for (const note of notes) {
    const noteValues = numberMentions(`${note.title}\n${note.text}`);
    for (const [family, values] of sentence) {
      const known = noteValues.get(family);
      if (!known || known.length === 0) continue;
      const conflict = values.find((value) => !known.includes(value));
      if (!conflict) continue;
      const preferred = known.find((value) => value !== conflict) ?? known[0]!;
      return clipFlag(`notes say ${preferred}`);
    }
  }
  return undefined;
}

const RISKY_CLAIM =
  /\b(?:every|all)\s+(?:customer|user|client|team|person|people|account)\b|\btoday\b|\b(?:always|never|guaranteed?|100%)\b|\$\s?\d|\bfree\s+forever\b/i;

/** Notion pages: a sweeping claim or a price is worth a check, not a rewrite. */
export function riskyClaimFlag(quote: string): string | undefined {
  return RISKY_CLAIM.test(quote) ? 'check this' : undefined;
}

export function clipFlag(value: string): string {
  return oneLine(value).replace(/[^\x20-\x7e]/g, '').slice(0, 24).trim();
}

/** Set `anchor` to the first source block whose text contains the quote. */
export function blockForQuote(
  quote: string,
  blocks: SourceBlock[] | undefined,
): SourceBlock | undefined {
  if (!blocks || blocks.length === 0) return undefined;
  const needle = oneLine(quote).toLowerCase();
  if (needle.length === 0) return undefined;
  const exact = blocks.find((block) => oneLine(block.text).toLowerCase().includes(needle));
  if (exact) return exact;
  const tokens = new Set(needle.match(/[\p{L}\p{N}]+/gu) ?? []);
  if (tokens.size === 0) return undefined;
  let best: { block: SourceBlock; score: number } | undefined;
  for (const block of blocks) {
    const blockTokens = new Set(oneLine(block.text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    if (blockTokens.size === 0) continue;
    let shared = 0;
    for (const token of tokens) if (blockTokens.has(token)) shared += 1;
    const score = shared / tokens.size;
    if (!best || score > best.score) best = { block, score };
  }
  return best && best.score >= 0.6 ? best.block : undefined;
}

/** Apply source-specific flags and anchors to normalized points. */
export function decoratePoints(
  points: Point[],
  app: string | undefined,
  source: { blocks?: SourceBlock[]; evidence?: SourceEvidence },
): Point[] {
  return points.map((point) => {
    const next: Point = { ...point };
    if (!next.flag) {
      const flag =
        app === 'gmail'
          ? evidenceFlag(next.quote, source.evidence?.notes)
          : app === 'notion'
            ? riskyClaimFlag(next.quote)
            : undefined;
      if (flag) next.flag = clipFlag(flag);
    }
    if (app === 'notion' && !next.anchor) {
      const block = blockForQuote(next.quote, source.blocks);
      if (block) next.anchor = block.id;
    }
    return next;
  });
}

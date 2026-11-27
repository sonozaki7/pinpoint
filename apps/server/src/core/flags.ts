import type { Point } from '../../../../shared/contract.js';
import {
  CHANGED_WHY,
  groundedWhy,
  heuristicFor,
  type EvidenceContext,
  type RiskHeuristic,
} from './evidence.js';
import type { SourceBlock, SourceEvidence } from './types.js';
import { oneLine } from './text.js';

/**
 * Evidence-backed point flags (contract `Point.flag`, <= 24 ASCII chars, and
 * `Point.why`, <= 60 ASCII chars).
 *
 * A flag is only kept when the server can point at something: a linked note
 * that disagrees on a number/amount/term, a source claim matching a named risk
 * heuristic, or a model-supplied why that survives the grounding check.
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

interface EvidenceConflict {
  preferred: string;
  note: { title: string; text: string; url?: string };
}

function evidenceConflict(
  quote: string,
  notes: SourceEvidence['notes'],
): EvidenceConflict | undefined {
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
      return { preferred, note };
    }
  }
  return undefined;
}

/**
 * A sentence that disagrees with a linked note on a number gets a flag naming
 * the note's value: "notes say net-45". No note, no conflict, no flag.
 */
export function evidenceFlag(quote: string, notes: SourceEvidence['notes']): string | undefined {
  const conflict = evidenceConflict(quote, notes);
  return conflict ? clipFlag(`notes say ${conflict.preferred}`) : undefined;
}

/** The one-line evidence under that flag, naming the linked note. */
export function evidenceWhy(quote: string, notes: SourceEvidence['notes']): string | undefined {
  const conflict = evidenceConflict(quote, notes);
  if (!conflict) return undefined;
  const title = oneLine(conflict.note.title).trim();
  const named =
    title.length > 0 ? `${title} says ${conflict.preferred}` : `the linked note says ${conflict.preferred}`;
  return clipWhy(named);
}

const RISKY_CLAIM =
  /\b(?:every|all)\s+(?:customer|user|client|team|person|people|account)\b|\b(?:available|live|launch|launching|release|releasing|rollout|roll out)\b[^.!?\n]*\btoday\b|\$\s?\d|\b(?:guaranteed?|free\s+forever)\b/i;

/** Notion pages: a sweeping rollout or price claim is worth a check, not a rewrite. */
export function riskyClaimFlag(quote: string): string | undefined {
  return RISKY_CLAIM.test(quote) ? 'check this' : undefined;
}

/** The named heuristic that justifies a deterministic check. */
export function riskyClaimWhy(quote: string): string | undefined {
  return heuristicFor(quote);
}

export function clipFlag(value: string): string {
  return oneLine(value).replace(/[^\x20-\x7e]/g, '').slice(0, 24).trim();
}

export function clipWhy(value: string): string {
  return oneLine(value).replace(/[^\x20-\x7e]/g, '').slice(0, 60).trim();
}

const HEURISTIC_FLAG: Record<RiskHeuristic, string> = {
  "can't be undone": "can't be undone",
  'affects every customer': 'affects everyone',
  'money or date commitment': 'money or date',
  'external promise': 'external promise',
};

function heuristicFlag(heuristic: RiskHeuristic | undefined): string | undefined {
  return heuristic ? HEURISTIC_FLAG[heuristic] : undefined;
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

/**
 * Apply source-specific flags, evidence lines and anchors to normalized points.
 * A model flag whose why cannot be grounded is dropped, never shown.
 */
export function decoratePoints(
  points: Point[],
  app: string | undefined,
  source: { text: string; blocks?: SourceBlock[]; evidence?: SourceEvidence; history?: { role: string; text: string }[] },
): Point[] {
  const context: EvidenceContext = {
    sourceText: source.text,
    ...(source.evidence?.notes ? { notes: source.evidence.notes } : {}),
    ...(source.history ? { history: source.history } : {}),
  };

  return points.map((point) => {
    const next: Point = { ...point };
    let flag = next.flag;
    let why = next.why ? groundedWhy(next.why, context) : undefined;

    // A model flag is kept only with grounded evidence. When the model forgot
    // the why, a named heuristic for the quote may stand in for it.
    if (flag && !why) {
      const heuristic = heuristicFor(next.quote);
      if (heuristic) why = heuristic;
    }
    if (flag && !why) flag = undefined;

    // Deterministic fallbacks. A linked note that disagrees on a number, day or
    // term comes first (Gmail, Notion and T3 alike), then a risky rollout claim
    // (Notion) or an irreversible step (T3 plans).
    if (!flag) {
      const conflict = evidenceFlag(next.quote, source.evidence?.notes);
      if (conflict) {
        flag = conflict;
        why = evidenceWhy(next.quote, source.evidence?.notes);
      } else if (app === 'notion') {
        const found = riskyClaimFlag(next.quote);
        if (found) {
          flag = found;
          why = riskyClaimWhy(next.quote);
        }
      } else if (app !== 'gmail' && next.risk === 'high') {
        const heuristic = heuristicFor(next.quote);
        const found = heuristicFlag(heuristic);
        if (found && heuristic) {
          flag = found;
          why = heuristic;
        }
      }
    }

    if (flag) {
      next.flag = clipFlag(flag);
      if (why) next.why = clipWhy(why);
      else delete next.flag;
    } else {
      delete next.flag;
      delete next.why;
    }

    if (next.changed && !next.why) next.why = CHANGED_WHY;

    if (app === 'notion' && !next.anchor) {
      const block = blockForQuote(next.quote, source.blocks);
      if (block) next.anchor = block.id;
    }
    return next;
  });
}

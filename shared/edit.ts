/**
 * The deterministic edit grammar for one draft sentence, shared by the server
 * (which falls back to an LLM when this returns ok:false) and the glasses mock
 * (which shows "Couldn't change this line").
 *
 *   "delete" / "remove this" / "drop it" / "cut this line"  -> drop the sentence
 *   "<new>, not <old>"  (any order/word order below)        -> swap that phrase in place
 *   "say …" / "instead say …" / "change it to …"            -> replace the sentence
 *
 * Matching tolerates how people speak and how speech-to-text writes it:
 * case-insensitive; hyphens, spaces and en dashes are equivalent ("net-60" =
 * "Net 60"); digits and number words agree ("sixty" = 60, "forty-five" = 45);
 * trailing punctuation and fillers ("um", "please", "make it", "should be")
 * are ignored. The new value is rendered in the matched span's own style.
 *
 * Pure and dependency-free: no imports, no node: modules, so the browser
 * simulator can bundle it too.
 */

export type EditGrammarMethod = 'replace' | 'delete' | 'say';

export interface GrammarEdit {
  ok: boolean;
  after?: string;
  method?: EditGrammarMethod;
  error?: string;
}

export const EDIT_FAILED = "Couldn't change this line";

type Token = {
  /** Display text, without surrounding punctuation. */
  text: string;
  /** Canonical form used for equality ("sixty" and "60" are both "60"). */
  can: string;
  /** Start index in the source string. */
  start: number;
  /** End index (exclusive) in the source string. */
  end: number;
  /** Raw characters between the previous token and this one. */
  sep: string;
  /** Numeric value when this token is a number. */
  number?: number;
  /** True when the number was written with digits. */
  digits?: boolean;
};

const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015-]/;
const WORD_CHAR = /[\p{L}\p{N}'\u2019]/u;

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

const LEAD_FILLERS = [
  'please', 'um', 'uh', 'erm', 'er', 'ah', 'hmm', 'ok', 'okay', 'so', 'well',
  'actually', 'i mean', 'sorry', 'make it', 'make this', 'make that',
  'should be', 'it should be', 'instead', 'use',
];

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripWrappingQuotes(value: string): string {
  let text = value.trim();
  for (const [open, close] of [
    ['"', '"'],
    ['\u201c', '\u201d'],
    ['\u2018', '\u2019'],
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

/** Tidy dictated words: one line, capital first letter, one clear ending. */
export function tidySentence(value: string): string {
  let text = capitalise(oneLine(stripWrappingQuotes(value)));
  if (text.length === 0) return '';
  text = text.replace(/\.{2,}$/, '.');
  if (/[.!?]$/.test(text)) return text;
  if (/[,;:]$/.test(text)) return `${text.slice(0, -1)}.`;
  return `${text}.`;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/** How many words a number starting at index i occupies, and its value. */
function parseNumberAt(tokens: Token[], i: number): { value: number; end: number } | null {
  const token = tokens[i];
  if (!token) return null;
  const text = token.text;
  if (/^\d+$/.test(text)) return { value: Number(text), end: i };

  const lower = text.toLowerCase();
  const next = tokens[i + 1]?.text.toLowerCase();
  if ((lower === 'a' || lower === 'one') && next === 'hundred') {
    return { value: 100, end: i + 1 };
  }
  if (lower === 'hundred') return { value: 100, end: i };

  const tens = TENS[lower];
  if (tens !== undefined) {
    const unit = next !== undefined && next in UNITS ? UNITS[next]! : undefined;
    if (unit !== undefined && unit >= 1 && unit <= 9) return { value: tens + unit, end: i + 1 };
    return { value: tens, end: i };
  }
  const unit = UNITS[lower];
  if (unit !== undefined) return { value: unit, end: i };
  return null;
}

function tokenize(source: string): Token[] {
  const raw: Token[] = [];
  let cursor = 0;
  let prevEnd = 0;
  while (cursor < source.length) {
    if (!isWordChar(source[cursor])) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < source.length && isWordChar(source[cursor])) cursor += 1;
    const text = source.slice(start, cursor);
    raw.push({ text, can: text.toLowerCase(), start, end: cursor, sep: source.slice(prevEnd, start) });
    prevEnd = cursor;
  }

  const out: Token[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i]!;
    const parsed = parseNumberAt(raw, i);
    if (parsed) {
      const last = raw[parsed.end]!;
      out.push({
        text: source.slice(token.start, last.end),
        can: String(parsed.value),
        start: token.start,
        end: last.end,
        sep: token.sep,
        number: parsed.value,
        digits: /^\d+$/.test(token.text),
      });
      i = parsed.end;
    } else {
      out.push(token);
    }
  }
  return out;
}

function separatorStyle(sep: string): string {
  if (sep.length === 1 && DASHES.test(sep)) return sep;
  return DASHES.test(sep) ? '-' : ' ';
}

function numberToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 100) return String(value);
  if (value < 20) {
    return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
      'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
      'eighteen', 'nineteen'][value]!;
  }
  if (value === 100) return 'one hundred';
  const tens = Math.floor(value / 10);
  const unit = value % 10;
  const tensWord = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty',
    'ninety'][tens]!;
  return unit === 0 ? tensWord : `${tensWord}-${['', 'one', 'two', 'three', 'four', 'five',
    'six', 'seven', 'eight', 'nine'][unit]!}`;
}

/** Replace one canonical phrase run inside the sentence, keeping its style. */
function findSpan(sentence: Token[], old: Token[]): { start: number; end: number } | null {
  if (old.length === 0) return null;
  for (let i = 0; i + old.length <= sentence.length; i += 1) {
    let hit = true;
    for (let k = 0; k < old.length; k += 1) {
      if (sentence[i + k]!.can !== old[k]!.can) {
        hit = false;
        break;
      }
    }
    if (hit) return { start: i, end: i + old.length - 1 };
  }
  return null;
}

function renderPhrase(next: Token[], oldSpan: Token[], oldRaw: string, atStart: boolean): string {
  const oldNumber = oldSpan.find((token) => token.number !== undefined);
  const digitStyle = oldNumber ? oldNumber.digits === true : undefined;

  const parts = next.map((token) => {
    if (token.number === undefined) return token.text;
    const digits = digitStyle ?? token.digits === true;
    return digits ? String(token.number) : numberToWords(token.number);
  });

  const oldSeps = oldSpan.slice(1).map((token) => separatorStyle(token.sep));
  let joined: string;
  if (parts.length === oldSpan.length) {
    joined = parts.map((part, index) => (index === 0 ? part : `${oldSeps[index - 1] ?? ' '}${part}`)).join('');
  } else if (parts.length === 1) {
    joined = parts[0]!;
  } else if (oldSeps.length > 0 && oldSeps.every((sep) => sep !== ' ')) {
    joined = parts.join('-');
  } else {
    joined = parts.join(' ');
  }

  const allCaps = oldRaw.length > 1 && /[A-Z]/.test(oldRaw) && oldRaw === oldRaw.toUpperCase();
  if (allCaps) return joined.toUpperCase();
  if (atStart || /^[A-Z]/.test(oldRaw)) return capitalise(joined);
  return lowerFirst(joined);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingFillers(input: string): string {
  let text = input.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of LEAD_FILLERS) {
      const re = new RegExp(`^${escapeRegExp(filler).replace(/\\ /g, '\\s+')}\\b[\\s,;:.!-]*`, 'i');
      const next = text.replace(re, '').trim();
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  return text;
}

function stripTrailingFillers(input: string): string {
  return input
    .replace(/(?:[\s,;:]+(?:please|um|uh|erm|thanks|thank\s+you|ok|okay|for\s+me))+[.!]*$/i, '')
    .trim();
}

function cleanClause(input: string): string {
  return stripTrailingFillers(stripLeadingFillers(stripWrappingQuotes(input)));
}

type ReplaceParse = { next: string; old: string } | { say: string } | null;

const PRONOUNS = new Set(['it', 'this', 'that', 'them', 'these', 'those']);

function isPronoun(value: string): boolean {
  return PRONOUNS.has(value.trim().toLowerCase().replace(/[.!?,;:]+$/, ''));
}

function splitLeadingNot(rest: string): { old: string; next: string } | null {
  const parts = rest.split(/\s*[,;]\s*|\s+\bbut\b\s+|\s+\binstead\b\s*/i).filter((part) => part.trim().length > 0);
  if (parts.length !== 2) return null;
  return { old: parts[0]!, next: parts[1]! };
}

/** "<new>[,] not <old>" and its many spoken forms. */
function parseReplace(note: string): ReplaceParse {
  const source = stripLeadingFillers(stripWrappingQuotes(note));

  const leadingNot = /^(?:no[,;]?\s+)?not\s+(.+)$/i.exec(source);
  if (leadingNot) {
    const split = splitLeadingNot(leadingNot[1]!);
    return split ? { next: split.next, old: split.old } : null;
  }

  const change = /^(?:change|switch)\s+(?:from\s+)?(.+?)\s+(?:to|into)\b\s*[:,;-]?\s*(.+)$/i.exec(source);
  if (change) {
    const target = change[2]!;
    return isPronoun(change[1]!) ? { say: target } : { next: target, old: change[1]! };
  }

  const replace = /^replace\s+(.+?)\s+with\b\s*[:,;-]?\s*(.+)$/i.exec(source);
  if (replace) {
    const target = replace[2]!;
    return isPronoun(replace[1]!) ? { say: target } : { next: target, old: replace[1]! };
  }

  const insteadOf = /^(.+?)\s+(?:instead\s+of|rather\s+than)\s+(.+)$/i.exec(source);
  if (insteadOf) return { next: insteadOf[1]!, old: insteadOf[2]! };

  const commaNot = /^(.+?)\s*[,;]\s*(?:and\s+)?(?:not|but\s+not)\s+(.+)$/i.exec(source);
  if (commaNot) return { next: commaNot[1]!, old: commaNot[2]! };

  const bareNot = /^(.+?)\s+(?:and\s+)?not\s+(.+)$/i.exec(source);
  if (bareNot) {
    const next = bareNot[1]!;
    const old = bareNot[2]!;
    const nextTokens = tokenize(next);
    const oldTokens = tokenize(old);
    if (nextTokens.length > 5 || oldTokens.length > 5) return null;
    return { next, old };
  }

  return null;
}

/** "say …", "instead say …", "change it to …", "replace with …". */
function parseSay(note: string): string | null {
  const source = stripWrappingQuotes(oneLine(note));

  const say = /^(?:please\s+)?(?:say|tell\s+them|write)\b\s*[:,;-]?\s*(.+)$/i.exec(source);
  if (say) return say[1]!;

  const instead = /^instead\b(?!\s+of\b)\s*[,:-]?\s*(?:say\b\s*[,:-]?\s*)?(.+)$/i.exec(source);
  if (instead) return instead[1]!;

  const changeTo = /^(?:change|make)\s+(?:it|this|that)\s+to\b\s*[:,:-]?\s*(.+)$/i.exec(source);
  if (changeTo) return changeTo[1]!;

  const replaceWith = /^replace\s+(?:it|this|that)?\s*with\b\s*[:,:-]?\s*(.+)$/i.exec(source);
  if (replaceWith) return replaceWith[1]!;

  const makeIt = /^make\s+it\b\s*[:,:-]?\s*(.+)$/i.exec(source);
  if (makeIt) return makeIt[1]!;

  return null;
}

const DELETE_RE =
  /^(?:please\s+)?(?:delete|remove|drop|cut|kill|strike)\b(?:\s+(?:this|it|that|the))?(?:\s+(?:sentence|line|point|bit|one))?(?:\s+(?:please|thanks|for\s+me))?[.!]*$/i;

function failure(): GrammarEdit {
  return { ok: false, error: EDIT_FAILED };
}

/** A dictated replacement must not smuggle in a second sentence. */
function isSingleSentence(text: string): boolean {
  if (text.length === 0 || text.includes('\n')) return false;
  return !/[.!?]\s+\p{Lu}/u.test(text);
}

/**
 * Apply one spoken note to one draft sentence. Returns ok:false when nothing
 * matches confidently; the caller decides between an LLM fallback and a short
 * on-glasses error.
 */
export function applyEdit(sentence: string, note: string): GrammarEdit {
  const before = oneLine(sentence);
  const line = oneLine(note);
  if (before.length === 0 || line.length === 0) return failure();

  if (DELETE_RE.test(cleanClause(line))) return { ok: true, method: 'delete' };

  const parsed = parseReplace(line);
  if (parsed && 'say' in parsed) {
    const after = tidySentence(parsed.say);
    return after.length > 0 && isSingleSentence(after)
      ? { ok: true, method: 'say', after }
      : failure();
  }
  if (parsed) {
    const oldText = cleanClause(parsed.old).replace(/^(?:the|a|an)\s+/i, '');
    const nextText = cleanClause(parsed.next);
    const oldTokens = tokenize(oldText);
    const nextTokens = tokenize(nextText);
    const sentenceTokens = tokenize(before);
    if (oldTokens.length === 0 || nextTokens.length === 0) return failure();

    const span = findSpan(sentenceTokens, oldTokens);
    if (!span) return failure();

    const first = sentenceTokens[span.start]!;
    const last = sentenceTokens[span.end]!;
    const oldRaw = before.slice(first.start, last.end);
    const rendered = renderPhrase(nextTokens, sentenceTokens.slice(span.start, span.end + 1), oldRaw, span.start === 0);
    const after = `${before.slice(0, first.start)}${rendered}${before.slice(last.end)}`;
    if (after.trim().length === 0 || after === before) return failure();
    return { ok: true, method: 'replace', after };
  }

  const said = parseSay(line);
  if (said !== null) {
    const after = tidySentence(said);
    if (after.length === 0 || !isSingleSentence(after)) return failure();
    return { ok: true, method: 'say', after };
  }

  return failure();
}

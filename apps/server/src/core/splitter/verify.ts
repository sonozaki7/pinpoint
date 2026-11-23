/**
 * Quote verification (SPEC §7).
 *
 * A deck point may only cite text that exists verbatim in the source. Matching runs
 * exact -> whitespace/markdown-normalized (token anchored) -> best-matching sentence
 * -> drop. Never invent text.
 */

export type QuoteMatch = 'exact' | 'normalized' | 'fallback';

export interface VerifiedQuote {
  quote: string;
  match: QuoteMatch;
}

interface WordToken {
  norm: string;
  start: number;
  end: number;
}

const WORD_RE = /[\p{L}\p{N}]+(?:[._'’\-][\p{L}\p{N}]+)*/gu;

function words(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const value = match[0];
    const index = match.index ?? 0;
    tokens.push({
      norm: value.toLocaleLowerCase().normalize('NFKC'),
      start: index,
      end: index + value.length,
    });
  }
  return tokens;
}

/** Keep the match a substring of the source while respecting the 200 char point limit. */
function limitSpan(source: string, start: number, end: number, maxLength: number): string {
  const raw = source.slice(start, end).trim();
  if (raw.length <= maxLength) return raw;
  const clipped = raw.slice(0, maxLength);
  const space = clipped.lastIndexOf(' ');
  const cut = space >= Math.floor(maxLength * 0.55) ? clipped.slice(0, space) : clipped;
  return cut.trimEnd();
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function sentencesWithOffsets(source: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  try {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    for (const part of segmenter.segment(source)) {
      const text = part.segment.trim();
      if (text.length < 6) continue;
      const leading = part.segment.length - part.segment.trimStart().length;
      out.push({ text, start: part.index + leading, end: part.index + leading + text.length });
    }
  } catch {
    // Extremely old runtimes: fall back to paragraph splitting.
  }
  if (out.length === 0) {
    const blocks = source.split(/\n{2,}/);
    let cursor = 0;
    for (const block of blocks) {
      const start = source.indexOf(block, cursor);
      const trimmed = block.trim();
      if (trimmed.length >= 6 && start >= 0) {
        out.push({ text: trimmed, start: start + block.indexOf(trimmed), end: start + block.indexOf(trimmed) + trimmed.length });
      }
      cursor = start >= 0 ? start + block.length : cursor;
    }
  }
  return out;
}

function scoreOverlap(quoteTokens: string[], sentence: string): number {
  const sentenceTokens = words(sentence).map((token) => token.norm);
  if (quoteTokens.length === 0 || sentenceTokens.length === 0) return 0;
  const sentenceSet = new Set(sentenceTokens);
  let shared = 0;
  for (const token of new Set(quoteTokens)) if (sentenceSet.has(token)) shared += 1;
  const union = new Set([...quoteTokens, ...sentenceTokens]).size;
  return union === 0 ? 0 : shared / union;
}

/** Locate the quote in the source with markdown/whitespace tolerance; returns original substring. */
function normalizedMatch(source: string, quote: string): { start: number; end: number } | null {
  const quoteTokens = words(quote).map((token) => token.norm);
  if (quoteTokens.length === 0) return null;
  const sourceTokens = words(source);
  for (let i = 0; i + quoteTokens.length <= sourceTokens.length; i += 1) {
    let ok = true;
    for (let j = 0; j < quoteTokens.length; j += 1) {
      if (sourceTokens[i + j]?.norm !== quoteTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      let end = sourceTokens[i + quoteTokens.length - 1].end;
      // Keep trailing sentence punctuation when the model copied it too.
      const trailing = quote.trim().match(/[.!?;:]+$/)?.[0];
      if (trailing && source.startsWith(trailing, end)) end += trailing.length;
      return { start: sourceTokens[i].start, end };
    }
  }
  return null;
}

export function verifyQuote(
  source: string,
  rawQuote: string,
  maxLength = 200,
): VerifiedQuote | null {
  const quote = rawQuote.trim();
  if (quote.length < 2 || source.trim().length === 0) return null;

  const exactIndex = source.indexOf(quote);
  if (exactIndex >= 0) {
    return { quote: limitSpan(source, exactIndex, exactIndex + quote.length, maxLength), match: 'exact' };
  }

  const normalized = normalizedMatch(source, quote);
  if (normalized) {
    return { quote: limitSpan(source, normalized.start, normalized.end, maxLength), match: 'normalized' };
  }

  const quoteTokens = words(quote).map((token) => token.norm);
  if (quoteTokens.length < 3) return null;
  let best: { text: string; start: number; end: number; score: number } | null = null;
  for (const sentence of sentencesWithOffsets(source)) {
    const score = scoreOverlap(quoteTokens, sentence.text);
    if (!best || score > best.score) best = { ...sentence, score };
  }
  if (!best || best.score < 0.5) return null;
  return { quote: limitSpan(source, best.start, best.end, maxLength), match: 'fallback' };
}

/** Stable identity used to drop duplicate points that cite the same text. */
export function quoteKey(quote: string): string {
  return normalizeForCompare(quote).replace(/[`*_#>]/g, '');
}

export function bestSentence(source: string, quote: string): string | null {
  const quoteTokens = words(quote).map((token) => token.norm);
  if (quoteTokens.length === 0) return null;
  let best: { text: string; score: number } | null = null;
  for (const sentence of sentencesWithOffsets(source)) {
    const score = scoreOverlap(quoteTokens, sentence.text);
    if (!best || score > best.score) best = { text: sentence.text, score };
  }
  return best && best.score >= 0.5 ? best.text : null;
}

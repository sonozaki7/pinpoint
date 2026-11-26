// Map an exact source quote onto the Telegram message (split part) that contains it.
// Telegram quote-replies require `reply_parameters.quote` to be an exact substring of
// the target message's visible text, so every match returns the real substring.

export interface QuoteMatch {
  /** Index into the stored parts array. */
  partIndex: number;
  /** Exact substring of that part's visible text (safe to send as `quote`). */
  quote: string;
}

/** Telegram rejects quotes longer than 1024 characters. */
const MAX_QUOTE_CHARS = 1000;

export function findQuoteMatch(
  parts: ReadonlyArray<{ plain: string }>,
  rawQuote: string,
): QuoteMatch | undefined {
  if (parts.length === 0) return undefined;
  const trimmed = rawQuote.trim();
  if (!trimmed) return undefined;

  const variants: string[] = [];
  for (const candidate of [
    trimmed,
    stripMarkdown(trimmed).replace(/\s+/g, ' ').trim(),
  ]) {
    const capped = capQuote(candidate);
    if (capped && !variants.includes(capped)) variants.push(capped);
  }

  for (const variant of variants) {
    const exact = findExact(parts, variant);
    if (exact) return exact;
    const flexible = findWhitespaceFlexible(parts, variant);
    if (flexible) return flexible;
  }

  // Fallback: the quote may span a split boundary or include formatting we could not
  // normalise. Use the longest word-prefix that still matches a single message.
  const words = stripMarkdown(trimmed).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  for (let count = words.length - 1; count >= 4; count -= 1) {
    const candidate = words.slice(0, count).join(' ');
    if (candidate.length < 16) break;
    const hit = findExact(parts, candidate) ?? findWhitespaceFlexible(parts, candidate);
    if (hit) return hit;
  }
  return undefined;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, '')
    .trim();
}

/**
 * The paragraph (blank-line separated block) that contains the exact quote, from a
 * message's visible text. Used by "Read on phone" to show the whole step, not just
 * the quoted sentence. When the block is a list, the one item containing the quote is
 * returned (without its bullet/number), not the whole list.
 */
export function paragraphContaining(plain: string, quote: string): string | undefined {
  if (!quote) return undefined;
  const blocks = plain.split(/\n\s*\n/);
  for (const block of blocks) {
    const text = block.trim();
    if (!matches(text, quote)) continue;
    const item = listItemContaining(text, quote);
    return item ?? text;
  }
  return undefined;
}

const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;

function listItemContaining(block: string, quote: string): string | undefined {
  const lines = block.split('\n');
  if (!lines.some((line) => LIST_ITEM.test(line))) return undefined;

  const items: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (LIST_ITEM.test(line)) {
      if (current.length > 0) items.push(current.join('\n').trim());
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) items.push(current.join('\n').trim());

  const hit = items.find((item) => item.includes(quote)) ?? items.find((item) => matches(item, quote));
  return hit?.replace(LIST_ITEM, '').trim();
}

function matches(text: string, quote: string): boolean {
  if (text.includes(quote)) return true;
  const words = quote.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return new RegExp(words.map(escapeRegExp).join('\\s+')).test(text);
}

function findExact(parts: ReadonlyArray<{ plain: string }>, quote: string): QuoteMatch | undefined {
  for (let index = 0; index < parts.length; index += 1) {
    const plain = parts[index]?.plain ?? '';
    if (plain.includes(quote)) return { partIndex: index, quote };
  }
  return undefined;
}

function findWhitespaceFlexible(
  parts: ReadonlyArray<{ plain: string }>,
  quote: string,
): QuoteMatch | undefined {
  const words = quote.split(/\s+/).filter(Boolean);
  if (words.length < 2) return undefined;
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'));
  for (let index = 0; index < parts.length; index += 1) {
    const match = pattern.exec(parts[index]?.plain ?? '');
    if (match) return { partIndex: index, quote: match[0] };
  }
  return undefined;
}

function capQuote(quote: string, max: number = MAX_QUOTE_CHARS): string {
  if (quote.length <= max) return quote;
  const slice = quote.slice(0, max);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n'),
  );
  if (sentenceEnd > max * 0.5) return quote.slice(0, sentenceEnd + 1).trim();
  const space = slice.lastIndexOf(' ');
  return quote.slice(0, space > 0 ? space : max).trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

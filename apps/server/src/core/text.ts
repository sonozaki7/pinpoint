/** Text helpers shared by the splitter, deck builder and composer. */

const DASHES = /[\u2010-\u2015]/g;
const QUOTES = /[\u2018\u2019\u201a\u201b]/g;
const DOUBLE_QUOTES = /[\u201c\u201d\u201e\u201f]/g;
const ELLIPSES = /\u2026/g;

/** Convert typographic characters to ASCII and drop anything outside printable ASCII. */
export function toAscii(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(ELLIPSES, '...')
    .replace(/[^\x20-\x7e\n]/g, '');
}

/** Collapse all whitespace (including newlines) into single spaces. */
export function oneLine(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Remove common inline markdown so a quote reads cleanly on the glasses. */
export function stripInlineMarkdown(input: string): string {
  return input
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut at a word boundary, appending the given suffix when text was shortened. */
export function clipText(input: string, max: number, suffix = ''): string {
  const text = input.trim();
  if (text.length <= max) return text;
  const budget = Math.max(1, max - suffix.length);
  const head = text.slice(0, budget);
  const space = head.lastIndexOf(' ');
  const cut = space >= Math.floor(budget * 0.55) ? head.slice(0, space) : head;
  return `${cut.trimEnd()}${suffix}`;
}

/** One-line, plain-ASCII glasses label. */
export function makeGlance(input: string, max = 44): string {
  return clipText(oneLine(toAscii(stripInlineMarkdown(input))), max, '...');
}

export function isHighRiskText(input: string): boolean {
  return /\b(delete|destroy|drop|truncate|force[- ]?logout|rm -rf|wipe|reset|revoke|overwrite|purge)\b/i.test(
    input,
  );
}

export function safeFileName(input: string, max = 80): string {
  const base = input.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, max);
  return base.length > 0 ? base : 'unknown';
}

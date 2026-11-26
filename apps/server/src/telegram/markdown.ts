// Markdown -> Telegram HTML (parse_mode: "HTML") and safe message splitting.
// Supported: fenced code blocks, inline code, bold, links, headings, bullet/number lists,
// block quotes. Everything else is escaped, so the output is always valid Telegram HTML.
// Long paragraphs become <blockquote expandable> so the phone shows a collapsed section.

export interface RenderedPart {
  /** Telegram HTML for this message (parse_mode: "HTML"). */
  html: string;
  /** Visible text of the message; Telegram's 4096 limit counts these characters. */
  plain: string;
}

/** Message length budget in visible characters (Telegram hard limit is 4096). */
export const MAX_PART_CHARS = 3900;
/** Paragraphs longer than this many visible characters collapse on the phone. */
export const LONG_SECTION_CHARS = 400;
/** Agent replies longer than this collapse into one expandable block. */
export const LONG_FULL_TEXT_CHARS = 600;

/** Wrap each part's HTML in one expandable blockquote; visible text stays identical. */
export function wrapExpandable(parts: ReadonlyArray<RenderedPart>): RenderedPart[] {
  return parts.map((part) => ({
    html: `<blockquote expandable>${part.html}</blockquote>`,
    plain: part.plain,
  }));
}

interface Unit {
  html: string;
  plain: string;
}

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' };

export interface RenderOptions {
  /**
   * Keep every sentence quotable. Telegram rejects a quote reply when the quoted
   * text sits inside a bold or italic entity (QUOTE_TEXT_INVALID), so agent
   * messages that reviewers quote are rendered without inline emphasis. Code,
   * links and block quotes stay, because Telegram accepts quotes from those.
   */
  quoteSafe?: boolean;
  /**
   * Collapse paragraphs longer than LONG_SECTION_CHARS into their own expandable
   * blockquote (default). The full-text message turns this off and wraps the whole
   * body once instead, so the phone shows one collapsed block, not many.
   */
  collapseLong?: boolean;
}

export function markdownToHtml(markdown: string, options: RenderOptions = {}): string {
  return renderUnits(markdown, MAX_PART_CHARS, options)
    .map((unit) => unit.html)
    .join('\n\n');
}

/** Render markdown into one or more Telegram messages, each within `maxChars` visible characters. */
export function renderParts(
  markdown: string,
  maxChars: number = MAX_PART_CHARS,
  options: RenderOptions = {},
): RenderedPart[] {
  const budget = Math.max(500, Math.min(maxChars, MAX_PART_CHARS));
  const units = renderUnits(markdown, budget, options);
  const parts: RenderedPart[] = [];
  let current: RenderedPart | undefined;

  const flush = () => {
    if (current) parts.push(current);
    current = undefined;
  };

  for (const unit of units) {
    if (!current) {
      current = { html: unit.html, plain: unit.plain };
      continue;
    }
    if (current.plain.length + 2 + unit.plain.length <= budget) {
      current.html += `\n\n${unit.html}`;
      current.plain += `\n\n${unit.plain}`;
    } else {
      flush();
      current = { html: unit.html, plain: unit.plain };
    }
  }
  flush();
  return parts;
}

/** Split plain text (no markup) into messages of at most `maxChars` characters at line boundaries. */
export function splitPlainText(text: string, maxChars: number = MAX_PART_CHARS): string[] {
  const budget = Math.max(200, maxChars);
  const chunks = splitRawText(text, budget);
  const parts: string[] = [];
  let current = '';
  for (const chunk of chunks) {
    if (!current) {
      current = chunk;
    } else if (current.length + 2 + chunk.length <= budget) {
      current += `\n\n${chunk}`;
    } else {
      parts.push(current);
      current = chunk;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Visible text of a Telegram HTML string (strip tags, decode entities). */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function renderUnits(
  markdown: string,
  maxChars: number = MAX_PART_CHARS,
  options: RenderOptions = {},
): Unit[] {
  const units: Unit[] = [];
  for (const block of parseBlocks(markdown)) {
    units.push(...renderBlock(block, maxChars, options));
  }
  return units;
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let i = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n').trim() });
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    const fence = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (fence) {
      flushParagraph();
      const opening = fence[1] ?? '```';
      const marker = opening.charAt(0);
      const lang = (fence[2] ?? '').trim().split(/\s+/)[0] ?? '';
      const closePattern = new RegExp('^\\s*' + marker + '{' + opening.length + ',}\\s*$');
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closePattern.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      blocks.push({
        kind: 'code',
        lang: lang.replace(/[^\w+#.-]/g, ''),
        text: body.join('\n'),
      });
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushParagraph();
      i += 1;
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: heading[2] ?? '' });
      i += 1;
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        quoted.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', text: quoted.join('\n').trim() });
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) {
        rows.push((lines[i] ?? '').trim());
        i += 1;
      }
      blocks.push({ kind: 'table', text: rows.join('\n') });
      continue;
    }

    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const ordered = Boolean(item[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const next = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(lines[i] ?? '');
        if (!next) break;
        items.push(next[3] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return blocks;
}

function renderBlock(block: Block, maxChars: number, options: RenderOptions = {}): Unit[] {
  const quoteSafe = options.quoteSafe === true;
  const collapseLong = options.collapseLong !== false;
  switch (block.kind) {
    case 'code':
      return renderCode(block.text, block.lang, maxChars);
    case 'heading': {
      const inner = inlineToHtml(block.text, quoteSafe);
      const html = quoteSafe ? inner : `<b>${inner}</b>`;
      return [{ html, plain: htmlToPlain(html) }];
    }
    case 'list': {
      const lines = block.items.map((item, index) => {
        const bullet = block.ordered ? `${index + 1}.` : '•';
        return `${bullet} ${inlineToHtml(item, quoteSafe)}`;
      });
      return splitOversized({ html: lines.join('\n'), plain: lines.map((line) => htmlToPlain(line)).join('\n') }, maxChars, (text) => {
        // Re-render split groups as plain text lines; list bullets stay visible.
        return { html: escapeHtml(text), plain: text };
      });
    }
    case 'quote': {
      const inner = inlineToHtml(block.text, quoteSafe);
      const plain = htmlToPlain(inner);
      const tag = plain.length > LONG_SECTION_CHARS ? 'blockquote expandable' : 'blockquote';
      const unit: Unit = { html: `<${tag}>${inner}</${tag}>`, plain };
      return splitOversized(unit, maxChars, (text) => ({
        html: `<blockquote expandable>${escapeHtml(text)}</blockquote>`,
        plain: text,
      }));
    }
    case 'table':
      // Monospace keeps the columns aligned; the code renderer also splits huge tables.
      return renderCode(block.text, '', maxChars);
    case 'hr':
      return [{ html: quoteSafe ? '────────' : '<b>────────</b>', plain: '────────' }];
    case 'paragraph':
    default: {
      const rendered = renderParagraph(block.text, quoteSafe, collapseLong);
      // Re-split large paragraphs from their visible text (formatting was already
      // applied to the unsplit paragraph, so only escaping is needed here).
      return splitOversized(rendered, maxChars, (text) => {
        const html =
          collapseLong && text.length > LONG_SECTION_CHARS
            ? `<blockquote expandable>${escapeHtml(text)}</blockquote>`
            : escapeHtml(text);
        return { html, plain: text };
      });
    }
  }
}

function renderParagraph(text: string, quoteSafe = false, collapseLong = true): Unit {
  const inner = inlineToHtml(text, quoteSafe);
  const plain = htmlToPlain(inner);
  if (collapseLong && plain.length > LONG_SECTION_CHARS) {
    return { html: `<blockquote expandable>${inner}</blockquote>`, plain };
  }
  return { html: inner, plain };
}

function renderCode(text: string, lang: string, maxChars: number): Unit[] {
  const wrap = (chunk: string): Unit => {
    const className = lang ? ` class="language-${escapeAttr(lang)}"` : '';
    return {
      html: `<pre><code${className}>${escapeHtml(chunk)}</code></pre>`,
      plain: chunk,
    };
  };

  // A code block is atomic unless it alone exceeds the budget; then it is split by
  // lines (or hard-cut as a last resort) and each piece gets its own <pre><code> pair,
  // so a message boundary never lands inside markup.
  const budget = maxChars - 80;
  if (text.length <= budget) return [wrap(text)];

  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (line.length > budget) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let offset = 0; offset < line.length; offset += budget) {
        chunks.push(line.slice(offset, offset + budget));
      }
      continue;
    }
    if (current && current.length + 1 + line.length > budget) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.map(wrap);
}

function splitOversized(unit: Unit, maxChars: number, rebuild: (text: string) => Unit): Unit[] {
  if (unit.plain.length <= maxChars) return [unit];
  return splitRawText(unit.plain, maxChars - 50).map(rebuild);
}

/** Split text into chunks of at most `max` characters, preferring line then sentence boundaries. */
function splitRawText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  const append = (segment: string) => {
    if (!current) {
      current = segment;
      return;
    }
    if (current.length + 1 + segment.length <= max) {
      current += `\n${segment}`;
    } else {
      push();
      current = segment;
    }
  };

  for (const line of text.split('\n')) {
    if (line.length <= max) {
      append(line);
      continue;
    }
    const sentences = line.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      if (sentence.length <= max) {
        if (current && current.length + 1 + sentence.length <= max) {
          current += ` ${sentence}`;
        } else {
          push();
          current = sentence;
        }
        continue;
      }
      for (let offset = 0; offset < sentence.length; offset += max) {
        push();
        current = sentence.slice(offset, offset + max);
        push();
      }
    }
  }
  push();
  return chunks;
}

function inlineToHtml(text: string, quoteSafe = false): string {
  // Inline code is replaced by a placeholder while bold/links are applied, so a bold span
  // may contain code (for example **run `npm test` first**). Placeholders are restored last.
  const codeSpans: string[] = [];
  const withPlaceholders = text.replace(/`([^`\n]+)`/g, (_whole, code: string) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  const html = formatInline(withPlaceholders, quoteSafe).replace(/\u0000(\d+)\u0000/g, (_whole, index: string) => {
    const code = codeSpans[Number(index)] ?? '';
    return `<code>${escapeHtml(code)}</code>`;
  });
  return html;
}

function formatInline(text: string, quoteSafe = false): string {
  let html = escapeHtml(text);
  if (quoteSafe) {
    // Keep the words, drop the emphasis: Telegram rejects quote replies that land inside
    // bold or italic text, and every sentence of an agent reply must stay quotable.
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    html = html.replace(/__([^_\n]+)__/g, '$1');
  } else {
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    html = html.replace(/__([^_\n]+)__/g, '<b>$1</b>');
  }
  html = html.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_whole, label: string, url: string) => `<a href="${url.replace(/"/g, '%22')}">${label}</a>`,
  );
  return html;
}

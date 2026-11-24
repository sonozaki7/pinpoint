import { describe, expect, it } from 'vitest';
import { messageLink } from '../src/telegram/format.js';
import {
  MAX_PART_CHARS,
  htmlToPlain,
  markdownToHtml,
  renderParts,
  splitPlainText,
} from '../src/telegram/markdown.js';
import { findQuoteMatch, stripMarkdown } from '../src/telegram/quotes.js';

describe('markdown to Telegram HTML', () => {
  it('escapes < > & and renders bold and inline code', () => {
    const html = markdownToHtml('Use `a < b` and **bold** & <tag>');
    expect(html).toContain('<code>a &lt; b</code>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;tag&gt;');
    expect(html).not.toContain('<tag>');
  });

  it('renders fenced code as pre/code with a language class and escaped body', () => {
    const html = markdownToHtml('Before\n\n```ts\nconst x = 1 < 2 && 3;\n```\n\nAfter');
    expect(html).toContain(
      '<pre><code class="language-ts">const x = 1 &lt; 2 &amp;&amp; 3;</code></pre>',
    );
    expect(html.startsWith('Before')).toBe(true);
    expect(html.endsWith('After')).toBe(true);
  });

  it('keeps a fence without a language', () => {
    const html = markdownToHtml('```\nplain\n```');
    expect(html).toBe('<pre><code>plain</code></pre>');
  });

  it('collapses long paragraphs into an expandable blockquote', () => {
    const html = markdownToHtml('word '.repeat(120));
    expect(html.startsWith('<blockquote expandable>')).toBe(true);
    expect(html.endsWith('</blockquote>')).toBe(true);
    expect(markdownToHtml('short paragraph')).toBe('short paragraph');
  });

  it('renders headings, lists and links', () => {
    const html = markdownToHtml('# Title\n\n- one\n- two\n\n[site](https://example.com/a?b=1)');
    expect(html).toContain('<b>Title</b>');
    expect(html).toContain('• one\n• two');
    expect(html).toContain('<a href="https://example.com/a?b=1">site</a>');
  });

  it('applies bold across inline code', () => {
    const html = markdownToHtml('**run `npm test` first**');
    expect(html).toBe('<b>run <code>npm test</code> first</b>');
  });

  it('renders markdown tables as aligned monospaced text', () => {
    const html = markdownToHtml('| step | owner |\n| --- | --- |\n| 1 | t3 |');
    expect(html.startsWith('<pre>')).toBe(true);
    expect(html).toContain('| step | owner |');
    expect(htmlToPlain(html)).toContain('| 1 | t3 |');
  });

  it('decodes HTML back to the visible text', () => {
    expect(htmlToPlain('<b>a &lt; b</b> &amp; <code>c</code>')).toBe('a < b & c');
  });
});

describe('quote-safe source rendering', () => {
  it('drops bold but keeps code, links and the same visible text', () => {
    const source = 'Step 4: **Force-logout everyone** and run `npm test` per [docs](https://example.com).';
    const normal = markdownToHtml(source);
    const safe = markdownToHtml(source, { quoteSafe: true });
    expect(normal).toContain('<b>Force-logout everyone</b>');
    expect(safe).not.toContain('<b>');
    expect(safe).not.toContain('**');
    expect(safe).toContain('<code>npm test</code>');
    expect(safe).toContain('<a href="https://example.com">docs</a>');
    expect(htmlToPlain(safe)).toBe(htmlToPlain(normal));
  });

  it('keeps headings plain so a heading sentence stays quotable', () => {
    const parts = renderParts('# Force-logout everyone\n\nBody.', undefined, { quoteSafe: true });
    expect(parts[0]?.html).not.toContain('<b>');
    expect(findQuoteMatch(parts, 'Force-logout everyone')).toBeDefined();
  });
});

describe('message splitting', () => {
  const paragraph = (label: string): string =>
    `${label}\n\n${'A sentence that explains one part of the plan in plain words. '.repeat(25)}`;

  it('splits long markdown at paragraph boundaries under the limit', () => {
    const source = ['# Plan', paragraph('One'), paragraph('Two'), paragraph('Three'), paragraph('Four')].join(
      '\n\n',
    );
    const parts = renderParts(source);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.plain.length).toBeLessThanOrEqual(MAX_PART_CHARS);
      expect((part.html.match(/<blockquote/g) ?? []).length).toBe(
        (part.html.match(/<\/blockquote>/g) ?? []).length,
      );
    }
    expect(parts.map((part) => part.plain).join('\n\n')).not.toContain('<');
  });

  it('never leaves a <pre> open when a code block must be split', () => {
    const codeLines = Array.from({ length: 400 }, (_, index) => `const value${index} = ${index} < 10;`);
    const source = `Intro.\n\n\`\`\`ts\n${codeLines.join('\n')}\n\`\`\``;
    const parts = renderParts(source);

    expect(parts.length).toBeGreaterThan(1);
    const codeChunks: string[] = [];
    for (const part of parts) {
      const opens = (part.html.match(/<pre>/g) ?? []).length;
      const closes = (part.html.match(/<\/pre>/g) ?? []).length;
      expect(opens).toBe(closes);
      expect((part.html.match(/<pre/g) ?? []).length).toBe((part.html.match(/<\/pre>/g) ?? []).length);
      for (const match of part.html.matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)) {
        codeChunks.push(htmlToPlain(match[1] ?? ''));
      }
    }
    expect(codeChunks.join('\n')).toBe(codeLines.join('\n'));
    for (const part of parts) expect(part.plain.length).toBeLessThanOrEqual(MAX_PART_CHARS);
  });

  it('splits huge quotes and tables without breaking their tags', () => {
    const quote = `> ${'quoted words here '.repeat(400)}`;
    const table = Array.from({ length: 300 }, (_, index) => `| row ${index} | value ${index} |`).join('\n');
    for (const source of [quote, table]) {
      const parts = renderParts(source);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        expect(part.plain.length).toBeLessThanOrEqual(MAX_PART_CHARS);
        expect((part.html.match(/<blockquote/g) ?? []).length).toBe(
          (part.html.match(/<\/blockquote>/g) ?? []).length,
        );
        expect((part.html.match(/<pre/g) ?? []).length).toBe(
          (part.html.match(/<\/pre>/g) ?? []).length,
        );
      }
    }
  });

  it('splits plain composed text without exceeding the budget', () => {
    const composed = Array.from({ length: 60 }, (_, index) => `✗ ${index}. "quote" → reason`).join('\n');
    const chunks = splitPlainText(composed, 300);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
  });
});

describe('quote to split-part mapping', () => {
  const paragraph = (label: string): string =>
    `${label}\n\n${'Another ordinary sentence about the migration and the retry path. '.repeat(30)}`;

  const source = [
    '# Auth refresh fix',
    paragraph('First section'),
    'Step 4: **Force-logout every user** by truncating the `sessions` table.',
    paragraph('Second section'),
    '```ts\nexport function refreshToken() {\n  return withMutex(refreshTokenInner);\n}\n```',
  ].join('\n\n');

  const parts = renderParts(source);

  it('maps a quote in a later part to the part that contains it', () => {
    const match = findQuoteMatch(parts, 'Force-logout every user');
    expect(match).toBeDefined();
    const part = parts[match?.partIndex ?? -1];
    expect(part?.plain.includes('Force-logout every user')).toBe(true);
    expect(match?.quote).toBe('Force-logout every user');
  });

  it('normalises markdown markers when the raw quote has them', () => {
    const match = findQuoteMatch(parts, '**Force-logout every user**');
    expect(match).toBeDefined();
    expect(parts[match?.partIndex ?? -1]?.plain).toContain(match?.quote ?? '');
    expect(match?.quote.includes('**')).toBe(false);
  });

  it('finds code quotes inside the fenced block part', () => {
    const match = findQuoteMatch(parts, 'withMutex(refreshTokenInner)');
    expect(match).toBeDefined();
    expect(parts[match?.partIndex ?? -1]?.plain).toContain('withMutex(refreshTokenInner)');
  });

  it('returns an exact substring even across collapsed whitespace', () => {
    const partsWithBreak = [{ plain: 'We should migrate\nthe existing sessions first.' }];
    const match = findQuoteMatch(partsWithBreak, 'migrate the existing sessions');
    expect(match?.quote).toBe('migrate\nthe existing sessions');
    expect(partsWithBreak[0]?.plain.includes(match?.quote ?? '')).toBe(true);
  });

  it('returns undefined for a quote that is not present', () => {
    expect(findQuoteMatch(parts, 'Drop the users table entirely')).toBeUndefined();
    expect(findQuoteMatch([], 'anything')).toBeUndefined();
  });

  it('strips common markdown syntax', () => {
    expect(stripMarkdown('- **Bold** item with `code` and [link](https://x.dev)')).toBe(
      'Bold item with code and link',
    );
  });
});

describe('message links', () => {
  it('builds a topic link from a -100 chat id', () => {
    expect(messageLink('-1001234567890', 42, 7)).toBe('https://t.me/c/1234567890/42?thread=7');
  });

  it('omits the thread parameter when there is no topic', () => {
    expect(messageLink('-1001234567890', 42)).toBe('https://t.me/c/1234567890/42');
    expect(messageLink('1234567890', 1, 2)).toBe('https://t.me/c/1234567890/1?thread=2');
  });
});

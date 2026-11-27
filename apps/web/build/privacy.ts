import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const SOURCE = fileURLToPath(new URL("../../../docs/privacy.md", import.meta.url));

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline Markdown: code, bold, links. Escapes first, so the source cannot inject markup. */
function inline(raw: string): string {
  const code: string[] = [];
  let text = escapeHtml(raw).replace(/`([^`]+)`/g, (_m, body: string) => {
    code.push(`<code>${body}</code>`);
    return `\u0000${code.length - 1}\u0000`;
  });
  text = text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,])/g, '$1<a href="$2" rel="noopener">$2</a>');
  return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => code[Number(index)] ?? "");
}

/** The slice of Markdown docs/privacy.md uses: headings, paragraphs, bullet lists and tables. */
export function markdownToHtml(source: string): { title: string; updated: string; body: string } {
  const lines = source.split("\n");
  let title = "Privacy";
  let updated = "";
  const out: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushTable = () => {
    if (table.length) {
      const [head = [], ...rows] = table;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`
        + `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
    }
    table = [];
  };
  for (const line of lines) {
    if (/^## Notes for maintainers/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      flushList();
      if (/^\|[\s|:-]+\|$/.test(trimmed)) continue;
      table.push(trimmed.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
      continue;
    }
    flushTable();
    if (/^# /.test(line)) {
      title = line.slice(2).trim();
    } else if (/^## /.test(line)) {
      flushList();
      out.push(`<h2>${inline(line.slice(3).trim())}</h2>`);
    } else if (/^- /.test(line)) {
      list.push(line.slice(2).trim());
    } else if (trimmed === "") {
      flushList();
    } else {
      flushList();
      const stamp = /Last updated:\s*([^.(]+(?:\([^)]*\))?)/.exec(trimmed);
      if (/^Source text for the privacy page/.test(trimmed)) {
        updated = stamp?.[1]?.trim() ?? "";
        continue;
      }
      out.push(`<p>${inline(trimmed)}</p>`);
    }
  }
  flushList();
  flushTable();
  return { title, updated, body: out.join("\n") };
}

function page(stylesheet: string, favicon: string): string {
  let text = readFileSync(SOURCE, "utf8");
  // A maintainer's placeholder must never reach the live page.
  text = text.replace(
    /Questions: TODO\(lead\):[^\n]*?accident\)\./,
    "Questions: open an issue at https://github.com/sonozaki7/pinpoint/issues.",
  );
  if (/TODO\(/.test(text.split("## Notes for maintainers")[0] ?? "")) {
    throw new Error("docs/privacy.md still has a TODO above the maintainer notes");
  }
  const { title, updated, body } = markdownToHtml(text);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Pinpoint</title>
<meta name="description" content="What Pinpoint sends, what it keeps, and for how long.">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#080908">
<link rel="icon" href="${favicon}" type="image/svg+xml">
<link rel="stylesheet" href="${stylesheet}">
</head>
<body>
<main class="page shell">
  <a class="brand" href="./" aria-label="Pinpoint, home"><span class="brand-dot" aria-hidden="true"></span><span>Pinpoint</span></a>
  <div class="page-body">
    <h1>${escapeHtml(title)}</h1>
    ${updated ? `<p class="page-updated">Last updated ${escapeHtml(updated)}</p>` : ""}
    ${body}
  </div>
</main>
</body>
</html>
`;
}

/** Builds privacy.html from docs/privacy.md, so the page and the doc can never drift apart. */
export function privacyPlugin(): Plugin {
  return {
    name: "pinpoint-privacy",
    configureServer(server) {
      server.middlewares.use("/privacy.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(page("/src/site.css", "favicon.svg"));
      });
    },
    generateBundle(_options, bundle) {
      const css = Object.keys(bundle).find((name) => name.endsWith(".css"));
      if (!css) throw new Error("privacy page: no stylesheet in the bundle");
      this.emitFile({ type: "asset", fileName: "privacy.html", source: page(css, "favicon.svg") });
    },
  };
}

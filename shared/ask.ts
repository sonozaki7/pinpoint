// Ask the output instead of scrolling it: find the exact sentence that answers a spoken question.
// Pure and dependency-free (runs on the server, in the glasses mock and in the browser simulator).
// Deterministic retrieval only: the answer is always a verbatim sentence of the source, so it can't
// invent anything. The desk may phrase a shorter answer with a local model, but must cite one of these.

export interface AskSentence {
  text: string; // exact substring of the source
  pointId?: string; // the deck point whose quote contains this sentence, if any
}

export interface AskMatch {
  ok: boolean;
  answer: string; // <= ~90 chars, shown on the glasses
  quote?: string; // the exact source sentence
  pointId?: string;
}

const STOP = new Set(
  ('a an and are as at be but by can could did do does for from had has have how i if in is it its ' +
    'me my of on or our please should so tell that the their them then there these this those to us was ' +
    'we were what when where which who why will with would you your about does say says said step line ' +
    'one ok okay um uh').split(' '),
);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9%$-]+/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 0 && !STOP.has(w))
    .map(stem);
}

/** Sentences as exact substrings of `text` (split on . ! ? and line breaks; list markers stay inside). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?\n]+(?:[.!?]+|$)/g;
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    const start = raw.search(/\S/);
    if (start < 0) continue;
    const sentence = raw.slice(start).replace(/\s+$/, '');
    // Skip markdown headings and bare list numbers; keep real sentences.
    const bare = sentence.replace(/^#+\s*/, '').replace(/^\d+[.)]\s*/, '');
    if (tokens(bare).length < 2) continue;
    out.push(sentence);
  }
  return out;
}

function shorten(sentence: string, max = 90): string {
  const clean = sentence.replace(/^#+\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/\*\*/g, '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 40 ? space : cut.length)}…`;
}

/** Best sentence for the question, or ok:false with "Not in this output." when nothing matches well. */
export function askText(question: string, sentences: AskSentence[]): AskMatch {
  const q = [...new Set(tokens(question))];
  if (q.length === 0 || sentences.length === 0) return { ok: false, answer: 'Not in this output.' };
  const docs = sentences.map((s) => new Set(tokens(s.text)));
  const n = docs.length;
  const idf = (t: string) => {
    const df = docs.filter((d) => d.has(t)).length;
    return df === 0 ? 0 : Math.log(1 + (n - df + 0.5) / (df + 0.5));
  };
  let best = -1;
  let bestScore = 0;
  let bestHits = 0;
  docs.forEach((doc, i) => {
    let score = 0;
    let hits = 0;
    for (const t of q) {
      if (doc.has(t)) {
        score += idf(t) + 0.2;
        hits += 1;
      }
    }
    score /= Math.sqrt(Math.max(4, doc.size));
    if (score > bestScore) {
      best = i;
      bestScore = score;
      bestHits = hits;
    }
  });
  if (best < 0 || bestHits === 0 || bestScore < 0.12) return { ok: false, answer: 'Not in this output.' };
  const hit = sentences[best];
  if (!hit) return { ok: false, answer: 'Not in this output.' };
  return { ok: true, answer: shorten(hit.text), quote: hit.text, ...(hit.pointId ? { pointId: hit.pointId } : {}) };
}

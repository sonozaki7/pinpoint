/** Extract JSON objects from LLM output that may include prose or fenced code blocks. */

function scanObject(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function loosenJson(text: string): string {
  return text
    .replace(/```(?:json)?/gi, '')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(loosenJson(text));
    } catch {
      return undefined;
    }
  }
}

/** All parseable JSON candidates found in the text, in discovery order. */
export function extractJsonCandidates(text: string): unknown[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body) candidates.push(body);
  }
  candidates.push(text.trim());

  let count = 0;
  for (let i = 0; i < text.length && count < 40; i += 1) {
    if (text[i] !== '{') continue;
    const end = scanObject(text, i);
    if (end > i) {
      candidates.push(text.slice(i, end + 1));
      count += 1;
      i = end;
    }
  }

  const parsed: unknown[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = tryParse(candidate);
    if (value !== undefined) parsed.push(value);
  }
  return parsed;
}

/** First candidate object that has a `points` array, or a top-level array. */
export function findSplitPayload(text: string): { headline?: unknown; points: unknown[] } | null {
  for (const candidate of extractJsonCandidates(text)) {
    if (Array.isArray(candidate)) {
      return { points: candidate };
    }
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      if (Array.isArray(record.points)) {
        return { headline: record.headline, points: record.points };
      }
    }
  }
  return null;
}

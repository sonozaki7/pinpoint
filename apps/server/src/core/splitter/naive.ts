import type { Point, PointKind } from '../../../../../shared/contract.js';
import type { SplitInput } from './types.js';
import { isHighRiskText, makeGlance } from '../text.js';
import { verifyQuote } from './verify.js';

interface Candidate {
  quote: string;
  glance: string;
  kind: PointKind;
  risk?: 'high';
  options?: string[];
  questionId?: string;
}

function cleanOption(value: string): string {
  return makeGlance(value, 24);
}

function clipToSource(source: string, quote: string): string {
  const verified = verifyQuote(source, quote, 200);
  return verified ? verified.quote : quote.slice(0, 200);
}

/**
 * Deterministic fallback splitter: no model, no network.
 * Quotes are always taken from the source text so they verify exactly.
 */
export function naiveSplit(input: SplitInput): { headline: string; points: Point[] } {
  const { source, thread } = input;
  const candidates: Candidate[] = [];

  if (source.kind === 'question' && source.question) {
    for (const question of source.question.questions.slice(0, 10)) {
      const verified = verifyQuote(source.text, question.question, 200);
      candidates.push({
        quote: verified?.quote ?? clipToSource(source.text, question.question),
        glance: makeGlance(question.question, 44),
        kind: 'question',
        options: question.options.map(cleanOption).filter(Boolean).slice(0, 4),
        questionId: question.id,
      });
    }
  }

  if (candidates.length === 0) {
    const lines = source.text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (/^#{1,6}\s/.test(trimmed)) continue;
      if (/^[=*_-]{3,}$/.test(trimmed)) continue;

      const isListItem = /^(?:[-*+]|\d+[.)])\s+/.test(trimmed);
      const withoutMarker = trimmed.replace(/^(?:[-*+]|\d+[.)])\s+/, '');
      if (withoutMarker.length < 8) continue;

      // Long paragraphs become one point per sentence.
      const chunks =
        withoutMarker.length > 140
          ? withoutMarker
              .split(/(?<=[.!?])\s+/)
              .map((part) => part.trim())
              .filter((part) => part.length >= 8)
          : [withoutMarker];

      for (const chunk of chunks) {
        const quote = clipToSource(source.text, chunk);
        const kind: PointKind =
          source.kind === 'question'
            ? 'question'
            : thread.attention === 'report'
              ? 'draft'
              : isListItem && thread.attention === 'plan'
                ? 'step'
                : 'claim';
        candidates.push({
          quote,
          glance: makeGlance(chunk, 44),
          kind,
          risk: isHighRiskText(chunk) ? 'high' : undefined,
        });
      }
    }
  }

  const seen = new Set<string>();
  const chosen: Candidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.quote.toLocaleLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push(candidate);
    if (chosen.length >= 10) break;
  }

  const points: Point[] = chosen.map((candidate, index) => ({
    id: `p${index + 1}`,
    index: index + 1,
    kind: candidate.kind,
    glance: candidate.glance || `Point ${index + 1}`,
    quote: candidate.quote,
    ...(candidate.options && candidate.options.length >= 2 ? { options: candidate.options } : {}),
    ...(candidate.questionId ? { questionId: candidate.questionId } : {}),
    ...(candidate.risk ? { risk: candidate.risk } : {}),
  }));

  const headline = makeGlance(
    thread.attention === 'plan'
      ? `${thread.title}: ${points.length} steps`
      : thread.attention === 'question'
        ? thread.title
        : `${thread.title}: ${points.length} points`,
    44,
  );

  return { headline, points };
}

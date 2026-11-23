import type { SplitInput } from './types.js';
import { clipText, oneLine } from '../text.js';

const MAX_SOURCE_CHARS = 14_000;

export const SYSTEM_PROMPT =
  'You split an AI coding agent reply into review points. You output strict JSON only, with no prose and no markdown fences.';

export function buildSplitPrompt(input: SplitInput): string {
  const { thread, source } = input;
  const questionBlock = source.question
    ? `\nThe agent is waiting for an answer to this question (requestId: ${source.question.requestId}):\n${source.question.questions
        .map(
          (q) =>
            `- id: ${q.id}\n  question: ${q.question}\n  options: ${q.options.join(' | ')}`,
        )
        .join('\n')}\nUse these exact option strings for the matching question point and set questionId.`
    : '';

  let text = source.text;
  if (text.length > MAX_SOURCE_CHARS) {
    text = `${text.slice(0, MAX_SOURCE_CHARS)}\n\n[source truncated for the splitter]`;
  }

  return `Split the source message below into 4-10 review points a reviewer can act on one at a time.

Rules:
- Output one JSON object, nothing else: {"headline":"...","points":[{...}]}
- headline: plain ASCII, at most 44 characters.
- points: 4 to 10 items, in source order. For a plan, one point per step.
- Each point: {"kind":"step|claim|question|risk|draft","glance":"...","quote":"...","options":["..."],"questionId":"...","risk":"high"}
- glance: plain ASCII, no emoji, no markdown, at most 44 characters, one line.
- quote: an EXACT, character-for-character substring of the source message (including case and punctuation), at most 200 characters. Never paraphrase, never add words. Copy it.
- kind: "step" for an action step, "claim" for a statement, "question" for a question, "risk" for a destructive or irreversible step, "draft" for an outgoing draft message.
- If the point is destructive or irreversible, set "risk":"high". Otherwise omit risk.
- For each question point, provide 2-4 "options", each at most 24 characters, recommended option first.
- When a questionId is listed below, use it on the matching question point.
${questionBlock}

Thread: ${thread.title}
Attention kind: ${thread.attention}
Source kind: ${source.kind}

Source message:
<<<SOURCE
${text}
SOURCE>>>`;
}

export function normalizeHeadline(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') {
    const clean = clipText(oneLine(raw), 44);
    if (clean.length > 0) return clean;
  }
  return fallback;
}

import type { SplitInput } from './types.js';
import { clipText, oneLine } from '../text.js';

const MAX_SOURCE_CHARS = 14_000;
const MAX_HISTORY_LINES = 6;
const MAX_HISTORY_CHARS = 700;

export const SYSTEM_PROMPT =
  'You are a sharp reviewer for a small glasses screen. You split an AI coding agent reply into ' +
  'review points, decide which few points need the human, and attach one line of grounded evidence ' +
  'to each. You output strict JSON only, with no prose and no markdown fences.';

function historyBlock(input: SplitInput): string {
  const history = (input.source.history ?? [])
    .filter((entry) => entry.text.trim().length > 0)
    .slice(-MAX_HISTORY_LINES);
  if (history.length === 0) return '';
  const lines = history.map(
    (entry) => `${entry.role === 'user' ? 'User' : 'Agent'}: ${clipText(oneLine(entry.text), MAX_HISTORY_CHARS, '...')}`,
  );
  return `\nEarlier messages in this same thread (the user's instructions are evidence):\n${lines.join('\n')}\n`;
}

function noteBlock(input: SplitInput): string {
  const notes = input.source.evidence?.notes ?? [];
  if (notes.length === 0) return '';
  const lines = notes.map(
    (note) => `- ${oneLine(note.title)}: ${clipText(oneLine(note.text), 500, '...')}`,
  );
  return `\nLinked notes found in the workspace (evidence only; never invent from them):\n${lines.join('\n')}\n`;
}

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

A person will read this on a six-line glasses screen. Do the skimming for them: mark only the few
points that truly need their judgment, and leave routine steps unflagged.

Rules:
- Output one JSON object, nothing else: {"headline":"...","points":[{...}]}
- headline: plain ASCII, at most 44 characters.
- points: 4 to 10 items, in source order. For a plan, one point per step.
- Each point: {"kind":"step|claim|question|risk|draft","glance":"...","quote":"...","options":["..."],"questionId":"...","risk":"high","needsYou":true,"flag":"...","why":"..."}
- glance: plain ASCII, no emoji, no markdown, at most 44 characters, one line.
- quote: an EXACT, character-for-character substring of the source message (including case and punctuation), at most 200 characters. Never paraphrase, never add words. Copy it.
- kind: "step" for an action step, "claim" for a statement, "question" for a question, "risk" for a destructive or irreversible step, "draft" for an outgoing draft message.
- If the point is destructive or irreversible, set "risk":"high". Otherwise omit risk.
- For each question point, provide 2-4 "options", each at most 24 characters, recommended option first.
- When a questionId is listed below, use it on the matching question point.

Sorting and evidence:
- needsYou: true only when a person must decide or correct this line. True for: a destructive or
  irreversible action; a change that affects every customer; a money, price, date or deadline
  commitment; an external promise; a contradiction with a linked note or an earlier user instruction;
  a question waiting for their answer. False for routine, reversible work.
- flag: when needsYou is true, one short plain-ASCII label, at most 24 characters, for example
  "signs out everyone" or "needs your call". Omit it otherwise.
- why: when needsYou is true, ONE short plain-ASCII evidence line, at most 60 characters, that says
  where the concern comes from. It MUST be grounded in one of these:
    a) a sentence of the source itself (quote its meaning, not new facts),
    b) an earlier instruction from the user in this thread,
    c) a linked note shown below (name the note),
    d) one of these named risk heuristics, used word for word: "can't be undone",
       "affects every customer", "money or date commitment", "external promise".
  Start with the evidence, not with your opinion. Example: "notes say net-45, not net-60".
- NEVER invent a fact. A why must not contain a number, amount, date or proper noun that is absent
  from the source, the linked notes or the thread history. If you cannot ground it, omit the flag
  and the why and leave needsYou false.
- For a flagged point that only changed since the last review, the server writes the why; do not
  guess at it.
${questionBlock}
${historyBlock(input)}${noteBlock(input)}
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

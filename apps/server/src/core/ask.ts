import type { AskResult, Point } from '../../../../shared/contract.js';
import {
  askText,
  splitSentences,
  tokens,
  type AskMatch,
  type AskSentence,
} from '../../../../shared/ask.js';
import type { LlmConnector } from '../connectors/types.js';
import { extractJsonCandidates } from './splitter/json.js';
import { oneLine, toAscii } from './text.js';
import { groundedFacts } from './evidence.js';

export const ASK_TIMEOUT_MS = 3_000;
const MAX_ANSWER = 90;
const MAX_CANDIDATES = 3;

/**
 * Ask the output instead of scrolling it.
 *
 * `shared/ask.ts` does the deterministic exact-sentence retrieval. When a model
 * is available it only chooses among the top three retrieved sentences and
 * phrases a short answer; the quote is still one of those exact sentences, and
 * the answer may not introduce a fact the sentence does not contain. Any
 * failure (no model, timeout, bad choice, invented number/name) falls back to
 * the retrieval answer.
 */
export interface AskInput {
  question: string;
  sourceText: string;
  points: readonly Point[];
  llm?: LlmConnector;
  timeoutMs?: number;
}

interface Candidate extends AskSentence {
  score: number;
  hits: number;
}

/** Words people say aloud that the output may phrase differently ("rollout" vs "flag ramp"). */
const SYNONYM_GROUPS: string[][] = [
  ['rollout', 'release', 'launch', 'deploy', 'deployment', 'ship', 'ramp', 'flag'],
  ['cost', 'price', 'pricing', 'pay', 'payment', 'budget', 'fee', 'charge'],
  ['risk', 'risky', 'danger', 'dangerous', 'unsafe', 'irreversible', 'undo'],
  ['test', 'tests', 'testing', 'verify', 'check'],
  ['fail', 'failure', 'error', 'bug', 'broken', 'crash'],
  ['delete', 'remove', 'drop', 'wipe'],
];

function expandQuestion(question: string): string {
  const spoken = new Set(question.toLowerCase().match(/[a-z]+/g) ?? []);
  const extra: string[] = [];
  for (const group of SYNONYM_GROUPS) {
    if (group.some((word) => spoken.has(word))) {
      for (const word of group) if (!spoken.has(word)) extra.push(word);
    }
  }
  return extra.length > 0 ? `${question} ${extra.join(' ')}` : question;
}

/** Drop markdown leftovers at the start of a sentence; what remains is still an exact substring. */
function trimMarkup(sentence: string): string {
  return sentence.replace(/^[\s*#>`_-]+/, '').trim();
}

function sentenceList(sourceText: string, points: readonly Point[]): AskSentence[] {
  const out: AskSentence[] = [];
  const seen = new Set<string>();
  for (const raw of splitSentences(sourceText)) {
    const sentence = trimMarkup(raw);
    if (sentence.length === 0 || !sourceText.includes(sentence)) continue;
    if (seen.has(sentence)) continue;
    seen.add(sentence);
    out.push({ text: sentence, ...(pointForSentence(sentence, points) ? { pointId: pointForSentence(sentence, points) } : {}) });
  }
  return out;
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function pointForSentence(sentence: string, points: readonly Point[]): string | undefined {
  const needle = normalizeSpace(sentence);
  if (needle.length === 0) return undefined;
  for (const point of points) {
    const quote = normalizeSpace(point.quote);
    if (quote.length === 0) continue;
    if (quote.includes(needle) || needle.includes(quote)) return point.id;
  }
  return undefined;
}

/** Top overlapping sentences, used only as the model's shortlist. */
function topCandidates(question: string, sentences: AskSentence[]): Candidate[] {
  const wanted = [...new Set(tokens(question))];
  if (wanted.length === 0) return [];
  const docs = sentences.map((sentence) => new Set(tokens(sentence.text)));
  const ranked: Candidate[] = [];
  docs.forEach((doc, index) => {
    let hits = 0;
    for (const token of wanted) if (doc.has(token)) hits += 1;
    if (hits === 0) return;
    ranked.push({
      ...sentences[index]!,
      hits,
      score: hits / Math.sqrt(Math.max(4, doc.size)),
    });
  });
  ranked.sort((a, b) => b.score - a.score || b.hits - a.hits);
  return ranked.slice(0, MAX_CANDIDATES);
}

function cleanAnswer(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const answer = oneLine(toAscii(raw)).replace(/^["']|["']$/g, '').trim();
  if (answer.length < 2 || answer.length > MAX_ANSWER) return undefined;
  return answer;
}

function fromMatch(match: AskMatch): AskResult {
  return {
    ok: match.ok,
    answer: match.answer,
    ...(match.quote ? { quote: match.quote } : {}),
    ...(match.pointId ? { pointId: match.pointId } : {}),
  };
}

interface ModelChoice {
  index?: unknown;
  answer?: unknown;
}

function findChoice(text: string): ModelChoice | undefined {
  for (const candidate of extractJsonCandidates(text)) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const record = candidate as Record<string, unknown>;
      if ('index' in record || 'answer' in record) return record;
    }
  }
  return undefined;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function modelAnswer(
  question: string,
  candidates: Candidate[],
  llm: LlmConnector,
  timeoutMs: number,
): Promise<AskResult | undefined> {
  const list = candidates
    .map((candidate, index) => `${index + 1}. ${candidate.text}`)
    .join('\n');
  const raw = await withTimeout(
    llm.complete({
      system:
        'You answer a question about one AI output using only the candidate sentences. ' +
        'Reply with strict JSON only: {"index":1,"answer":"..."}. index is the 1-based candidate ' +
        `that answers the question, or 0 if none does. answer is at most ${MAX_ANSWER} plain ASCII ` +
        'characters, faithful to that sentence, with no quotation marks and no extra facts.',
      user: `Question: ${question}\n\nCandidate sentences:\n${list}\n\nReply with the JSON object only.`,
      json: true,
      maxTokens: 400,
    }),
    timeoutMs,
  );
  if (!raw) return undefined;

  const choice = findChoice(raw);
  if (!choice) return undefined;
  const index = Number(choice.index);
  if (!Number.isInteger(index) || index < 1 || index > candidates.length) return undefined;
  const answer = cleanAnswer(choice.answer);
  if (!answer) return undefined;

  const chosen = candidates[index - 1]!;
  // The answer must not add a number or proper noun the chosen sentence lacks.
  if (!groundedFacts(answer, chosen.text)) return undefined;
  return {
    ok: true,
    answer,
    quote: chosen.text,
    ...(chosen.pointId ? { pointId: chosen.pointId } : {}),
  };
}

export async function askOutput(input: AskInput): Promise<AskResult> {
  const question = oneLine(input.question).trim();
  const sentences = sentenceList(input.sourceText, input.points);
  const searched = expandQuestion(question);
  const retrieval = askText(searched, sentences);
  if (!input.llm || question.length === 0) return fromMatch(retrieval);

  const candidates = topCandidates(searched, sentences);
  if (candidates.length === 0) return fromMatch(retrieval);

  try {
    const generated = await modelAnswer(
      question,
      candidates,
      input.llm,
      input.timeoutMs ?? ASK_TIMEOUT_MS,
    );
    if (generated) return generated;
  } catch {
    // A model failure is not an error on the glasses: use the exact sentence.
  }
  return fromMatch(retrieval);
}

/** A tiny helper for tests and logs: the retrieval answer with no model. */
export function retrievalAnswer(question: string, text: string, points: readonly Point[]): AskResult {
  return fromMatch(askText(expandQuestion(question), sentenceList(text, points)));
}

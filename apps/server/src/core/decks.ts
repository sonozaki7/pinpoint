import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Deck,
  Point,
  PointKind,
  ThreadAttention,
} from '../../../../shared/contract.js';
import { draftPoints } from './draft.js';
import { errorMessage } from './errors.js';
import { decoratePoints } from './flags.js';
import { asDeck } from './schemas.js';
import { isHighRiskText, makeGlance, safeFileName } from './text.js';
import { naiveSplit } from './splitter/naive.js';
import { quoteKey, verifyQuote } from './splitter/verify.js';
import { normalizeHeadline } from './splitter/prompt.js';
import type { Splitter } from './splitter/types.js';
import type { AttentionSource, AttentionThread } from './types.js';

const KINDS: PointKind[] = ['step', 'claim', 'question', 'risk', 'draft'];
const MAX_POINTS = 10;
const MAX_QUOTE = 200;

function text(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

function inferKind(
  rawKind: unknown,
  source: AttentionSource,
  options: string[] | undefined,
): PointKind {
  if (typeof rawKind === 'string' && KINDS.includes(rawKind as PointKind)) {
    return rawKind as PointKind;
  }
  if (source.kind === 'question') return 'question';
  if (options && options.length >= 2) return 'question';
  if (source.kind === 'plan') return 'step';
  return 'claim';
}

function normalizeOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options = raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => makeGlance(value, 24))
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)
    .slice(0, 4);
  return options.length >= 2 ? options : undefined;
}

/** `flag` is one short glasses label: plain ASCII, <= 24 chars, never invented. */
function normalizeFlag(raw: unknown): string | undefined {
  const value = text(raw);
  if (!value) return undefined;
  const ascii = value.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  if (ascii.length === 0) return undefined;
  return ascii.slice(0, 24).trim();
}

function appFor(thread: AttentionThread, source: AttentionSource): AttentionThread['app'] {
  return thread.app ?? source.app;
}

function matchQuestion(
  quote: string,
  source: AttentionSource,
): { id: string; options: string[] } | undefined {
  if (!source.question) return undefined;
  const key = quoteKey(quote);
  for (const question of source.question.questions) {
    const questionKey = quoteKey(question.question);
    if (key.includes(questionKey) || questionKey.includes(key)) {
      return { id: question.id, options: question.options };
    }
  }
  return undefined;
}

export interface NormalizeOptions {
  /** Add naive points until this many exist (provider output only). */
  minPoints?: number;
  maxPoints?: number;
}

export function normalizePoints(
  rawPoints: unknown[],
  source: AttentionSource,
  attention: ThreadAttention,
  options: NormalizeOptions = {},
): Point[] {
  const maxPoints = options.maxPoints ?? MAX_POINTS;
  const minPoints = options.minPoints ?? 0;
  const seen = new Set<string>();
  const points: Omit<Point, 'id' | 'index'>[] = [];

  for (const raw of rawPoints) {
    if (points.length >= maxPoints) break;
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    const rawQuote = text(candidate.quote);
    if (!rawQuote) continue;
    const verified = verifyQuote(source.text, rawQuote, MAX_QUOTE);
    if (!verified) continue;
    const key = quoteKey(verified.quote);
    if (seen.has(key)) continue;

    const rawOptions = normalizeOptions(candidate.options);
    const matchedQuestion = matchQuestion(verified.quote, source);
    const kind = inferKind(candidate.kind, source, rawOptions ?? matchedQuestion?.options);
    const glance = makeGlance(text(candidate.glance) ?? verified.quote, 44);
    if (!glance) continue;

    const options =
      kind === 'question'
        ? matchedQuestion?.options.map((option) => makeGlance(option, 24)).filter(Boolean).slice(0, 4) ??
          rawOptions
        : undefined;

    let questionId: string | undefined;
    const rawQuestionId = text(candidate.questionId);
    if (source.question) {
      const ids = new Set(source.question.questions.map((question) => question.id));
      if (rawQuestionId && ids.has(rawQuestionId)) questionId = rawQuestionId;
      else if (matchedQuestion) questionId = matchedQuestion.id;
    }

    const riskHigh =
      candidate.risk === 'high' ||
      (candidate.risk === undefined && isHighRiskText(verified.quote) && attention !== 'report');

    seen.add(key);
    points.push({
      kind,
      glance,
      quote: verified.quote,
      ...(options && options.length >= 2 ? { options } : {}),
      ...(questionId ? { questionId } : {}),
      ...(riskHigh ? { risk: 'high' as const } : {}),
      ...(normalizeFlag(candidate.flag) ? { flag: normalizeFlag(candidate.flag) } : {}),
      ...(text(candidate.anchor) ? { anchor: text(candidate.anchor) } : {}),
    });
  }

  // Guarantee every pending question has a point with the right options.
  if (source.kind === 'question' && source.question) {
    for (const question of source.question.questions) {
      if (points.some((point) => point.questionId === question.id)) continue;
      if (points.length >= maxPoints) break;
      const verified = verifyQuote(source.text, question.question, MAX_QUOTE);
      if (!verified) continue;
      points.push({
        kind: 'question',
        glance: makeGlance(question.question, 44),
        quote: verified.quote,
        options: question.options.map((option) => makeGlance(option, 24)).filter(Boolean).slice(0, 4),
        questionId: question.id,
      });
    }
  }

  // Provider produced fewer than four points: top up from the source, never invented.
  if (points.length < minPoints) {
    const naive = naiveSplit({ thread: placeholderThread(attention), source });
    for (const point of naive.points) {
      if (points.length >= minPoints) break;
      const key = quoteKey(point.quote);
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({
        kind: point.kind,
        glance: point.glance,
        quote: point.quote,
        ...(point.options ? { options: point.options } : {}),
        ...(point.questionId ? { questionId: point.questionId } : {}),
        ...(point.risk ? { risk: point.risk } : {}),
      });
    }
  }

  return points.slice(0, maxPoints).map((point, index) => ({
    ...point,
    id: `p${index + 1}`,
    index: index + 1,
  }));
}

function placeholderThread(attention: ThreadAttention): AttentionThread {
  return {
    threadId: 'thread',
    title: 'Thread',
    project: '',
    attention,
    updatedAt: new Date().toISOString(),
  };
}

function defaultHeadline(thread: AttentionThread, pointCount: number): string {
  switch (thread.attention) {
    case 'plan':
      return makeGlance(`${thread.title}: ${pointCount} steps`, 44);
    case 'question':
      return makeGlance(thread.title, 44);
    case 'failed':
      return makeGlance(`${thread.title}: run failed`, 44);
    case 'report':
      return makeGlance(`${thread.title}: ${pointCount} points`, 44);
  }
}

function makeDeck(
  thread: AttentionThread,
  source: AttentionSource,
  points: Point[],
  headline: string,
  splitter: string,
): Deck {
  return {
    threadId: thread.threadId,
    sourceMessageId: source.sourceMessageId,
    title: thread.title,
    attention: thread.attention,
    headline: makeGlance(headline, 44) || defaultHeadline(thread, points.length),
    points,
    createdAt: new Date().toISOString(),
    splitter,
  };
}

export async function buildDeck(
  splitter: Splitter,
  thread: AttentionThread,
  source: AttentionSource,
): Promise<Deck> {
  const app = appFor(thread, source);
  // A Gmail draft is reviewed one sentence at a time; no model is involved.
  if (app === 'gmail') {
    const points = decoratePoints(draftPoints(source.text), app, source);
    return makeDeck(
      thread,
      source,
      points,
      defaultHeadline(thread, points.length),
      points.length > 0 ? 'sentences' : 'fallback:naive',
    );
  }
  try {
    const split = await splitter.split({ thread, source });
    const normalized = normalizePoints(split.points, source, thread.attention, { minPoints: 4 });
    const points = decoratePoints(normalized, app, source);
    return makeDeck(
      thread,
      source,
      points,
      normalizeHeadline(split.headline, defaultHeadline(thread, points.length)),
      split.splitter,
    );
  } catch (error) {
    console.warn(`[deck] splitter threw, using naive split: ${errorMessage(error)}`);
    const naive = naiveSplit({ thread, source });
    const points = decoratePoints(naive.points, app, source);
    return makeDeck(thread, source, points, naive.headline, 'fallback:naive');
  }
}

/** A deck for the glasses: block anchors stay on the server. */
export function publicDeck(deck: Deck): Deck {
  return {
    ...deck,
    points: deck.points.map(({ anchor: _anchor, ...point }) => point),
  };
}

/** Turn a precomputed demo deck into a verified deck for this thread source. */
export function deckFromPrecomputed(
  precomputed: Deck,
  thread: AttentionThread,
  source: AttentionSource,
): Deck {
  const app = appFor(thread, source);
  let points = normalizePoints(precomputed.points, source, thread.attention, { minPoints: 0 });
  if (points.length === 0) {
    const naive = naiveSplit({ thread, source });
    points = naive.points;
  }
  points = decoratePoints(points, app, source);
  return {
    threadId: thread.threadId,
    sourceMessageId: source.sourceMessageId,
    title: thread.title,
    attention: thread.attention,
    headline: makeGlance(precomputed.headline, 44) || defaultHeadline(thread, points.length),
    points,
    createdAt: precomputed.createdAt || new Date().toISOString(),
    splitter: 'fixture',
  };
}

/** `<sourceMessageId>.json` when the id is filesystem-safe; hash suffix otherwise. */
function fileNameFor(sourceMessageId: string): string {
  if (/^[A-Za-z0-9._-]{1,100}$/.test(sourceMessageId) && sourceMessageId !== '.' && sourceMessageId !== '..') {
    return `${sourceMessageId}.json`;
  }
  const hash = createHash('sha1').update(sourceMessageId).digest('hex').slice(0, 10);
  return `${safeFileName(sourceMessageId, 70)}-${hash}.json`;
}

/** Disk + memory deck cache keyed by sourceMessageId (SPEC §7). */
export class DeckStore {
  private readonly dir: string;
  private readonly bySource = new Map<string, Deck>();
  private readonly byThread = new Map<string, Deck>();

  constructor(dir: string) {
    this.dir = path.join(dir, 'decks');
    this.load();
  }

  private load(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      for (const name of fs.readdirSync(this.dir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const raw: unknown = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
          const deck = asDeck(raw);
          if (!deck) continue;
          this.bySource.set(deck.sourceMessageId, deck);
          this.byThread.set(deck.threadId, deck);
        } catch {
          // A corrupted cache entry must not stop the server.
        }
      }
    } catch (error) {
      console.warn(`[deck] cache folder unavailable: ${errorMessage(error)}`);
    }
  }

  getForThread(threadId: string): Deck | undefined {
    return this.byThread.get(threadId);
  }

  getForSource(sourceMessageId: string): Deck | undefined {
    return this.bySource.get(sourceMessageId);
  }

  /** Re-index a cached deck for its thread without rewriting the file. */
  adopt(deck: Deck): void {
    this.bySource.set(deck.sourceMessageId, deck);
    this.byThread.set(deck.threadId, deck);
  }

  put(deck: Deck): void {
    this.bySource.set(deck.sourceMessageId, deck);
    this.byThread.set(deck.threadId, deck);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const target = path.join(this.dir, fileNameFor(deck.sourceMessageId));
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(deck, null, 2), 'utf8');
      fs.renameSync(tmp, target);
    } catch (error) {
      console.warn(`[deck] could not cache deck: ${errorMessage(error)}`);
    }
  }

  /** Drop the in-memory entry for a thread (used by tests). */
  forget(threadId: string): void {
    this.byThread.delete(threadId);
  }
}

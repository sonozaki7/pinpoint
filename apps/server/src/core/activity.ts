import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Deck, Point } from '../../../../shared/contract.js';
import type { LlmConnector } from '../connectors/types.js';
import { errorMessage } from './errors.js';
import { groundedFacts } from './evidence.js';
import { extractJsonCandidates } from './splitter/json.js';
import { clipText, makeGlance, oneLine, toAscii } from './text.js';
import type { AgentUpdate, AttentionSource, AttentionThread } from './types.js';

/**
 * "Since you looked": one line per agent update the device has not seen yet.
 *
 * The item is read-only. Sending it (one tap on the glasses) marks every line
 * as seen for that device, so the next inbox shows only what happened after.
 */

export const CATCH_UP_ID = 'catch-up';
export const CATCH_UP_TITLE = 'Since you looked';
export const MAX_CATCH_UP_LINES = 6;
export const LINE_MAX = 44;
const PHRASE_MAX = 32;
const FIRST_LOOK_WINDOW_MS = 24 * 60 * 60_000;
const MAX_SEEN_KEYS = 400;
const MAX_SEEN_DEVICES = 200;
const PHRASE_TIMEOUT_MS = 2_500;
const PHRASE_CACHE_MAX = 500;

export interface CatchUpEntry {
  /** Stable per update; seen-tracking works on this. */
  key: string;
  /** The thread this line is about (tap opens it). */
  threadRef: string;
  /** Full glance line, <= 44 ASCII chars, e.g. "login-fix: agent replied, migrating sessions". */
  line: string;
  needsYou?: boolean;
}

export interface CatchUp {
  entries: CatchUpEntry[];
  thread: AttentionThread;
  source: AttentionSource;
  deck: Deck;
}

/** "title: phrase" in at most 44 plain ASCII chars; the title gives way first. */
export function composeLine(title: string, phrase: string, max = LINE_MAX): string {
  const clean = oneLine(toAscii(phrase)).trim();
  let name = oneLine(toAscii(title)).trim();
  if (clean.length === 0) return makeGlance(name, max);
  if (name.length === 0) return makeGlance(clean, max);
  const room = max - 2 - clean.length;
  if (name.length > room) name = clipText(name, Math.max(10, room));
  const line = `${name}: ${clean}`;
  return line.length <= max ? line : makeGlance(line, max);
}

export function defaultPhrase(kind: AgentUpdate['kind']): string {
  switch (kind) {
    case 'question':
      return 'needs your answer';
    case 'plan':
      return 'plan ready, needs you';
    case 'failed':
      return 'run failed, needs you';
    case 'replied':
      return 'agent replied';
  }
}

export function updateNeedsYou(kind: AgentUpdate['kind']): boolean {
  return kind !== 'replied';
}

export function buildCatchUp(entries: readonly CatchUpEntry[], now = new Date()): CatchUp | undefined {
  const list = entries.slice(0, MAX_CATCH_UP_LINES);
  if (list.length === 0) return undefined;
  const text = list.map((entry) => entry.line).join('\n');
  const digest = createHash('sha1')
    .update(list.map((entry) => entry.key).join('|'))
    .digest('hex')
    .slice(0, 12);
  const sourceMessageId = `catch-up-${digest}`;
  const points: Point[] = list.map((entry, index) => ({
    id: `p${index + 1}`,
    index: index + 1,
    kind: 'claim',
    glance: entry.line,
    quote: entry.line,
    threadRef: entry.threadRef,
    ...(entry.needsYou ? { flag: 'needs you', why: 'The agent is waiting for you' } : {}),
  }));
  const thread: AttentionThread = {
    threadId: CATCH_UP_ID,
    title: CATCH_UP_TITLE,
    project: 'Agents',
    attention: 'report',
    updatedAt: now.toISOString(),
  };
  const source: AttentionSource = { sourceMessageId, text, kind: 'reply' };
  const deck: Deck = {
    threadId: CATCH_UP_ID,
    sourceMessageId,
    title: CATCH_UP_TITLE,
    attention: 'report',
    headline: makeGlance(`${list.length} update${list.length === 1 ? '' : 's'} since you looked`, LINE_MAX),
    points,
    createdAt: now.toISOString(),
    splitter: 'catch-up',
  };
  return { entries: list, thread, source, deck };
}

/** Which updates each device has already seen. Persisted on the desk, in memory elsewhere. */
export class SeenTracker {
  private readonly file?: string;
  private readonly byDevice = new Map<string, string[]>();

  constructor(dataDir?: string) {
    if (!dataDir) return;
    this.file = path.join(dataDir, 'seen.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as {
        devices?: Record<string, unknown>;
      };
      for (const [device, keys] of Object.entries(raw.devices ?? {})) {
        if (Array.isArray(keys) && keys.every((key) => typeof key === 'string')) {
          this.byDevice.set(device, keys as string[]);
        }
      }
    } catch {
      // Nothing seen yet.
    }
  }

  has(deviceId: string, key: string): boolean {
    return this.byDevice.get(deviceId)?.includes(key) ?? false;
  }

  /** True once this device has marked anything as seen. */
  known(deviceId: string): boolean {
    return this.byDevice.has(deviceId);
  }

  add(deviceId: string, keys: readonly string[]): void {
    const merged = [...(this.byDevice.get(deviceId) ?? []), ...keys];
    const unique = [...new Set(merged)].slice(-MAX_SEEN_KEYS);
    this.byDevice.delete(deviceId);
    this.byDevice.set(deviceId, unique);
    while (this.byDevice.size > MAX_SEEN_DEVICES) {
      const oldest = this.byDevice.keys().next().value;
      if (oldest === undefined) break;
      this.byDevice.delete(oldest);
    }
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({ devices: Object.fromEntries(this.byDevice) }, null, 2),
        'utf8',
      );
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.warn(`[catch-up] could not save seen updates: ${errorMessage(error)}`);
    }
  }
}

export type CatchUpProvider = (deviceId: string) => Promise<CatchUpEntry[]>;

/**
 * Per-device catch-up state. `provider` lists every recent update; entries the
 * device has already seen are dropped. What was shown is what gets marked seen.
 */
export class CatchUpService {
  private readonly pending = new Map<string, CatchUp>();

  constructor(
    private readonly provider: CatchUpProvider,
    private readonly seen: SeenTracker,
  ) {}

  async forDevice(deviceId: string): Promise<CatchUp | undefined> {
    let all: CatchUpEntry[];
    try {
      all = await this.provider(deviceId);
    } catch (error) {
      console.warn(`[catch-up] could not list updates: ${errorMessage(error)}`);
      return this.pending.get(deviceId);
    }
    const unseen = all.filter((entry) => !this.seen.has(deviceId, entry.key));
    const built = buildCatchUp(unseen);
    if (!built) {
      this.pending.delete(deviceId);
      return undefined;
    }
    // Keep the same deck while the update list is unchanged.
    const current = this.pending.get(deviceId);
    if (current && current.deck.sourceMessageId === built.deck.sourceMessageId) return current;
    this.pending.set(deviceId, built);
    return built;
  }

  current(deviceId: string): CatchUp | undefined {
    return this.pending.get(deviceId);
  }

  /** Sending the catch-up marks exactly the lines that were shown as seen. */
  markSeen(deviceId: string): number {
    const shown = this.pending.get(deviceId);
    if (!shown) return 0;
    this.seen.add(
      deviceId,
      shown.entries.map((entry) => entry.key),
    );
    this.pending.delete(deviceId);
    return shown.entries.length;
  }
}

// --- Desk: lines from real T3 thread activity --------------------------------

export const FIRST_LOOK_MS = FIRST_LOOK_WINDOW_MS;

interface PhraseChoice {
  i?: unknown;
  phrase?: unknown;
}

function cleanPhrase(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const phrase = oneLine(toAscii(raw)).replace(/^["']|["'.]+$/g, '').trim();
  if (phrase.length < 3 || phrase.length > PHRASE_MAX) return undefined;
  return phrase;
}

/**
 * Ask the model for one short phrase per update ("agent replied, migrating
 * sessions"). A phrase is kept only when every number and name in it appears
 * in that agent's own message or the thread title; otherwise the plain default
 * phrase for the update kind is used.
 */
export async function phraseUpdates(
  updates: readonly AgentUpdate[],
  llm: LlmConnector | undefined,
  timeoutMs = PHRASE_TIMEOUT_MS,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!llm || updates.length === 0) return out;
  const list = updates
    .map(
      (update, index) =>
        `${index + 1}. [${update.kind}] ${oneLine(update.title)}: ${clipText(oneLine(update.text), 700, '...')}`,
    )
    .join('\n');
  let raw: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    raw = await Promise.race([
      llm.complete({
        system:
          'You write one very short status phrase per agent update, for a tiny glasses display. ' +
          `Reply with strict JSON only: {"lines":[{"i":1,"phrase":"..."}]}. Each phrase is at most ${PHRASE_MAX} ` +
          'plain ASCII characters, says what the agent did or needs, for example "agent replied, migrating ' +
          'sessions" or "done, PR opened" or "needs you: pick a date". Use only facts in that update. ' +
          'No quotes, no emoji, no title.',
        user: `Updates:\n${list}\n\nReply with the JSON object only.`,
        json: true,
        maxTokens: 600,
      }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch {
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!raw) return out;
  for (const candidate of extractJsonCandidates(raw)) {
    const lines = (candidate as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines)) continue;
    for (const entry of lines as PhraseChoice[]) {
      const index = Number(entry?.i);
      const update = Number.isInteger(index) ? updates[index - 1] : undefined;
      const phrase = cleanPhrase(entry?.phrase);
      if (!update || !phrase) continue;
      if (!groundedFacts(phrase, `${update.title}\n${update.text}`)) continue;
      out.set(update.key, phrase);
    }
    break;
  }
  return out;
}

/** Turns T3 updates into catch-up lines; phrasing is cached so polling is free. */
export function createT3CatchUpProvider(options: {
  activity: (sinceMs: number) => Promise<AgentUpdate[]>;
  llm?: LlmConnector;
  now?: () => number;
}): CatchUpProvider {
  const now = options.now ?? Date.now;
  const phrases = new Map<string, string>();
  return async () => {
    const updates = (await options.activity(now() - FIRST_LOOK_WINDOW_MS)).slice(
      0,
      MAX_CATCH_UP_LINES + 4,
    );
    const missing = updates.filter((update) => !phrases.has(update.key));
    if (missing.length > 0) {
      const generated = await phraseUpdates(missing, options.llm);
      for (const update of missing) {
        phrases.set(update.key, generated.get(update.key) ?? defaultPhrase(update.kind));
      }
      while (phrases.size > PHRASE_CACHE_MAX) {
        const oldest = phrases.keys().next().value;
        if (oldest === undefined) break;
        phrases.delete(oldest);
      }
    }
    return updates.map((update) => {
      const needs = updateNeedsYou(update.kind);
      const phrase = phrases.get(update.key) ?? defaultPhrase(update.kind);
      return {
        key: update.key,
        threadRef: update.threadId,
        line: composeLine(update.title, phrase),
        ...(needs ? { needsYou: true } : {}),
      };
    });
  };
}

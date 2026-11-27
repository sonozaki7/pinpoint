import fs from 'node:fs';
import path from 'node:path';
import type { AgentStatus, Deck } from '../../../../shared/contract.js';
import type { CatchUpEntry } from '../core/activity.js';
import { loadDemoData } from '../core/demo.js';
import type { Env } from '../core/env.js';
import { errorMessage } from '../core/errors.js';
import type { AttentionSource, AttentionThread } from '../core/types.js';
import { attentionSourceSchema, attentionThreadSchema } from '../core/schemas.js';

export type SamplePersona = 'mixed' | 'developer' | 'everyday';
export const SAMPLE_PERSONAS: readonly SamplePersona[] = ['mixed', 'developer', 'everyday'];
export const DEFAULT_PERSONA: SamplePersona = 'mixed';

/** The X-Pinpoint-Sample header value, or the default persona. */
export function parsePersona(raw: string | null | undefined): SamplePersona {
  const value = raw?.trim().toLowerCase() ?? '';
  return (SAMPLE_PERSONAS as readonly string[]).includes(value)
    ? (value as SamplePersona)
    : DEFAULT_PERSONA;
}

export interface SampleThreadDefinition {
  thread: AttentionThread;
  source: AttentionSource;
  /** Precomputed fixture deck; verified against the source when a device opens it. */
  deck: Deck;
}

export interface SampleWorkspaceDefinition {
  /** Threads of the default persona, in inbox order (kept for callers that predate personas). */
  threads: SampleThreadDefinition[];
  /** Every fixture thread the sample can open, inbox or not. */
  byId: Map<string, SampleThreadDefinition>;
  /** Thread ids in inbox order, per persona. */
  personas: Record<SamplePersona, string[]>;
  /** "Since you looked" lines, per persona. */
  catchUp: Record<SamplePersona, CatchUpEntry[]>;
  /** Sample glance numbers (agents running, done today), per persona. */
  status: Record<SamplePersona, Pick<AgentStatus, 'working' | 'doneToday'>>;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function idList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
}

function personaTable<T>(raw: unknown, read: (value: unknown) => T, fallback: T): Record<SamplePersona, T> {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    mixed: record.mixed === undefined ? fallback : read(record.mixed),
    developer: record.developer === undefined ? fallback : read(record.developer),
    everyday: record.everyday === undefined ? fallback : read(record.everyday),
  };
}

function readCatchUp(file: string, persona: SamplePersona, value: unknown): CatchUpEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index): CatchUpEntry[] => {
    const record = entry as { threadRef?: unknown; line?: unknown; needsYou?: unknown };
    if (typeof record?.threadRef !== 'string' || typeof record.line !== 'string') {
      throw new Error(`${file}: ${persona} entry ${index + 1} needs threadRef and line`);
    }
    return [
      {
        key: `sample:${persona}:${record.threadRef}`,
        threadRef: record.threadRef,
        line: record.line,
        ...(record.needsYou === true ? { needsYou: true } : {}),
      },
    ];
  });
}

/** Sample-only threads (demo/sample/threads/*.json): same shape as a fixture, never in demo mode. */
function loadHiddenThreads(dir: string): SampleThreadDefinition[] {
  if (!fs.existsSync(dir)) return [];
  const out: SampleThreadDefinition[] = [];
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort()) {
    const raw = readJson(path.join(dir, name));
    const thread = attentionThreadSchema.safeParse(raw.thread);
    const source = attentionSourceSchema.safeParse(raw.source);
    if (!thread.success || !source.success || !raw.deck || typeof raw.deck !== 'object') {
      throw new Error(`Sample thread ${name} is not a valid fixture`);
    }
    const deck = raw.deck as Partial<Deck>;
    out.push({
      thread: thread.data as AttentionThread,
      source: source.data as AttentionSource,
      deck: {
        threadId: thread.data.threadId,
        sourceMessageId: source.data.sourceMessageId,
        title: thread.data.title,
        attention: thread.data.attention,
        headline: typeof deck.headline === 'string' ? deck.headline : thread.data.title,
        points: (deck.points ?? []) as Deck['points'],
        createdAt: typeof deck.createdAt === 'string' ? deck.createdAt : new Date().toISOString(),
        splitter: 'fixture',
      },
    });
  }
  return out;
}

/**
 * The cloud sample workspace. demo/sample/workspace.json names the fixture
 * threads of each persona (developer, everyday, mixed) in inbox order, the
 * sample glance numbers, and demo/sample/catch-up.json the "Since you looked"
 * lines. Fixtures come from demo/fixtures plus demo/sample/threads; decks are
 * used as-is, so every device opens instantly.
 */
export function loadSampleWorkspace(env: Env): SampleWorkspaceDefinition {
  const dir = path.join(env.repoRoot, 'demo', 'sample');
  const file = path.join(dir, 'workspace.json');
  let raw: Record<string, unknown>;
  try {
    raw = readJson(file);
  } catch (error) {
    throw new Error(`Could not read the cloud sample workspace at ${file}: ${errorMessage(error)}`);
  }

  const legacy = idList(raw.threads);
  const personas = personaTable<string[]>(raw.personas, idList, legacy);
  const defaultIds = personas[DEFAULT_PERSONA];
  if (defaultIds.length === 0) throw new Error(`Cloud sample workspace at ${file} lists no threads`);

  const demo = loadDemoData(env.fixturesDir);
  const defined = new Map<string, SampleThreadDefinition>();
  const add = (fixture: { thread: AttentionThread; source: AttentionSource; deck?: Deck }): void => {
    if (!fixture.deck) return;
    defined.set(fixture.thread.threadId, {
      thread: { ...fixture.thread },
      source: structuredClone(fixture.source),
      deck: fixture.deck,
    });
  };
  for (const fixture of demo.fixtures) add(fixture);
  for (const hidden of loadHiddenThreads(path.join(dir, 'threads'))) {
    defined.set(hidden.thread.threadId, hidden);
  }

  const get = (id: string): SampleThreadDefinition => {
    const found = defined.get(id);
    if (!found) {
      throw new Error(
        `Cloud sample workspace lists "${id}", but no fixture with that thread id exists in ${env.fixturesDir} or ${path.join(dir, 'threads')}`,
      );
    }
    return found;
  };
  for (const ids of Object.values(personas)) for (const id of ids) get(id);

  let catchUpRaw: Record<string, unknown> = {};
  const catchUpFile = path.join(dir, 'catch-up.json');
  if (fs.existsSync(catchUpFile)) catchUpRaw = readJson(catchUpFile);
  const catchUp: Record<SamplePersona, CatchUpEntry[]> = { mixed: [], developer: [], everyday: [] };
  for (const persona of SAMPLE_PERSONAS) {
    catchUp[persona] = readCatchUp(catchUpFile, persona, catchUpRaw[persona]);
    for (const entry of catchUp[persona]) get(entry.threadRef);
  }

  const statusRaw = (raw.status && typeof raw.status === 'object' ? raw.status : {}) as Record<string, unknown>;
  const readStatus = (value: unknown): Pick<AgentStatus, 'working' | 'doneToday'> => {
    const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const count = (n: unknown, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
    return { working: count(record.working, 2), doneToday: count(record.doneToday, 4) };
  };
  const status = personaTable(statusRaw, readStatus, readStatus(undefined));

  const byId = new Map(defined);
  return {
    threads: defaultIds.map(get),
    byId,
    personas,
    catchUp,
    status,
  };
}

import fs from 'node:fs';
import path from 'node:path';
import type { Deck } from '../../../../shared/contract.js';
import { BUILTIN_FIXTURES, cloneFixtures, type Fixture } from './builtinFixtures.js';
import type { Env } from './env.js';
import { attentionSourceSchema, attentionThreadSchema, asDeck } from './schemas.js';
import type { AttentionSource, AttentionThread } from './types.js';

interface DemoData {
  fixtures: Fixture[];
  precomputed: Map<string, Deck>;
}

function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function coerceDeck(raw: unknown, thread: AttentionThread, source: AttentionSource): Deck | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.points) || record.points.length === 0) return null;
  return {
    threadId: thread.threadId,
    sourceMessageId: source.sourceMessageId,
    title: thread.title,
    attention: thread.attention,
    headline: typeof record.headline === 'string' ? record.headline : thread.title,
    // Point objects stay raw here; deckFromPrecomputed verifies and normalizes each one.
    points: record.points as Deck['points'],
    createdAt:
      typeof record.createdAt === 'string' && record.createdAt.length > 0
        ? record.createdAt
        : new Date().toISOString(),
    splitter: 'fixture',
  };
}

/** Read demo/fixtures/*.json. Missing folder or no valid files -> built-in fixtures. */
export function loadDemoData(fixturesDir: string): DemoData {
  const fixtures: Fixture[] = [];
  const precomputed = new Map<string, Deck>();

  try {
    if (fs.existsSync(fixturesDir)) {
      const names = fs
        .readdirSync(fixturesDir)
        .filter((name) => name.endsWith('.json'))
        .filter((name) => name !== 'transcripts.json') // scripted voice notes, not a thread fixture
        .sort();
      for (const name of names) {
        try {
          const raw = readJsonFile(path.join(fixturesDir, name)) as Record<string, unknown>;
          const thread = attentionThreadSchema.safeParse(raw.thread);
          const source = attentionSourceSchema.safeParse(raw.source);
          if (!thread.success || !source.success) {
            console.warn(`[demo] skipped fixture ${name}: thread/source shape is invalid`);
            continue;
          }
          const fixture: Fixture = {
            thread: thread.data as AttentionThread,
            source: source.data as AttentionSource,
          };
          const deck = coerceDeck(raw.deck, fixture.thread, fixture.source);
          if (deck) {
            fixture.deck = deck;
            precomputed.set(fixture.thread.threadId, deck);
          }
          fixtures.push(fixture);
        } catch (error) {
          console.warn(`[demo] skipped fixture ${name}: ${(error as Error).message}`);
        }
      }
    }
  } catch (error) {
    console.warn(`[demo] could not read fixtures folder: ${(error as Error).message}`);
  }

  if (fixtures.length === 0) {
    const builtins = cloneFixtures(BUILTIN_FIXTURES);
    for (const fixture of builtins) {
      fixtures.push(fixture);
      if (fixture.deck) precomputed.set(fixture.thread.threadId, fixture.deck);
    }
  }

  return { fixtures, precomputed };
}

/**
 * Recording aid for live mode: pin one live thread to a precomputed deck.
 *
 *   { "threadId": "mcp:...", "deck": <a Deck from demo/fixtures/*.json> }
 *
 * The deck's quotes are re-verified against the live thread's real source, so a
 * stale copy falls back to individual points instead of showing wrong text.
 * This keeps a live recording's point order identical to the storyboard while
 * the T3 thread, review send and agent reply stay real.
 */
export function loadDeckFixture(file: string): Map<string, Deck> {
  const raw = readJsonFile(file) as Record<string, unknown>;
  const threadId = typeof raw.threadId === 'string' ? raw.threadId.trim() : '';
  if (!threadId) throw new Error('deck fixture needs a non-empty "threadId"');
  const deck = asDeck(raw.deck);
  if (!deck) throw new Error('deck fixture has an invalid "deck"');
  return new Map([[threadId, deck]]);
}

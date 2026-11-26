import fs from 'node:fs';
import path from 'node:path';
import type { Deck } from '../../../../shared/contract.js';
import { loadDemoData } from '../core/demo.js';
import type { Env } from '../core/env.js';
import { errorMessage } from '../core/errors.js';
import type { AttentionSource, AttentionThread } from '../core/types.js';

export interface SampleThreadDefinition {
  thread: AttentionThread;
  source: AttentionSource;
  /** Precomputed fixture deck; verified against the source when a device opens it. */
  deck: Deck;
}

export interface SampleWorkspaceDefinition {
  /** In demo/sample/workspace.json order, which is the initial inbox order. */
  threads: SampleThreadDefinition[];
  byId: Map<string, SampleThreadDefinition>;
}

/**
 * The cloud sample workspace: demo/sample/workspace.json lists fixture thread
 * ids in inbox order. Fixtures are read from demo/fixtures (or the built-in
 * fallbacks) and their decks are used as-is, so every device opens instantly.
 */
export function loadSampleWorkspace(env: Env): SampleWorkspaceDefinition {
  const file = path.join(env.repoRoot, 'demo', 'sample', 'workspace.json');
  let ids: string[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { threads?: unknown };
    if (Array.isArray(raw.threads)) {
      ids = raw.threads.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      );
    }
  } catch (error) {
    throw new Error(`Could not read the cloud sample workspace at ${file}: ${errorMessage(error)}`);
  }
  if (ids.length === 0) throw new Error(`Cloud sample workspace at ${file} lists no threads`);

  const demo = loadDemoData(env.fixturesDir);
  const fixtures = new Map(demo.fixtures.map((fixture) => [fixture.thread.threadId, fixture]));
  const threads: SampleThreadDefinition[] = [];
  const byId = new Map<string, SampleThreadDefinition>();

  for (const id of ids) {
    const fixture = fixtures.get(id);
    if (!fixture) {
      throw new Error(
        `Cloud sample workspace lists "${id}", but no fixture with that thread id exists in ${env.fixturesDir}`,
      );
    }
    if (!fixture.deck) {
      throw new Error(`Cloud sample workspace fixture "${id}" has no precomputed deck`);
    }
    const definition: SampleThreadDefinition = {
      thread: { ...fixture.thread },
      source: structuredClone(fixture.source),
      deck: fixture.deck,
    };
    threads.push(definition);
    byId.set(id, definition);
  }

  return { threads, byId };
}

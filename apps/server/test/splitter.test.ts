import { describe, expect, it } from 'vitest';
import { BUILTIN_FIXTURES } from '../src/core/builtinFixtures.js';
import { deckFromPrecomputed, normalizePoints } from '../src/core/decks.js';
import { findSplitPayload } from '../src/core/splitter/json.js';
import { naiveSplit } from '../src/core/splitter/naive.js';
import { makeGlance, toAscii } from '../src/core/text.js';
import type { AttentionSource, AttentionThread } from '../src/core/types.js';

const plan = BUILTIN_FIXTURES.find((fixture) => fixture.thread.threadId === 'auth-refresh-fix')!;
const question = BUILTIN_FIXTURES.find((fixture) => fixture.thread.threadId === 'deps-upgrade')!;

describe('naive splitter fallback', () => {
  it('splits the plan into verified, ASCII points with the risky step flagged', () => {
    const result = naiveSplit({ thread: plan.thread, source: plan.source });
    expect(result.points.length).toBeGreaterThanOrEqual(4);
    expect(result.points.length).toBeLessThanOrEqual(10);
    for (const point of result.points) {
      expect(plan.source.text.includes(point.quote)).toBe(true);
      expect(point.glance.length).toBeLessThanOrEqual(44);
      expect(point.glance).toBe(toAscii(point.glance));
    }
    const risky = result.points.find((point) => point.quote.includes('Force-logout'));
    expect(risky?.risk).toBe('high');
    expect(result.headline.length).toBeLessThanOrEqual(44);
  });

  it('builds a question point with the exact source options', () => {
    const result = naiveSplit({ thread: question.thread, source: question.source });
    const point = result.points.find((candidate) => candidate.kind === 'question');
    expect(point).toBeDefined();
    expect(point!.quote).toBe('Upgrade to Vite 7 now or stay on 6?');
    expect(point!.questionId).toBe('q-vite-7');
    expect(point!.options).toEqual([
      'Stay on 6 for now',
      'Upgrade to 7',
      'Upgrade in a branch',
    ]);
  });
});

describe('model output normalization', () => {
  it('drops invented quotes and tops up to four verified points', () => {
    const source: AttentionSource = {
      sourceMessageId: 'msg-1',
      text: 'Add a cache layer.\nUse Redis for the queue.\nReturn 401 when the token expires.\nShip behind a flag.',
      kind: 'plan',
    };
    const thread: AttentionThread = {
      threadId: 't',
      title: 't',
      project: 'p',
      attention: 'plan',
      updatedAt: new Date().toISOString(),
    };
    const points = normalizePoints(
      [
        { kind: 'step', glance: 'Cache layer', quote: 'Add a cache layer.' },
        { kind: 'step', glance: 'Made up', quote: 'This sentence does not exist anywhere.' },
        { kind: 'step', glance: 'Redis queue', quote: 'Use Redis for the queue.' },
      ],
      source,
      thread.attention,
      { minPoints: 4 },
    );
    expect(points.length).toBe(4);
    expect(points.some((point) => point.quote.includes('does not exist'))).toBe(false);
    for (const point of points) expect(source.text.includes(point.quote)).toBe(true);
    expect(points.map((point) => point.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('normalizes a fixture deck and keeps the source message id', () => {
    const deck = deckFromPrecomputed(plan.deck!, plan.thread, plan.source);
    expect(deck.sourceMessageId).toBe(plan.source.sourceMessageId);
    expect(deck.splitter).toBe('fixture');
    expect(deck.points).toHaveLength(7);
    expect(deck.points[3].risk).toBe('high');
  });
});

describe('split payload extraction', () => {
  it('reads fenced JSON surrounded by prose', () => {
    const text = `Here is the result:

\`\`\`json
{"headline":"Fix plan","points":[{"kind":"step","glance":"One","quote":"Add a cache layer."}]}
\`\`\`

Hope this helps.`;
    const payload = findSplitPayload(text);
    expect(payload?.headline).toBe('Fix plan');
    expect(payload?.points).toHaveLength(1);
  });

  it('accepts a top-level array and trailing commas', () => {
    const payload = findSplitPayload(
      '[{"kind":"claim","glance":"A","quote":"Add a cache layer."},]',
    );
    expect(payload?.points).toHaveLength(1);
  });

  it('returns null for prose without JSON', () => {
    expect(findSplitPayload('I cannot split this right now.')).toBeNull();
  });
});

describe('text helpers', () => {
  it('keeps glances plain ASCII and short', () => {
    expect(makeGlance('Force-“logout” all users 🚨 immediately', 44)).toBe(
      'Force-"logout" all users immediately',
    );
  });
});

describe('demo paths', () => {
  it('points at the repo demo fixtures folder', async () => {
    const { readEnv } = await import('../src/core/env.js');
    const path = await import('node:path');
    const env = readEnv({ PINPOINT_MODE: 'demo' });
    expect(env.fixturesDir).toBe(
      path.join(env.repoRoot, 'demo', 'fixtures'),
    );
    expect(env.repoRoot.endsWith('pinpoint')).toBe(true);
  });

  it('tolerates inline comments copied from .env.example', async () => {
    const { readEnv } = await import('../src/core/env.js');
    const env = readEnv({
      PINPOINT_MODE: 'demo            # demo | live',
      PINPOINT_PORT: '8787            # port',
      SPLITTER_PROVIDER: 'fixture         # provider',
    });
    expect(env.mode).toBe('demo');
    expect(env.port).toBe(8787);
    expect(env.splitterProvider).toBe('fixture');
  });
});

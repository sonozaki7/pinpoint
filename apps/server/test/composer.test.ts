import { describe, expect, it } from 'vitest';
import { BUILTIN_FIXTURES } from '../src/core/builtinFixtures.js';
import { allAgreedReview, composeReview } from '../src/core/composer.js';
import type { Deck, Point, ReviewDraft } from '../../../shared/contract.js';
import { toAscii } from '../src/core/text.js';

function point(index: number, quote: string, kind: Point['kind'] = 'step'): Point {
  return {
    id: `p${index}`,
    index,
    kind,
    glance: `Point ${index}`,
    quote,
  };
}

const exampleDeck: Deck = {
  threadId: 'auth-refresh-fix',
  sourceMessageId: 'msg-example',
  title: 'auth-refresh-fix',
  attention: 'plan',
  headline: 'Auth refresh fix',
  createdAt: '2026-11-24T00:00:00.000Z',
  splitter: 'fixture',
  points: [
    point(1, 'Add a refreshToken() helper'),
    point(2, 'Upgrade to Vite 7 now?', 'question'),
    point(3, 'Return 401 for expired access tokens'),
    point(4, 'Force-logout every user by truncating the sessions table', 'risk'),
    point(5, 'Add a 30s timeout'),
    point(6, 'Wrap refreshToken() in a mutex'),
    point(7, 'Ship behind the AUTH_REFRESH_FIX flag'),
  ],
};

const exampleDraft: ReviewDraft = {
  threadId: 'auth-refresh-fix',
  sourceMessageId: 'msg-example',
  seen: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
  updatedAt: '2026-11-24T00:01:00.000Z',
  notes: [
    { pointId: 'p2', verdict: 'answer', option: 'Stay on 6 for now' },
    {
      pointId: 'p4',
      verdict: 'object',
      text: 'No. Migrate existing sessions instead.',
    },
    { pointId: 'p5', verdict: 'note', text: 'Make it configurable.' },
    {
      pointId: 'p6',
      verdict: 'object',
      text: 'Use a request queue; a mutex deadlocks with the retry path.',
    },
  ],
};

describe('composeReview (SPEC §8)', () => {
  it('matches the spec example exactly', () => {
    const result = composeReview(exampleDeck, exampleDraft);
    expect(result.message).toBe(
      [
        'Review from G2 (Pinpoint) — 7 points',
        '✗ 4. "Force-logout every user by truncating the sessions table" → No. Migrate existing sessions instead.',
        '✗ 6. "Wrap refreshToken() in a mutex" → Use a request queue; a mutex deadlocks with the retry path.',
        '? 2. "Upgrade to Vite 7 now?" → Stay on 6 for now.',
        '● 5. "Add a 30s timeout" → Make it configurable.',
        '✓ Agreed: 1, 3, 7. Go ahead with the rest of the plan.',
      ].join('\n'),
    );
    expect(result.counts).toEqual({ objections: 2, answers: 1, notes: 1, agreed: 3 });
    expect(result.preview).toEqual([
      '2 objections, 1 answer, 3 agreed',
      'Tap to send to auth-refresh-fix',
    ]);
  });

  it('uses the all-agreed line when there are no notes', () => {
    const deck = BUILTIN_FIXTURES.find((fixture) => fixture.thread.threadId === 'auth-refresh-fix')!
      .deck!;
    const result = composeReview(deck, {
      threadId: deck.threadId,
      sourceMessageId: deck.sourceMessageId,
      notes: [],
      seen: [],
      updatedAt: '2026-11-24T00:00:00.000Z',
    });
    expect(result.message.split('\n').at(-1)).toBe(
      '✓ Reviewed on G2: all 7 points agreed. Continue.',
    );
    expect(result.preview[0]).toBe('all 7 points agreed');
    expect(result.counts).toEqual({ objections: 0, answers: 0, notes: 0, agreed: 7 });
  });

  it('closes non-plan reviews with "Continue." and lists agreed points', () => {
    const deck: Deck = {
      ...exampleDeck,
      threadId: 'deps-upgrade',
      title: 'deps-upgrade',
      attention: 'question',
      points: [point(1, 'Upgrade to Vite 7 now?', 'question'), point(2, 'Vite 6 is supported')],
    };
    const result = composeReview(deck, {
      threadId: deck.threadId,
      sourceMessageId: deck.sourceMessageId,
      notes: [{ pointId: 'p1', verdict: 'answer', option: 'Upgrade to 7' }],
      seen: ['p1'],
      updatedAt: '2026-11-24T00:00:00.000Z',
    });
    expect(result.message.split('\n').at(-1)).toBe('✓ Agreed: 2. Continue.');
  });

  it('cuts quotes longer than 140 characters with an ellipsis', () => {
    const longQuote = `${'word '.repeat(40)}end`;
    const deck: Deck = {
      ...exampleDeck,
      points: [point(1, longQuote)],
    };
    const result = composeReview(deck, {
      threadId: deck.threadId,
      sourceMessageId: deck.sourceMessageId,
      notes: [{ pointId: 'p1', verdict: 'object', text: 'Too long.' }],
      seen: [],
      updatedAt: '2026-11-24T00:00:00.000Z',
    });
    const line = result.message.split('\n')[1];
    expect(line).toContain('…');
    const quoted = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
    expect(quoted.length).toBeLessThanOrEqual(140);
  });

  it('keeps both preview lines ASCII', () => {
    const result = allAgreedReview(exampleDeck);
    for (const line of result.preview) {
      expect(line).toBe(toAscii(line));
    }
  });

  it('ignores notes for unknown points', () => {
    const result = composeReview(exampleDeck, {
      ...exampleDraft,
      notes: [{ pointId: 'p99', verdict: 'object', text: 'Ghost note' }],
    });
    expect(result.message).toContain('all 7 points agreed');
    expect(result.message).not.toContain('Ghost note');
  });
});

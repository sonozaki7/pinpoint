import type { AttentionSource, AttentionThread } from './types.js';
import type { Deck } from '../../../../shared/contract.js';

export interface Fixture {
  thread: AttentionThread;
  source: AttentionSource;
  deck?: Deck;
}

const PLAN_SOURCE = `# Fix the auth refresh flow

## Plan

1. Add a \`refreshToken()\` helper in \`src/auth/token.ts\` that rotates the token pair.
2. Return 401 for expired access tokens instead of silently retrying.
3. Reuse the existing session record on refresh so device history survives.
4. Force-logout every user by truncating the sessions table, then delete all refresh tokens.
5. Add a 30s timeout to the logout endpoint.
6. Wrap refreshToken() in a mutex shared by all request handlers.
7. Ship behind the \`AUTH_REFRESH_FIX\` flag and enable it for 10% of users.

Step 4 signs out every active user, including the people reviewing this plan. If it runs during work hours, support will be flooded with password reset requests.
`;

const QUESTION_SOURCE = `I mapped the dependency graph first.

Vite 6.3.5 receives security patches until June 2027. The Vite 7 plugin API changes \`transformIndexHtml\` options, and two of our plugins have no release yet.

Upgrade to Vite 7 now or stay on 6?
`;

const REPORT_SOURCE = `## Morning triage

### 1. Acme renewal
Sarah asks whether the renewal can move to net-30. I drafted: Yes - I'll send the updated order form today.

### 2. Podcast invite
Jordan wants a 30 minute recording next week. I drafted: Happy to join. Tuesday or Thursday afternoon works.

### 3. Invoice mismatch
The March invoice is 40 dollars higher than the signed quote. I drafted: Thanks for flagging this. I'll credit the difference on the next invoice.

### 4. Support escalation
A customer on the Team plan cannot export CSV. I drafted: We fixed the export job; please retry now.
`;

const FAILED_SOURCE = `The e2e suite failed on checkout.spec.ts: 3 of 40 tests timed out waiting for the payment iframe.

Diagnosis: the payment sandbox started returning 502 at 09:14 UTC; the retry path waits 30s, longer than the 20s test timeout. The app code is fine.

Proposed fix: raise the test timeout to 45s and add a health check before the suite.
`;

/** Deterministic fixtures used for tests and as the fallback when demo/fixtures is empty. */
export const BUILTIN_FIXTURES: Fixture[] = [
  {
    thread: {
      threadId: 'deps-upgrade',
      title: 'deps-upgrade',
      project: 'pinpoint',
      attention: 'question',
      updatedAt: '2026-11-24T01:05:00.000Z',
    },
    source: {
      sourceMessageId: 'msg-deps-upgrade-1',
      text: QUESTION_SOURCE,
      kind: 'question',
      question: {
        requestId: 'req-vite-7',
        questions: [
          {
            id: 'q-vite-7',
            question: 'Upgrade to Vite 7 now or stay on 6?',
            options: ['Stay on 6 for now', 'Upgrade to 7', 'Upgrade in a branch'],
          },
        ],
      },
    },
    deck: {
      threadId: 'deps-upgrade',
      sourceMessageId: 'msg-deps-upgrade-1',
      title: 'deps-upgrade',
      attention: 'question',
      headline: 'Vite 7 now or later?',
      createdAt: '2026-11-24T01:05:00.000Z',
      splitter: 'fixture',
      points: [
        {
          id: 'p1',
          index: 1,
          kind: 'question',
          glance: 'Vite 7 now or later?',
          quote: 'Upgrade to Vite 7 now or stay on 6?',
          questionId: 'q-vite-7',
          options: ['Stay on 6 for now', 'Upgrade to 7', 'Upgrade in a branch'],
        },
        {
          id: 'p2',
          index: 2,
          kind: 'claim',
          glance: 'Two plugins not ready',
          quote:
            'The Vite 7 plugin API changes `transformIndexHtml` options, and two of our plugins have no release yet.',
        },
      ],
    },
  },
  {
    thread: {
      threadId: 'auth-refresh-fix',
      title: 'auth-refresh-fix',
      project: 'pinpoint',
      attention: 'plan',
      updatedAt: '2026-11-24T01:04:00.000Z',
    },
    source: {
      sourceMessageId: 'msg-auth-refresh-1',
      text: PLAN_SOURCE,
      kind: 'plan',
    },
    deck: {
      threadId: 'auth-refresh-fix',
      sourceMessageId: 'msg-auth-refresh-1',
      title: 'auth-refresh-fix',
      attention: 'plan',
      headline: 'Auth refresh fix: 7 steps',
      createdAt: '2026-11-24T01:04:00.000Z',
      splitter: 'fixture',
      points: [
        {
          id: 'p1',
          index: 1,
          kind: 'step',
          glance: 'Add refreshToken helper',
          quote: 'Add a `refreshToken()` helper in `src/auth/token.ts`',
        },
        {
          id: 'p2',
          index: 2,
          kind: 'step',
          glance: '401 for expired tokens',
          quote: 'Return 401 for expired access tokens',
        },
        {
          id: 'p3',
          index: 3,
          kind: 'step',
          glance: 'Reuse session record',
          quote: 'Reuse the existing session record on refresh',
        },
        {
          id: 'p4',
          index: 4,
          kind: 'risk',
          glance: 'Force-logout all users',
          quote: 'Force-logout every user by truncating the sessions table',
          risk: 'high',
        },
        {
          id: 'p5',
          index: 5,
          kind: 'step',
          glance: '30s logout timeout',
          quote: 'Add a 30s timeout to the logout endpoint.',
        },
        {
          id: 'p6',
          index: 6,
          kind: 'step',
          glance: 'Mutex on refreshToken',
          quote: 'Wrap refreshToken() in a mutex shared by all request handlers.',
        },
        {
          id: 'p7',
          index: 7,
          kind: 'step',
          glance: '10 percent flag rollout',
          quote: 'Ship behind the `AUTH_REFRESH_FIX` flag and enable it for 10% of users.',
        },
      ],
    },
  },
  {
    thread: {
      threadId: 'flaky-e2e',
      title: 'flaky-e2e',
      project: 'pinpoint',
      attention: 'failed',
      updatedAt: '2026-11-24T01:03:00.000Z',
    },
    source: {
      sourceMessageId: 'msg-flaky-e2e-1',
      text: FAILED_SOURCE,
      kind: 'reply',
    },
    deck: {
      threadId: 'flaky-e2e',
      sourceMessageId: 'msg-flaky-e2e-1',
      title: 'flaky-e2e',
      attention: 'failed',
      headline: 'Payment sandbox 502s',
      createdAt: '2026-11-24T01:03:00.000Z',
      splitter: 'fixture',
      points: [
        {
          id: 'p1',
          index: 1,
          kind: 'claim',
          glance: '3 of 40 tests timed out',
          quote:
            'The e2e suite failed on checkout.spec.ts: 3 of 40 tests timed out waiting for the payment iframe.',
        },
        {
          id: 'p2',
          index: 2,
          kind: 'claim',
          glance: 'Sandbox returned 502',
          quote:
            'the payment sandbox started returning 502 at 09:14 UTC; the retry path waits 30s, longer than the 20s test timeout.',
        },
        {
          id: 'p3',
          index: 3,
          kind: 'step',
          glance: 'Raise timeout, add health check',
          quote:
            'Proposed fix: raise the test timeout to 45s and add a health check before the suite.',
        },
      ],
    },
  },
  {
    thread: {
      threadId: 'inbox-morning',
      title: 'inbox-morning',
      project: 'qolso',
      attention: 'report',
      updatedAt: '2026-11-24T01:02:00.000Z',
    },
    source: {
      sourceMessageId: 'msg-inbox-morning-1',
      text: REPORT_SOURCE,
      kind: 'reply',
    },
    deck: {
      threadId: 'inbox-morning',
      sourceMessageId: 'msg-inbox-morning-1',
      title: 'inbox-morning',
      attention: 'report',
      headline: '4 drafts ready to send',
      createdAt: '2026-11-24T01:02:00.000Z',
      splitter: 'fixture',
      points: [
        {
          id: 'p1',
          index: 1,
          kind: 'draft',
          glance: "Acme: today's order form",
          quote: "Yes - I'll send the updated order form today.",
        },
        {
          id: 'p2',
          index: 2,
          kind: 'draft',
          glance: 'Podcast: Tue or Thu',
          quote: 'Happy to join. Tuesday or Thursday afternoon works.',
        },
        {
          id: 'p3',
          index: 3,
          kind: 'draft',
          glance: 'Credit the $40 difference',
          quote:
            "Thanks for flagging this. I'll credit the difference on the next invoice.",
        },
        {
          id: 'p4',
          index: 4,
          kind: 'draft',
          glance: 'CSV export fixed, retry',
          quote: 'We fixed the export job; please retry now.',
        },
      ],
    },
  },
];

export function cloneFixtures(fixtures: Fixture[] = BUILTIN_FIXTURES): Fixture[] {
  return fixtures.map((fixture) => ({
    thread: { ...fixture.thread },
    source: {
      ...fixture.source,
      question: fixture.source.question
        ? {
            requestId: fixture.source.question.requestId,
            questions: fixture.source.question.questions.map((q) => ({ ...q, options: [...q.options] })),
          }
        : undefined,
    },
    deck: fixture.deck
      ? {
          ...fixture.deck,
          points: fixture.deck.points.map((p) => ({
            ...p,
            options: p.options ? [...p.options] : undefined,
          })),
        }
      : undefined,
  }));
}

export function builtinDemos(): {
  threads: AttentionThread[];
  sources: Map<string, AttentionSource>;
  fixtures: Fixture[];
} {
  const fixtures = cloneFixtures();
  return {
    threads: fixtures.map((f) => f.thread),
    sources: new Map(fixtures.map((f) => [f.thread.threadId, f.source])),
    fixtures,
  };
}

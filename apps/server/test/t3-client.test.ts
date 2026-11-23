import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {
  attentionFromSnapshot,
  attentionKind,
  createT3Client,
  isAttentionEligible,
  latestVisibleFromTranscript,
  normalizeAnswers,
  sortAttention,
  sourceFromProjection,
  type ShellSnapshot,
  type ShellThread,
  type ThreadProjection,
  type TranscriptItem,
} from '../src/t3/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/t3-shell-sample.json', import.meta.url));
const snapshot = JSON.parse(readFileSync(fixturePath, 'utf8')) as ShellSnapshot;

const NOW = Date.parse('2026-11-24T01:00:00.000Z');

function fixtureThread(id: string): ShellThread {
  const thread = snapshot.threads.find((candidate) => candidate.id === id);
  if (thread === undefined) throw new Error(`Fixture thread ${id} is missing`);
  return thread;
}

function transcript(...entries: {role: 'user' | 'assistant'; text: string; at: string}[]): TranscriptItem[] {
  return entries.map((entry, index) => ({
    position: index,
    visibility: 'local',
    item: {
      id: `item-${index}`,
      type: `${entry.role}_message`,
      text: entry.text,
      updatedAt: entry.at,
    },
  }));
}

describe('isAttentionEligible', () => {
  it('accepts a live, unsettled, top-level thread', () => {
    expect(isAttentionEligible(fixtureThread('thread-report-inline'), NOW)).toBe(true);
  });

  it.each([
    ['thread-archived', 'archived'],
    ['thread-deleted', 'deleted'],
    ['thread-settled', 'settled'],
    ['thread-snoozed', 'snoozed'],
    ['thread-subagent-child', 'subagent child'],
    ['thread-side-chat', 'side chat'],
  ])('rejects %s (%s)', (id) => {
    expect(isAttentionEligible(fixtureThread(id), NOW)).toBe(false);
  });

  it('treats an expired snooze as eligible again', () => {
    expect(isAttentionEligible(fixtureThread('thread-snoozed-past'), NOW)).toBe(true);
  });

  it('lets settledOverride=active keep a thread in play', () => {
    expect(isAttentionEligible(fixtureThread('thread-unsettled-override'), NOW)).toBe(true);
  });
});

describe('attentionKind', () => {
  it('prioritises a pending user question', () => {
    expect(attentionKind(fixtureThread('thread-question'), null, NOW)).toBe('question');
  });

  it('reports an active proposed plan', () => {
    expect(attentionKind(fixtureThread('thread-plan'), null, NOW)).toBe('plan');
  });

  it('reports a failed run', () => {
    expect(attentionKind(fixtureThread('thread-failed'), null, NOW)).toBe('failed');
  });

  it('does not report an approval request as a question', () => {
    const thread = fixtureThread('thread-question-answered');
    expect(attentionKind(thread, thread.latestVisibleMessage ?? null, NOW)).toBe('report');
  });

  it('reports an idle thread whose latest visible message is the assistant', () => {
    const thread = fixtureThread('thread-report-inline');
    expect(attentionKind(thread, thread.latestVisibleMessage ?? null, NOW)).toBe('report');
  });

  it('stays quiet when the latest message is the user', () => {
    const thread = fixtureThread('thread-user-latest');
    expect(attentionKind(thread, thread.latestVisibleMessage ?? null, NOW)).toBeNull();
  });

  it('stays quiet while the thread is running', () => {
    const thread = fixtureThread('thread-running');
    expect(attentionKind(thread, thread.latestVisibleMessage ?? null, NOW)).toBeNull();
  });
});

describe('latestVisibleFromTranscript', () => {
  it('picks the newest user or assistant message and ignores other items', () => {
    const items: TranscriptItem[] = [
      ...transcript(
        {role: 'user', text: 'question', at: '2026-11-24T00:00:00.000Z'},
        {role: 'assistant', text: 'answer', at: '2026-11-24T00:01:00.000Z'},
      ),
      {
        position: 9,
        visibility: 'local',
        item: {id: 'reasoning-1', type: 'reasoning', updatedAt: '2026-11-24T00:02:00.000Z'},
      },
      {
        position: 10,
        visibility: 'synthetic',
        item: {
          id: 'synthetic-1',
          type: 'assistant_message',
          text: 'kept out',
          updatedAt: '2026-11-24T00:03:00.000Z',
        },
      },
    ];
    expect(latestVisibleFromTranscript(items)).toMatchObject({
      role: 'assistant',
      text: 'answer',
      updatedAt: '2026-11-24T00:01:00.000Z',
    });
  });

  it('returns null when there is no conversation message', () => {
    expect(latestVisibleFromTranscript([])).toBeNull();
  });
});

describe('attentionFromSnapshot', () => {
  it('classifies question, plan, failed and inline reports, and asks for transcripts otherwise', () => {
    const {rows, needsTranscript} = attentionFromSnapshot(snapshot, new Map(), NOW);

    expect(rows.map((row) => row.threadId).sort()).toEqual(
      [
        'thread-question',
        'thread-plan',
        'thread-failed',
        'thread-report-inline',
        'thread-unsettled-override',
        'thread-question-answered',
      ].sort(),
    );
    expect(needsTranscript.map((thread) => thread.id).sort()).toEqual([
      'thread-report-transcript',
      'thread-snoozed-past',
    ]);
    expect(rows.find((row) => row.threadId === 'thread-question')?.project).toBe('alpha');
    expect(rows.find((row) => row.threadId === 'thread-failed')?.project).toBe('beta');
  });

  it('sorts question, then plan, then failed, then newest report', () => {
    const rows = sortAttention(
      attentionFromSnapshot(
        snapshot,
        new Map([
          ['thread-report-transcript', {id: 'm1', role: 'assistant', text: 'reply', updatedAt: '2026-11-24T00:20:00.000Z'}],
          ['thread-snoozed-past', {id: 'm2', role: 'assistant', text: 'reply', updatedAt: '2026-11-24T00:35:00.000Z'}],
        ]),
        NOW,
      ).rows,
    );
    expect(rows.map((row) => row.attention)).toEqual([
      'question',
      'plan',
      'failed',
      'report',
      'report',
      'report',
      'report',
      'report',
    ]);
    expect(rows.slice(3).map((row) => row.threadId)).toEqual([
      'thread-question-answered',
      'thread-snoozed-past',
      'thread-unsettled-override',
      'thread-report-inline',
      'thread-report-transcript',
    ]);
  });
});

describe('createT3Client.listAttention', () => {
  it('reads transcripts only for threads that could still be plain replies', async () => {
    const asked: string[] = [];
    const client = createT3Client(
      {T3_URL: 'http://127.0.0.1:3773', T3_TOKEN: 'test-token', T3_PROJECTS: 'alpha,beta'},
      {
        cliFallback: false,
        now: () => NOW,
        fetchImpl: (async (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes('/api/orchestration/shell')) {
            return Response.json(snapshot);
          }
          if (url.includes('/threads/thread-report-transcript/transcript')) {
            asked.push('thread-report-transcript');
            return Response.json({
              threadId: 'thread-report-transcript',
              title: 'Fixture: reply, shell hides the message',
              updatedAt: '2026-11-24T00:20:00.000Z',
              items: transcript(
                {role: 'user', text: 'ask', at: '2026-11-24T00:03:00.000Z'},
                {role: 'assistant', text: 'reply', at: '2026-11-24T00:20:00.000Z'},
              ),
            });
          }
          if (url.includes('/threads/thread-snoozed-past/transcript')) {
            asked.push('thread-snoozed-past');
            return Response.json({
              threadId: 'thread-snoozed-past',
              title: 'Fixture: snooze expired',
              updatedAt: '2026-11-24T00:35:00.000Z',
              items: transcript(
                {role: 'assistant', text: 'earlier reply', at: '2026-11-24T00:30:00.000Z'},
                {role: 'user', text: 'follow-up', at: '2026-11-24T00:35:00.000Z'},
              ),
            });
          }
          throw new Error(`Unexpected request: ${url}`);
        }) as typeof fetch,
      },
    );

    const rows = await client.listAttention();
    expect(asked.sort()).toEqual(['thread-report-transcript', 'thread-snoozed-past']);
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.attention === 'question')).toHaveLength(1);
    expect(rows.filter((row) => row.attention === 'plan')).toHaveLength(1);
    expect(rows.filter((row) => row.attention === 'failed')).toHaveLength(1);
    expect(rows.some((row) => row.threadId === 'thread-snoozed-past')).toBe(false);
    expect(rows.find((row) => row.threadId === 'thread-report-transcript')?.attention).toBe('report');
  });

  it('rejects a missing token without printing one', () => {
    expect(() => createT3Client({T3_URL: 'http://127.0.0.1:3773'}, {fetchImpl: fetch})).toThrow(
      /T3_TOKEN is not set/,
    );
  });

  it("accepts the core's camelCase env (t3Url / t3Token)", async () => {
    const client = createT3Client(
      {
        mode: 'live',
        t3Url: 'http://127.0.0.1:3773',
        t3Token: 'test-token',
        t3Projects: ['alpha', 'beta'],
      },
      {
        cliFallback: false,
        now: () => NOW,
        fetchImpl: (async () => Response.json(snapshot)) as typeof fetch,
      },
    );
    const rows = await client.listAttention();
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('sourceFromProjection', () => {
  const baseProjection: ThreadProjection = {
    thread: {id: 'thread-1'},
    messages: [
      {id: 'message-1', role: 'user', text: 'Please plan.'},
      {id: 'message-2', role: 'assistant', text: 'Here is the reply.\nSecond line.'},
    ],
    plans: [],
    turnItems: [],
    runtimeRequests: [],
  };

  it('returns the latest assistant reply, full text', () => {
    expect(sourceFromProjection(baseProjection)).toEqual({
      sourceMessageId: 'message-2',
      text: 'Here is the reply.\nSecond line.',
      kind: 'reply',
    });
  });

  it('skips a streaming assistant message', () => {
    const projection: ThreadProjection = {
      ...baseProjection,
      messages: [
        ...(baseProjection.messages ?? []),
        {id: 'message-3', role: 'assistant', text: 'half a sentence', streaming: true},
      ],
    };
    expect(sourceFromProjection(projection).sourceMessageId).toBe('message-2');
  });

  it('returns the active proposed plan markdown', () => {
    const projection: ThreadProjection = {
      ...baseProjection,
      plans: [
        {id: 'plan-1', kind: 'proposed_plan', status: 'superseded', markdown: 'old'},
        {id: 'plan-2', kind: 'proposed_plan', status: 'active', markdown: '# Plan\n1. One'},
        {id: 'todo-1', kind: 'todo_list', status: 'active'},
      ],
    };
    expect(sourceFromProjection(projection)).toEqual({
      sourceMessageId: 'plan-2',
      text: '# Plan\n1. One',
      kind: 'plan',
    });
  });

  it('returns pending questions with their option labels', () => {
    const projection: ThreadProjection = {
      ...baseProjection,
      runtimeRequests: [
        {id: 'request-1', kind: 'user_input', status: 'resolved'},
        {id: 'request-2', kind: 'user_input', status: 'pending'},
      ],
      turnItems: [
        {
          id: 'item-1',
          type: 'user_input_request',
          requestId: 'request-2',
          questions: [
            {
              id: 'Which port?',
              question: 'Which port should the health endpoint use?',
              options: [
                {label: '8080'},
                {label: '8787', value: 'port-8787'},
              ],
            },
          ],
        },
      ],
    };
    expect(sourceFromProjection(projection)).toEqual({
      sourceMessageId: 'request-2',
      text: 'Which port should the health endpoint use?',
      kind: 'question',
      question: {
        requestId: 'request-2',
        questions: [
          {
            id: 'Which port?',
            question: 'Which port should the health endpoint use?',
            options: ['8080', '8787'],
          },
        ],
      },
    });
  });

  it('falls back to the reply once the question was answered', () => {
    const projection: ThreadProjection = {
      ...baseProjection,
      runtimeRequests: [{id: 'request-1', kind: 'user_input', status: 'resolved'}],
    };
    expect(sourceFromProjection(projection).kind).toBe('reply');
  });

  it('throws a clear error for a thread with nothing to review', () => {
    expect(() => sourceFromProjection({thread: {id: 'empty'}})).toThrow(/no message to review/);
  });
});

describe('normalizeAnswers', () => {
  const questions = [
    {
      id: 'q1',
      question: 'Pick one',
      options: [{label: 'Port 8080'}, {label: 'Port 8787', value: 'port-8787'}],
    },
  ];

  it('maps a label to the stored option value', () => {
    expect(normalizeAnswers(questions, {q1: 'Port 8787'})).toEqual({q1: 'port-8787'});
  });

  it('passes an unknown answer through unchanged', () => {
    expect(normalizeAnswers(questions, {q1: 'something else'})).toEqual({q1: 'something else'});
  });
});

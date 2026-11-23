import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import type { Hono } from 'hono';
import { cleanupTestContext, makeTestContext, type TestContext } from './helpers.js';

let context: TestContext;
let app: Hono;

beforeAll(async () => {
  context = await makeTestContext();
  app = createApp({ service: context.service });
});

afterAll(async () => {
  await cleanupTestContext(context);
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('HTTP API (demo mode)', () => {
  it('GET /api/health reports demo, fake T3, dry-run Telegram and the splitter', async () => {
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: true,
      mode: 'demo',
      t3: 'off',
      telegram: 'dry-run',
      splitter: 'fixture',
    });
  });

  it('answers CORS preflight for any origin', async () => {
    const response = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('GET /api/inbox sorts question, plan, failed, report and warms decks', async () => {
    const response = await app.request('/api/inbox');
    expect(response.status).toBe(200);
    const body = await json<{
      items: {
        threadId: string;
        attention: string;
        summary: string;
        deckReady: boolean;
        pointCount: number;
        draftNotes: number;
      }[];
      updatedAt: string;
    }>(response);
    expect(body.items.map((item) => item.attention)).toEqual([
      'question',
      'plan',
      'failed',
      'report',
    ]);
    const plan = body.items.find((item) => item.threadId === 'auth-refresh-fix')!;
    expect(plan.summary).toBe('plan, 7 steps');
    expect(plan.deckReady).toBe(true);
    expect(plan.pointCount).toBe(7);
    expect(plan.draftNotes).toBe(0);
    expect(body.updatedAt).toMatch(/^\d{4}-/);
    // Four source messages -> four notifications, no duplicates on repeat calls.
    expect(context.telegram.attentionCalls).toHaveLength(4);
    await app.request('/api/inbox');
    expect(context.telegram.attentionCalls).toHaveLength(4);
  });

  it('GET /api/deck/:threadId returns the built deck', async () => {
    const response = await app.request('/api/deck/auth-refresh-fix');
    expect(response.status).toBe(200);
    const deck = await json<{ points: { id: string; index: number }[]; splitter: string }>(
      response,
    );
    expect(deck.points).toHaveLength(7);
    expect(deck.points.map((point) => point.id)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
      'p6',
      'p7',
    ]);
    expect(deck.splitter).toBe('fixture');
  });

  it('GET /api/deck returns 202 while a fresh deck builds', async () => {
    const fresh = await makeTestContext({ preload: false, precomputed: false });
    try {
      const freshApp = createApp({ service: fresh.service });
      const pending = await freshApp.request('/api/deck/auth-refresh-fix');
      expect(pending.status).toBe(202);
      expect(await json(pending)).toEqual({ pending: true });
      await fresh.service.preload();
      const ready = await freshApp.request('/api/deck/auth-refresh-fix');
      expect(ready.status).toBe(200);
    } finally {
      await cleanupTestContext(fresh);
    }
  });

  it('returns JSON 404 for an unknown thread', async () => {
    const response = await app.request('/api/deck/nope');
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ code: 'not_found' });
  });

  it('autosaves notes with PUT and reflects them in the inbox', async () => {
    const response = await app.request('/api/review/auth-refresh-fix', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        notes: [
          {
            pointId: 'p4',
            verdict: 'object',
            text: 'No. Migrate existing sessions instead.',
          },
        ],
        seen: ['p1', 'p4'],
      }),
    });
    expect(response.status).toBe(200);
    const draft = await json<{ notes: unknown[]; seen: string[] }>(response);
    expect(draft.notes).toHaveLength(1);
    expect(draft.seen.sort()).toEqual(['p1', 'p4']);

    const inbox = await json<{ items: { threadId: string; draftNotes: number }[] }>(
      await app.request('/api/inbox'),
    );
    expect(inbox.items.find((item) => item.threadId === 'auth-refresh-fix')?.draftNotes).toBe(1);
  });

  it('POST preview composes the review without sending', async () => {
    const response = await app.request('/api/review/auth-refresh-fix/preview', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const preview = await json<{
      message: string;
      preview: [string, string];
      counts: Record<string, number>;
    }>(response);
    expect(preview.message).toContain('Review from G2 (Pinpoint) — 7 points');
    expect(preview.message).toContain('✗ 4.');
    expect(preview.counts).toEqual({ objections: 1, answers: 0, notes: 0, agreed: 6 });
    expect(preview.preview).toEqual(['1 objection, 6 agreed', 'Tap to send to auth-refresh-fix']);
    expect(context.t3.sent).toHaveLength(0);
  });

  it('POST phone returns a read-on-phone result', async () => {
    const response = await app.request('/api/phone/auth-refresh-fix/p4', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });
    expect(context.telegram.phoneCalls).toEqual([
      { threadId: 'auth-refresh-fix', pointId: 'p4' },
    ]);
  });

  it('POST send approves a plan with no objections the T3 way, and clears the draft', async () => {
    await app.request('/api/review/auth-refresh-fix', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: [] }),
    });
    const sentBefore = context.t3.sent.length;
    const response = await app.request('/api/review/auth-refresh-fix/send', { method: 'POST' });
    expect(response.status).toBe(200);
    const result = await json<{ ok: boolean; delivered: string }>(response);
    expect(result).toMatchObject({ ok: true, delivered: 'demo-log' });
    expect(context.t3.sent).toHaveLength(sentBefore + 1);
    const approval = context.t3.sent.at(-1)!;
    expect(approval).toMatchObject({
      threadId: 'auth-refresh-fix',
      sourcePlanId: 'msg-auth-refresh-1',
    });
    expect(approval.text.startsWith('PLEASE IMPLEMENT THIS PLAN:\n')).toBe(true);
    expect(approval.text).toContain('Force-logout every user');

    const draft = await json<{ notes: unknown[] }>(
      await app.request('/api/review/auth-refresh-fix'),
    );
    expect(draft.notes).toHaveLength(0);
  });

  it('POST send of a plan with an objection sends the cited review instead of approving', async () => {
    await app.request('/api/review/auth-refresh-fix', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        notes: [{ pointId: 'p4', verdict: 'object', text: 'No, migrate sessions instead' }],
      }),
    });
    const sentBefore = context.t3.sent.length;
    const response = await app.request('/api/review/auth-refresh-fix/send', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(context.t3.sent).toHaveLength(sentBefore + 1);
    const review = context.t3.sent.at(-1)!;
    expect(review.text.startsWith('Review from G2 (Pinpoint)')).toBe(true);
    expect(review.text).toContain('✗ 4.');
    expect(review.sourcePlanId).toBeUndefined();
  });

  it('POST send answers a pending question through answerQuestion', async () => {
    const save = await app.request('/api/review/deps-upgrade', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        notes: [{ pointId: 'p1', verdict: 'answer', option: 'Stay on 6 for now' }],
      }),
    });
    expect(save.status).toBe(200);

    const preview = await json<{ counts: Record<string, number> }>(
      await app.request('/api/review/deps-upgrade/preview', { method: 'POST' }),
    );
    expect(preview.counts.answers).toBe(1);

    const sentBefore = context.t3.sent.length;
    const reviewsBefore = context.telegram.reviewCalls.length;
    const response = await app.request('/api/review/deps-upgrade/send', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(context.t3.answered).toHaveLength(1);
    expect(context.t3.answered[0]).toEqual({
      threadId: 'deps-upgrade',
      requestId: 'req-vite-7',
      answers: { 'q-vite-7': 'Stay on 6 for now' },
    });
    expect(context.t3.sent).toHaveLength(sentBefore);
    expect(context.telegram.reviewCalls).toHaveLength(reviewsBefore + 1);
  });

  it('POST /api/voice returns the transcript and heuristic verdict', async () => {
    const pcm = Buffer.alloc(16_000, 0);
    const response = await app.request('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: pcm,
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      text: 'No, migrate the sessions instead',
      verdict: 'object',
    });
  });

  it('rejects invalid review JSON with a JSON error', async () => {
    const response = await app.request('/api/review/auth-refresh-fix', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ code: 'bad_request' });
  });
});

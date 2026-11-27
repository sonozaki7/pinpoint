// Final-day features: DeepSeek reviewer, needs-you sorting with grounded evidence, changed-since-review,
// Ask, glance status, "Since you looked", hand-off by voice, everyday personas, cloud caps.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskResult, InboxResponse, TaskResult } from '../../../shared/contract.js';
import { DailyBudget } from '../src/cloud/askBudget.js';
import { loadSampleWorkspace } from '../src/cloud/sample.js';
import { CloudService } from '../src/cloud/service.js';
import { createLlmConnector } from '../src/connectors/index.js';
import { DeepseekLlmConnector } from '../src/connectors/deepseek.js';
import type { LlmConnector } from '../src/connectors/types.js';
import { askOutput } from '../src/core/ask.js';
import { buildDeck, DeckStore } from '../src/core/decks.js';
import { loadDemoData } from '../src/core/demo.js';
import { readEnv } from '../src/core/env.js';
import { formatNeedsSummary, groundedWhy, needsYouCount } from '../src/core/evidence.js';
import { FakeT3Client, FakeTelegramNotifier } from '../src/core/fakes.js';
import { RevisionTracker } from '../src/core/revisions.js';
import { ReviewStore } from '../src/core/reviews.js';
import { PinpointService } from '../src/core/service.js';
import { createNaiveSplitter, createSplitter } from '../src/core/splitter/index.js';
import { buildSplitPrompt } from '../src/core/splitter/prompt.js';
import { taskTitle } from '../src/core/task.js';
import { createApp } from '../src/http/app.js';
import { createCloudApp } from '../src/http/cloudApp.js';
import { statusFromSnapshot } from '../src/t3/index.js';
import { stubVoice } from './helpers.js';

const DEVICE = '33333333-3333-4333-8333-333333333333';
const DEVICE_2 = '44444444-4444-4444-8444-444444444444';

function fakeLlm(reply: (input: { system: string; user: string }) => string | Promise<string>): LlmConnector & { calls: number } {
  const llm = {
    name: 'fake:llm',
    calls: 0,
    async complete(input: { system: string; user: string }) {
      llm.calls += 1;
      return reply(input);
    },
  };
  return llm;
}

const PLAN_TEXT = [
  'Plan to fix the login bug.',
  '',
  '1. Reproduce the failing login in a test.',
  '2. Force-logout every customer so sessions refresh, about 12,400 active sessions.',
  '3. Ship the fix on Friday.',
].join('\n');

describe('evidence grounding', () => {
  const context = { sourceText: PLAN_TEXT };

  it('keeps a why made of facts from the source and rejects an invented number or name', () => {
    expect(groundedWhy('Logs out 12,400 sessions', context)).toBe('Logs out 12,400 sessions');
    expect(groundedWhy('Logs out 99,000 sessions', context)).toBeUndefined();
    expect(groundedWhy('Notes say Acme refused this', context)).toBeUndefined();
    expect(groundedWhy("can't be undone", context)).toBe("can't be undone");
  });

  it('reads a note or an earlier user message as evidence too', () => {
    const withNote = {
      sourceText: PLAN_TEXT,
      notes: [{ title: 'Acme terms', text: 'Net-45 for Acme.' }],
      history: [{ role: 'user', text: 'Never touch the Tokyo cluster.' }],
    };
    expect(groundedWhy('Acme terms say net-45', withNote)).toBe('Acme terms say net-45');
    expect(groundedWhy('You said never touch Tokyo', withNote)).toBe('You said never touch Tokyo');
  });

  it('clips a why to 60 ASCII characters', () => {
    const why = groundedWhy(`Reproduce ${'the failing login '.repeat(8)}`, context);
    expect(why).toBeDefined();
    expect(why!.length).toBeLessThanOrEqual(60);
    expect(/^[\x20-\x7e]+$/.test(why!)).toBe(true);
  });

  it('writes "7 steps · 1 needs you" within 30 characters', () => {
    expect(formatNeedsSummary('7 steps', 1)).toBe('7 steps · 1 needs you');
    expect(formatNeedsSummary('7 steps', 3)).toBe('7 steps · 3 need you');
    expect(formatNeedsSummary('7 steps', 0)).toBe('7 steps');
    expect(formatNeedsSummary('a very long summary base text', 2).length).toBeLessThanOrEqual(30);
    expect(needsYouCount([{ id: 'p1', index: 1, kind: 'step', glance: 'a', quote: 'a', changed: true }])).toBe(1);
  });
});

describe('DeepSeek connector', () => {
  function reply(status: number, body: unknown): Response {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }

  it('posts to deepseek-flash with a bearer key and thinking off', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const connector = new DeepseekLlmConnector({
      apiKey: 'sk-test-key',
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} });
        return reply(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      },
    });
    expect(connector.name).toBe('deepseek:deepseek-flash');
    expect(await connector.complete({ system: 's', user: 'u', json: true })).toBe('{"ok":true}');
    expect(seen[0]!.url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(seen[0]!.init.body)) as Record<string, unknown>;
    expect(body.model).toBe('deepseek-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-key');
  });

  it('retries once on 429 and never puts the prompt or key in an error', async () => {
    let calls = 0;
    const connector = new DeepseekLlmConnector({
      apiKey: 'sk-secret',
      sleepImpl: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        return reply(500, 'prompt echo: top secret prompt');
      },
    });
    const error = await connector.complete({ system: 's', user: 'top secret prompt' }).catch((e: Error) => e);
    expect(calls).toBe(2);
    expect(String((error as Error).message)).not.toContain('top secret');
    expect(String((error as Error).message)).not.toContain('sk-secret');
  });

  it('is the default reviewer when a key is set and opencode only the fallback', () => {
    const withKey = createLlmConnector({ mode: 'live', deepseekKey: 'sk-x' } as never);
    expect(withKey?.name).toBe('deepseek:deepseek-flash');
    const without = createLlmConnector({ mode: 'live' } as never);
    expect(without?.name).toMatch(/opencode/);
    expect(createLlmConnector({ mode: 'demo', deepseekKey: 'sk-x' } as never)).toBeUndefined();
  });
});

describe('splitter on DeepSeek: sorting and grounded evidence', () => {
  it('asks for needsYou/flag/why and states the grounding rules in the prompt', () => {
    const prompt = buildSplitPrompt({
      thread: { threadId: 't', title: 'login-fix', project: 'p', attention: 'plan', updatedAt: '' },
      source: { sourceMessageId: 'm', text: PLAN_TEXT, kind: 'plan' },
    });
    expect(prompt).toContain('needsYou');
    expect(prompt).toContain('NEVER invent a fact');
  });

  it('keeps a grounded flag and drops one whose why invents a number', async () => {
    const env = readEnv({
      PINPOINT_MODE: 'live',
      DEEPSEEK_API_KEY: 'sk-test',
      PINPOINT_DATA_DIR: os.tmpdir(),
    });
    const llm = fakeLlm(() =>
      JSON.stringify({
        headline: 'Login fix plan',
        points: [
          { kind: 'step', glance: 'Reproduce the failing login', quote: '1. Reproduce the failing login in a test.' },
          {
            kind: 'step',
            glance: 'Force-logout every customer',
            quote: '2. Force-logout every customer so sessions refresh, about 12,400 active sessions.',
            needsYou: true,
            flag: 'signs out everyone',
            why: 'Logs out 12,400 active sessions',
          },
          {
            kind: 'step',
            glance: 'Ship the fix on Friday',
            quote: '3. Ship the fix on Friday.',
            needsYou: true,
            flag: 'date commitment',
            why: 'Promises delivery to 500 customers',
          },
          { kind: 'step', glance: 'Add a regression test', quote: '1. Reproduce the failing login in a test.' },
        ],
      }),
    );
    const splitter = createSplitter(env, { llm });
    expect(splitter.label).toBe('deepseek:flash');
    const deck = await buildDeck(
      splitter,
      { threadId: 't', title: 'login-fix', project: 'p', attention: 'plan', updatedAt: '' },
      { sourceMessageId: 'm', text: PLAN_TEXT, kind: 'plan' },
    );
    expect(llm.calls).toBe(1);
    const grounded = deck.points.find((point) => point.quote.includes('Force-logout'))!;
    expect(grounded.flag).toBe('signs out everyone');
    expect(grounded.why).toBe('Logs out 12,400 active sessions');
    // The invented "500 customers" is never shown; a named heuristic stands in for it.
    const ship = deck.points.find((point) => point.quote.includes('Ship the fix'))!;
    expect(ship.why ?? '').not.toMatch(/500/);
    expect(deck.points.some((point) => /500/.test(point.why ?? ''))).toBe(false);
    for (const point of deck.points) expect((point.why ?? '').length).toBeLessThanOrEqual(60);
  });
});

async function makeDeskService(options: {
  llm?: LlmConnector;
  updates?: FakeT3Client['updates'];
  extraEnv?: Record<string, string>;
} = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-final-'));
  const env = readEnv({
    PINPOINT_MODE: 'demo',
    SPLITTER_PROVIDER: 'fixture',
    PINPOINT_DATA_DIR: dir,
    ...options.extraEnv,
  });
  const demo = loadDemoData(path.join(dir, 'missing'));
  const t3 = new FakeT3Client(demo.fixtures);
  if (options.updates) t3.updates = options.updates;
  const service = new PinpointService({
    env,
    t3,
    t3Live: false,
    telegram: new FakeTelegramNotifier(),
    splitter: createNaiveSplitter(),
    decks: new DeckStore(dir),
    reviews: new ReviewStore(dir),
    voice: stubVoice,
    precomputed: demo.precomputed,
    ...(options.llm ? { llm: options.llm } : {}),
  });
  await service.start();
  await service.preload();
  const app = createApp({ service });
  return {
    dir,
    t3,
    service,
    app,
    async done() {
      await service.stop();
      await fs.promises.rm(dir, { recursive: true, force: true });
    },
  };
}

async function post(app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, url: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('desk: inbox status, needs-you and hand-off', () => {
  it('GET /api/inbox returns items and a glance status from T3 states', async () => {
    const desk = await makeDeskService();
    try {
      const response = await desk.app.request('/api/inbox');
      const body = (await response.json()) as InboxResponse;
      expect(body.status).toEqual({ needYou: body.items.length, working: 2, doneToday: 3 });
      const plan = body.items.find((item) => item.attention === 'plan');
      expect(plan?.summary).toContain('needs you');
      expect(plan?.needsYou).toBeGreaterThanOrEqual(1);
      for (const item of body.items) expect(item.summary.length).toBeLessThanOrEqual(30);
      const deck = (await (await desk.app.request(`/api/deck/${plan!.threadId}`)).json()) as {
        points: { flag?: string; why?: string }[];
      };
      const flagged = deck.points.filter((point) => point.flag);
      expect(flagged.length).toBeGreaterThanOrEqual(1);
      for (const point of flagged) {
        expect(point.why?.length ?? 0).toBeGreaterThan(0);
        expect(point.why!.length).toBeLessThanOrEqual(60);
      }
    } finally {
      await desk.done();
    }
  });

  it('POST /api/task hands the words to a real agent and returns a short title', async () => {
    const desk = await makeDeskService();
    try {
      const response = await post(desk.app, '/api/task', {
        text: 'Please find a dentist open Saturday for the kids and tell me the options',
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as TaskResult;
      expect(result.ok).toBe(true);
      expect(result.threadId).toBeTruthy();
      expect(result.title!.length).toBeLessThanOrEqual(30);
      expect(/^[\x20-\x7e]+$/.test(result.title!)).toBe(true);
      expect(desk.t3.tasks).toHaveLength(1);
      expect((await post(desk.app, '/api/task', { text: '   ' })).status).toBe(400);
    } finally {
      await desk.done();
    }
  });

  it('taskTitle drops filler and stays within 30 characters', () => {
    expect(taskTitle('Please find a dentist open Saturday for the kids.')).toBe('Find a dentist open Saturday');
    expect(taskTitle('ok so can you book it').length).toBeLessThanOrEqual(30);
  });

  it('counts running and done-today agents from thread states', () => {
    const now = Date.parse('2026-11-27T12:00:00');
    const base = { archivedAt: null, deletedAt: null, settledAt: null } as const;
    const threads = [
      { ...base, id: 'a', status: 'running', updatedAt: '2026-11-27T11:00:00' },
      { ...base, id: 'b', status: 'idle', updatedAt: '2026-11-27T09:00:00' },
      { ...base, id: 'c', status: 'idle', updatedAt: '2026-11-20T09:00:00' },
      { ...base, id: 'd', status: 'idle', updatedAt: '2026-11-27T09:00:00', hasActionableProposedPlan: true },
    ];
    expect(statusFromSnapshot(threads as never, now)).toEqual({ working: 1, doneToday: 1 });
  });
});

describe('Ask the output', () => {
  const points = [
    { id: 'p1', index: 1, kind: 'step' as const, glance: 'a', quote: '1. Reproduce the failing login in a test.' },
    {
      id: 'p2',
      index: 2,
      kind: 'step' as const,
      glance: 'b',
      quote: '2. Force-logout every customer so sessions refresh, about 12,400 active sessions.',
    },
  ];

  it('answers with the exact source sentence when no model is available', async () => {
    const result = await askOutput({ question: 'How many sessions get logged out?', sourceText: PLAN_TEXT, points });
    expect(result.ok).toBe(true);
    expect(PLAN_TEXT.includes(result.quote!)).toBe(true);
    expect(result.quote).toContain('12,400');
    expect(result.pointId).toBe('p2');
    expect(result.answer.length).toBeLessThanOrEqual(90);
  });

  it('lets the model choose among the top candidates and phrase ≤90 chars; quote stays exact', async () => {
    const llm = fakeLlm(() => JSON.stringify({ index: 1, answer: 'About 12,400 active sessions get signed out.' }));
    const result = await askOutput({ question: 'How many sessions get logged out?', sourceText: PLAN_TEXT, points, llm });
    expect(result.ok).toBe(true);
    expect(result.answer).toBe('About 12,400 active sessions get signed out.');
    expect(PLAN_TEXT.includes(result.quote!)).toBe(true);
    expect(llm.calls).toBe(1);
  });

  it('rejects a phrasing that invents a number and falls back to the exact sentence', async () => {
    const llm = fakeLlm(() => JSON.stringify({ index: 1, answer: 'About 50,000 sessions get signed out.' }));
    const result = await askOutput({ question: 'How many sessions get logged out?', sourceText: PLAN_TEXT, points, llm });
    expect(result.answer).not.toContain('50,000');
    expect(result.quote).toContain('12,400');
  });

  it('falls back when the model errors, answers garbage or takes longer than the timeout', async () => {
    const failing = fakeLlm(() => {
      throw new Error('boom');
    });
    expect((await askOutput({ question: 'when do we ship', sourceText: PLAN_TEXT, points, llm: failing })).quote).toContain('Friday');
    const garbage = fakeLlm(() => 'not json');
    expect((await askOutput({ question: 'when do we ship', sourceText: PLAN_TEXT, points, llm: garbage })).ok).toBe(true);
    const slow = fakeLlm(() => new Promise<string>(() => undefined));
    const started = Date.now();
    const result = await askOutput({ question: 'when do we ship', sourceText: PLAN_TEXT, points, llm: slow, timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.quote).toContain('Friday');
  });

  it('says so when nothing in the output answers', async () => {
    const result = await askOutput({ question: 'What is the weather on Mars', sourceText: PLAN_TEXT, points });
    expect(result).toMatchObject({ ok: false, answer: 'Not in this output.' });
  });

  it('POST /api/ask/:threadId on the desk returns an AskResult for the deck source', async () => {
    const desk = await makeDeskService();
    try {
      const inbox = (await (await desk.app.request('/api/inbox')).json()) as InboxResponse;
      const plan = inbox.items.find((item) => item.attention === 'plan')!;
      const response = await post(desk.app, `/api/ask/${plan.threadId}`, { question: 'which sessions are affected' });
      expect(response.status).toBe(200);
      const result = (await response.json()) as AskResult;
      expect(typeof result.answer).toBe('string');
      expect(result.answer.length).toBeLessThanOrEqual(90);
      const source = await desk.service.ask(plan.threadId, 'which sessions are affected');
      expect(source).toEqual(result);
      expect((await post(desk.app, `/api/ask/${plan.threadId}`, { question: '' })).status).toBe(400);
      expect((await post(desk.app, '/api/ask/nope', { question: 'hello there' })).status).toBe(404);
    } finally {
      await desk.done();
    }
  });
});

describe('changed since your review', () => {
  it('marks only the new or changed quotes after a review was sent', () => {
    const tracker = new RevisionTracker();
    const deck = (quotes: string[], sourceMessageId = 'm') => ({
      threadId: 't1',
      sourceMessageId,
      title: 't',
      attention: 'plan' as const,
      headline: 'h',
      createdAt: '',
      splitter: 'fixture',
      points: quotes.map((quote, index) => ({
        id: `p${index + 1}`,
        index: index + 1,
        kind: 'step' as const,
        glance: quote.slice(0, 20),
        quote,
      })),
    });
    const first = deck(['Reproduce the failing login in a test.', 'Force-logout every customer.', 'Ship on Friday.']);
    expect(tracker.annotate('t1', first).points.some((point) => point.changed)).toBe(false);
    tracker.remember(first);
    const revised = deck([
      'Reproduce the failing login in a test.',
      'As you asked: migrate the sessions, do not log anyone out.',
      'Ship on Friday.',
    ], 'm2');
    const marked = tracker.annotate('t1', revised);
    expect(marked.points.map((point) => point.changed === true)).toEqual([false, true, false]);
    expect(marked.points[1]!.why).toBe('changed since your review');
  });
});

describe('Since you looked (desk)', () => {
  const now = new Date().toISOString();
  const updates = [
    { threadId: 'thr-a', title: 'login-fix', kind: 'replied' as const, text: 'Migrating sessions now.', key: 'k1', at: now },
    { threadId: 'thr-b', title: 'deps', kind: 'question' as const, text: 'Which version should I pin?', key: 'k2', at: now },
  ];

  it('adds one catch-up item first, one line per update with its threadRef, and send marks them seen', async () => {
    const desk = await makeDeskService({ updates });
    try {
      const body = (await (await desk.app.request('/api/inbox', { headers: { 'x-pinpoint-device': DEVICE } })).json()) as InboxResponse;
      const first = body.items[0]!;
      expect(first).toMatchObject({ threadId: 'catch-up', title: 'Since you looked', kind: 'catch-up', pointCount: 2, needsYou: 1 });
      expect(first.summary.length).toBeLessThanOrEqual(30);
      const deck = (await (await desk.app.request('/api/deck/catch-up', { headers: { 'x-pinpoint-device': DEVICE } })).json()) as {
        points: { glance: string; threadRef?: string; flag?: string; why?: string }[];
      };
      expect(deck.points.map((point) => point.threadRef)).toEqual(['thr-a', 'thr-b']);
      for (const point of deck.points) expect(point.glance.length).toBeLessThanOrEqual(44);
      expect(deck.points[1]!.flag).toBeTruthy();

      // Another device still sees its own catch-up.
      const other = (await (await desk.app.request('/api/inbox', { headers: { 'x-pinpoint-device': DEVICE_2 } })).json()) as InboxResponse;
      expect(other.items[0]!.threadId).toBe('catch-up');

      const sent = await post(desk.app, '/api/review/catch-up/send', {}, { 'x-pinpoint-device': DEVICE });
      expect(sent.status).toBe(200);
      const after = (await (await desk.app.request('/api/inbox', { headers: { 'x-pinpoint-device': DEVICE } })).json()) as InboxResponse;
      expect(after.items.some((item) => item.kind === 'catch-up')).toBe(false);

      // A new update shows up alone.
      desk.t3.updates = [...updates, { threadId: 'thr-c', title: 'flaky-e2e', kind: 'replied' as const, text: 'Green again.', key: 'k3', at: now }];
      const again = (await (await desk.app.request('/api/inbox', { headers: { 'x-pinpoint-device': DEVICE } })).json()) as InboxResponse;
      expect(again.items[0]).toMatchObject({ kind: 'catch-up', pointCount: 1 });
    } finally {
      await desk.done();
    }
  });
});

// --- Cloud ----------------------------------------------------------------------------------------

const cloudDirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
});

async function makeCloud(options: { llm?: LlmConnector; env?: Record<string, string> } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-cloud-final-'));
  cloudDirs.push(dir);
  const env = readEnv({ PINPOINT_MODE: 'cloud', PINPOINT_DATA_DIR: dir, ...options.env });
  const cloud = new CloudService({
    env,
    sample: loadSampleWorkspace(env),
    voice: stubVoice,
    ...(options.llm ? { llm: options.llm } : {}),
  });
  const app = createCloudApp({ cloud, log: () => undefined });
  return {
    app,
    cloud,
    async done() {
      cloud.stop();
      await fs.promises.rm(dir, { recursive: true, force: true });
    },
  };
}

function cloudHeaders(persona?: string, device = DEVICE): Record<string, string> {
  return { 'x-pinpoint-device': device, ...(persona ? { 'x-pinpoint-sample': persona } : {}) };
}

describe('cloud personas, status, catch-up and everyday fixtures', () => {
  it('serves the three personas in the specified order, each with a catch-up row first', async () => {
    const cloud = await makeCloud();
    try {
      const expected: Record<string, string[]> = {
        developer: ['login-fix', 'payment-upgrade', 'launch-post', 'draft-priya'],
        everyday: ['saturday-plan', 'landlord-reply', 'school-newsletter'],
        mixed: ['login-fix', 'saturday-plan', 'landlord-reply', 'launch-post'],
      };
      for (const [persona, ids] of Object.entries(expected)) {
        const body = (await (await cloud.app.request('/api/inbox', { headers: cloudHeaders(persona) })).json()) as InboxResponse;
        expect(body.items[0]).toMatchObject({ threadId: 'catch-up', kind: 'catch-up' });
        expect(body.items.slice(1).map((item) => item.threadId)).toEqual(ids);
        expect(body.status).toMatchObject({ needYou: ids.length });
        expect(body.status!.working).toBeGreaterThanOrEqual(0);
        for (const item of body.items) expect(item.summary.length).toBeLessThanOrEqual(30);
      }
      const defaultBody = (await (await cloud.app.request('/api/inbox', { headers: cloudHeaders() })).json()) as InboxResponse;
      expect(defaultBody.items.slice(1).map((item) => item.threadId)).toEqual(expected.mixed);
    } finally {
      await cloud.done();
    }
  });

  it('flags the picnic with a why from the plan itself, and the two Gmail/Notion conflicts', async () => {
    const cloud = await makeCloud();
    try {
      const get = async (id: string) =>
        (await (await cloud.app.request(`/api/deck/${id}`, { headers: cloudHeaders('everyday') })).json()) as {
          points: { id: string; quote: string; flag?: string; why?: string; kind: string }[];
        };
      const plan = await get('saturday-plan');
      expect(plan.points).toHaveLength(6);
      const picnic = plan.points.find((point) => /picnic/i.test(point.quote))!;
      expect(picnic.flag).toBeTruthy();
      expect(picnic.why).toContain('9°C'.replace('°', ''));
      expect(plan.points.filter((point) => point.flag)).toHaveLength(1);

      const landlord = await get('landlord-reply');
      const rent = landlord.points.find((point) => point.quote.includes('5% rent increase'))!;
      expect(rent.quote).toBe("We're happy to accept the 5% rent increase from April.");
      expect(rent.flag).toBeTruthy();
      expect(rent.why).toMatch(/3%/);

      const news = await get('school-newsletter');
      const bake = news.points.find((point) => point.quote.includes('winter bake sale'))!;
      expect(bake.quote).toContain('Friday, December 12');
      expect(bake.flag).toBeTruthy();
      expect(bake.why).toMatch(/Saturday|13/);
    } finally {
      await cloud.done();
    }
  });

  it('catch-up opens by its lines, send marks it seen and it does not come back', async () => {
    const cloud = await makeCloud();
    try {
      const deck = (await (await cloud.app.request('/api/deck/catch-up', { headers: cloudHeaders('developer') })).json()) as {
        points: { threadRef?: string }[];
      };
      expect(deck.points.length).toBeGreaterThanOrEqual(2);
      expect(deck.points.every((point) => point.threadRef)).toBe(true);
      const sent = await post(cloud.app, '/api/review/catch-up/send', {}, cloudHeaders('developer'));
      expect(sent.status).toBe(200);
      const body = (await (await cloud.app.request('/api/inbox', { headers: cloudHeaders('developer') })).json()) as InboxResponse;
      expect(body.items.some((item) => item.kind === 'catch-up')).toBe(false);
      // Another device is unaffected.
      const other = (await (await cloud.app.request('/api/inbox', { headers: cloudHeaders('developer', DEVICE_2) })).json()) as InboxResponse;
      expect(other.items[0]!.kind).toBe('catch-up');
      // A catch-up line's thread can be opened.
      const ref = deck.points[0]!.threadRef!;
      expect((await cloud.app.request(`/api/deck/${ref}`, { headers: cloudHeaders('developer') })).status).toBe(200);
    } finally {
      await cloud.done();
    }
  });

  it('applies the landlord note "Three percent, not five percent" in place', async () => {
    const cloud = await makeCloud();
    try {
      const response = await post(cloud.app, '/api/edit/landlord-reply', { pointId: 'p2', text: 'Three percent, not five percent.' }, cloudHeaders('everyday'));
      expect(await response.json()).toMatchObject({
        ok: true,
        after: "We're happy to accept the 3% rent increase from April.",
      });
    } finally {
      await cloud.done();
    }
  });
});

describe('cloud: Ask caps and fallback', () => {
  it('phrases with the model, then falls back to retrieval after 20 per device per minute', async () => {
    const llm = fakeLlm(() => JSON.stringify({ index: 1, answer: 'Picnic lunch on the lawn.' }));
    const cloud = await makeCloud({ llm });
    try {
      const ask = (device = DEVICE) =>
        post(cloud.app, '/api/ask/saturday-plan', { question: 'where is lunch' }, cloudHeaders('everyday', device));
      for (let i = 0; i < 20; i += 1) expect((await ask()).status).toBe(200);
      expect(llm.calls).toBeLessThanOrEqual(20);
      const before = llm.calls;
      const over = await ask();
      expect(over.status).toBe(200);
      const result = (await over.json()) as AskResult;
      expect(result.ok).toBe(true);
      expect(llm.calls).toBe(before); // retrieval only past the limit
      // Another device is not limited by the first one.
      await ask(DEVICE_2);
      expect(llm.calls).toBe(before + 1);
    } finally {
      await cloud.done();
    }
  });

  it('stops calling the model past the daily cap (default 2000) and keeps answering', async () => {
    expect(readEnv({ PINPOINT_MODE: 'cloud' }).askDailyCap).toBe(2000);
    const budget = new DailyBudget(2, () => Date.parse('2026-11-27T01:00:00Z'));
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
    const tomorrow = new DailyBudget(1, (() => {
      let n = 0;
      return () => Date.parse(n++ === 0 ? '2026-11-27T23:59:00Z' : '2026-11-28T00:01:00Z');
    })());
    expect([tomorrow.take(), tomorrow.take()]).toEqual([true, true]);

    const llm = fakeLlm(() => JSON.stringify({ index: 1, answer: 'Lunch is a picnic.' }));
    const cloud = await makeCloud({ llm, env: { PINPOINT_ASK_DAILY_CAP: '1' } });
    try {
      const ask = () => post(cloud.app, '/api/ask/saturday-plan', { question: 'where is lunch' }, cloudHeaders('everyday'));
      await ask();
      const second = (await (await ask()).json()) as AskResult;
      expect(llm.calls).toBe(1);
      expect(second.ok).toBe(true);
      expect(second.quote).toBeTruthy();
    } finally {
      await cloud.done();
    }
  });

  it('rejects an empty question and an unknown thread', async () => {
    const cloud = await makeCloud();
    try {
      expect((await post(cloud.app, '/api/ask/saturday-plan', { question: '' }, cloudHeaders('everyday'))).status).toBe(400);
      expect((await post(cloud.app, '/api/ask/nope', { question: 'hello' }, cloudHeaders('everyday'))).status).toBe(404);
    } finally {
      await cloud.done();
    }
  });
});

describe('cloud: hand off a task by voice (simulated)', () => {
  it('after ~6 s a dentist request comes back as a needs-you question with options, marked sample', async () => {
    const cloud = await makeCloud();
    vi.useFakeTimers();
    try {
      const response = await post(cloud.app, '/api/task', { text: 'Find a dentist open Saturday for the kids' }, cloudHeaders('everyday'));
      expect(response.status).toBe(200);
      const result = (await response.json()) as TaskResult;
      expect(result.ok).toBe(true);
      expect(result.title!.length).toBeLessThanOrEqual(30);
      expect(result.title).toContain('(sample)');
      const list = async () =>
        (await (await cloud.app.request('/api/inbox', { headers: cloudHeaders('everyday') })).json()) as InboxResponse;
      expect((await list()).items.some((item) => item.threadId === result.threadId)).toBe(false);
      await vi.advanceTimersByTimeAsync(6_000);
      const item = (await list()).items.find((entry) => entry.threadId === result.threadId)!;
      expect(item).toMatchObject({ attention: 'question' });
      expect(item.needsYou).toBeGreaterThanOrEqual(1);
      const deck = (await (await cloud.app.request(`/api/deck/${result.threadId}`, { headers: cloudHeaders('everyday') })).json()) as {
        points: { kind: string; quote: string; options?: string[] }[];
      };
      const question = deck.points[0]!;
      expect(question.quote).toBe('3 dentists open Saturday: which one?');
      expect(question.options).toHaveLength(3);
      expect(deck.points.some((point) => /sample/i.test(point.quote))).toBe(true);
    } finally {
      vi.useRealTimers();
      await cloud.done();
    }
  });

  it('a non-appointment task comes back as a short sample plan; empty text is a 400', async () => {
    const cloud = await makeCloud();
    vi.useFakeTimers();
    try {
      const response = await post(cloud.app, '/api/task', { text: 'Compare three laptop bags under budget' }, cloudHeaders('mixed'));
      const result = (await response.json()) as TaskResult;
      await vi.advanceTimersByTimeAsync(6_000);
      const body = (await (await cloud.app.request('/api/inbox', { headers: cloudHeaders('mixed') })).json()) as InboxResponse;
      expect(body.items.find((item) => item.threadId === result.threadId)).toMatchObject({ attention: 'plan' });
      expect((await post(cloud.app, '/api/task', { text: '' }, cloudHeaders('mixed'))).status).toBe(400);
    } finally {
      vi.useRealTimers();
      await cloud.done();
    }
  });
});

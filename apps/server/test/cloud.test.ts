import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceStore } from '../src/cloud/deviceStore.js';
import { CLOUD_MAX_AUDIO_BYTES } from '../src/cloud/limits.js';
import { loadSampleWorkspace } from '../src/cloud/sample.js';
import { CloudService } from '../src/cloud/service.js';
import { SampleDeviceWorkspace } from '../src/cloud/workspace.js';
import { readEnv, type Env } from '../src/core/env.js';
import { createCloudApp } from '../src/http/cloudApp.js';
import type { VoiceTranscriber } from '../src/voice/service.js';

const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';
const SERVER_VERSION = (
  JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

interface CloudContext {
  dir: string;
  env: Env;
  cloud: CloudService;
  app: ReturnType<typeof createCloudApp>;
}

const stubVoice: VoiceTranscriber = {
  async transcribe() {
    return { text: 'Keep everyone signed in', via: 'whisper' };
  },
};

async function makeCloudContext(options: {
  env?: Record<string, string>;
  voice?: VoiceTranscriber;
  log?: (line: string) => void;
} = {}): Promise<CloudContext> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-cloud-'));
  const env = readEnv({
    PINPOINT_MODE: 'cloud',
    ...options.env,
    PINPOINT_DATA_DIR: dir,
  });
  const sample = loadSampleWorkspace(env);
  const cloud = new CloudService({
    env,
    sample,
    voice: options.voice ?? stubVoice,
  });
  const app = createCloudApp({
    cloud,
    log: options.log ?? (() => undefined),
  });
  return { dir, env, cloud, app };
}

async function cleanup(context: CloudContext): Promise<void> {
  context.cloud.stop();
  await fs.promises.rm(context.dir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}

function headers(device = DEVICE_A, extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-pinpoint-device': device, ...extra };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface InboxBody {
  items: {
    threadId: string;
    title: string;
    attention: string;
    summary: string;
    deckReady: boolean;
    pointCount: number;
    draftNotes: number;
    app?: string;
  }[];
  updatedAt: string;
}

async function inbox(app: ReturnType<typeof createCloudApp>, device = DEVICE_A): Promise<InboxBody> {
  const response = await app.request('/api/inbox', { headers: headers(device) });
  expect(response.status).toBe(200);
  return json<InboxBody>(response);
}

async function putNotes(
  app: ReturnType<typeof createCloudApp>,
  threadId: string,
  notes: unknown[],
  device = DEVICE_A,
): Promise<Response> {
  return app.request(`/api/review/${threadId}`, {
    method: 'PUT',
    headers: headers(device, { 'content-type': 'application/json' }),
    body: JSON.stringify({ notes }),
  });
}

async function send(
  app: ReturnType<typeof createCloudApp>,
  threadId: string,
  device = DEVICE_A,
): Promise<Response> {
  return app.request(`/api/review/${threadId}/send`, {
    method: 'POST',
    headers: headers(device, { 'content-type': 'application/json' }),
    body: '{}',
  });
}

async function voice(
  app: ReturnType<typeof createCloudApp>,
  bytes: number,
  device = DEVICE_A,
): Promise<Response> {
  return app.request('/api/voice', {
    method: 'POST',
    headers: headers(device, { 'content-type': 'application/octet-stream' }),
    body: Buffer.alloc(bytes),
  });
}

describe('cloud environment', () => {
  it('never reads T3, Telegram, splitter or API-key settings', () => {
    const env = readEnv({
      PINPOINT_MODE: 'cloud',
      PINPOINT_HOST: '0.0.0.0',
      PINPOINT_TRUST_PROXY: '1',
      PINPOINT_SAMPLE_REPLY_MS: '2500',
      WHISPER_THREADS: '9',
      T3_URL: 'https://t3.example.invalid',
      T3_TOKEN: 'do-not-read',
      T3_PROJECTS: 'private-project',
      TELEGRAM_BOT_TOKEN: 'do-not-read',
      TELEGRAM_CHAT_ID: '123',
      SPLITTER_PROVIDER: 'anthropic',
      SPLITTER_MODEL: 'model',
      ANTHROPIC_API_KEY: 'do-not-read',
      NOTION_TOKEN: 'do-not-read',
      NOTION_REVIEW_DB: 'do-not-read',
      GMAIL_DRAFTS_QUERY: 'label:private',
      PINPOINT_ALLOWED_ORIGINS: 'https://evil.example',
    });
    expect(env.mode).toBe('cloud');
    expect(env.host).toBe('0.0.0.0');
    expect(env.trustProxy).toBe(true);
    expect(env.sampleReplyMs).toBe(2500);
    expect(env.whisperThreads).toBe(9);
    expect(env.t3Url).toBe('');
    expect(env.t3Token).toBe('');
    expect(env.t3Projects).toEqual([]);
    expect(env.telegramToken).toBe('');
    expect(env.telegramChatId).toBe('');
    expect(env.splitterProvider).toBe('fixture');
    expect(env.anthropicKey).toBe('');
    expect(env.notionToken).toBe('');
    expect(env.notionReviewDb).toBe('');
    expect(env.gmailDraftsQuery).toBe('label:pinpoint');
    expect(env.allowedOrigins).toEqual([]);
  });
});

describe('cloud HTTP surface', () => {
  it('GET /api/health is public and reports the cloud sample shape', async () => {
    const context = await makeCloudContext();
    try {
      const response = await context.app.request('/api/health');
      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({
        ok: true,
        mode: 'cloud',
        t3: 'off',
        telegram: 'off',
        splitter: 'fixture',
        version: SERVER_VERSION,
        workspace: 'sample',
        pairing: true,
      });
    } finally {
      await cleanup(context);
    }
  });

  it('requires a UUID device header on every /api route except health', async () => {
    const context = await makeCloudContext();
    try {
      const missing = await context.app.request('/api/inbox');
      expect(missing.status).toBe(400);
      expect(await json(missing)).toMatchObject({ code: 'bad_request' });

      const invalid = await context.app.request('/api/inbox', {
        headers: { 'x-pinpoint-device': 'not-a-uuid' },
      });
      expect(invalid.status).toBe(400);

      const empty = await context.app.request('/api/review/login-fix');
      expect(empty.status).toBe(400);

      const health = await context.app.request('/api/health');
      expect(health.status).toBe(200);
    } finally {
      await cleanup(context);
    }
  });

  it('answers preflight for any origin with the cloud CORS headers', async () => {
    const context = await makeCloudContext();
    try {
      const response = await context.app.request('/api/inbox', {
        method: 'OPTIONS',
        headers: {
          origin: 'null',
          'access-control-request-method': 'PUT',
          'access-control-request-headers':
            'content-type, x-pinpoint-device, x-pinpoint-token',
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const methods = response.headers.get('access-control-allow-methods') ?? '';
      for (const method of ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS']) {
        expect(methods).toContain(method);
      }
      const allowed = (response.headers.get('access-control-allow-headers') ?? '').toLowerCase();
      expect(allowed).toContain('x-pinpoint-device');
      expect(allowed).toContain('x-pinpoint-token');
      expect(allowed).toContain('content-type');
      expect(response.headers.get('access-control-max-age')).toBe('600');
      expect(response.headers.get('access-control-allow-credentials')).toBeNull();

      const actual = await context.app.request('/api/health', {
        headers: { origin: 'null' },
      });
      expect(actual.headers.get('access-control-allow-origin')).toBe('*');
    } finally {
      await cleanup(context);
    }
  });

  it('lists the sample workspace in file order with ready fixture decks', async () => {
    const context = await makeCloudContext();
    try {
      const first = await inbox(context.app);
      expect(first.items.map((item) => item.threadId)).toEqual([
        'login-fix',
        'payment-upgrade',
        'launch-post',
        'draft-priya',
      ]);
      expect(first.items.every((item) => item.deckReady)).toBe(true);
      expect(first.items.find((item) => item.threadId === 'login-fix')).toMatchObject({
        attention: 'plan',
        summary: 'plan, 7 steps',
        pointCount: 7,
      });
      expect(first.items.find((item) => item.threadId === 'launch-post')).toMatchObject({
        app: 'notion',
        summary: 'page, 7 points',
        pointCount: 7,
      });
      expect(first.items.find((item) => item.threadId === 'draft-priya')).toMatchObject({
        app: 'gmail',
        summary: '6 drafts',
        pointCount: 6,
      });

      const deck = await context.app.request('/api/deck/login-fix', {
        headers: headers(),
      });
      expect(deck.status).toBe(200);
      const body = await json<{ points: unknown[]; splitter: string }>(deck);
      expect(body.points).toHaveLength(7);
      expect(body.splitter).toBe('fixture');

      const draft = await context.app.request('/api/deck/draft-priya', {
        headers: headers(),
      });
      const draftDeck = await json<{
        points: { kind: string; quote: string; flag?: string }[];
      }>(draft);
      expect(draftDeck.points).toHaveLength(6);
      expect(draftDeck.points.every((point) => point.kind === 'draft')).toBe(true);
      expect(draftDeck.points.find((point) => point.flag)).toMatchObject({
        flag: 'notes say net-45',
      });

      const page = await context.app.request('/api/deck/launch-post', {
        headers: headers(),
      });
      const pageDeck = await json<{ points: { anchor?: string; flag?: string }[] }>(page);
      expect(pageDeck.points.find((point) => point.flag)?.flag).toBe('check this');
      // Block anchors are server-side only; the glasses deck must not carry them.
      expect(pageDeck.points.every((point) => point.anchor === undefined)).toBe(true);
    } finally {
      await cleanup(context);
    }
  });

  it('keeps drafts, sent state and agent replies isolated per device', async () => {
    const context = await makeCloudContext();
    vi.useFakeTimers();
    try {
      const saved = await putNotes(context.app, 'login-fix', [
        { pointId: 'p4', verdict: 'object', text: 'No, migrate sessions.' },
      ]);
      expect(saved.status).toBe(200);

      const a = await inbox(context.app, DEVICE_A);
      const b = await inbox(context.app, DEVICE_B);
      expect(a.items.find((item) => item.threadId === 'login-fix')?.draftNotes).toBe(1);
      expect(b.items.find((item) => item.threadId === 'login-fix')?.draftNotes).toBe(0);

      const sent = await send(context.app, 'login-fix', DEVICE_A);
      expect(sent.status).toBe(200);
      expect((await inbox(context.app, DEVICE_A)).items.map((item) => item.threadId)).toEqual([
        'payment-upgrade',
        'launch-post',
        'draft-priya',
      ]);
      // Device B still has its own untouched inbox.
      expect((await inbox(context.app, DEVICE_B)).items.map((item) => item.threadId)).toEqual([
        'login-fix',
        'payment-upgrade',
        'launch-post',
        'draft-priya',
      ]);

      await vi.advanceTimersByTimeAsync(5_000);
      const aReply = await inbox(context.app, DEVICE_A);
      expect(aReply.items.at(-1)).toMatchObject({
        threadId: 'login-fix',
        attention: 'report',
        summary: 'agent replied',
      });
      const bStill = await inbox(context.app, DEVICE_B);
      expect(bStill.items.map((item) => item.threadId)).toEqual([
        'login-fix',
        'payment-upgrade',
        'launch-post',
        'draft-priya',
      ]);
      expect(bStill.items.find((item) => item.threadId === 'login-fix')?.attention).toBe('plan');
    } finally {
      vi.useRealTimers();
      await cleanup(context);
    }
  });

  it('caps JSON bodies at 64 KB in cloud mode', async () => {
    const context = await makeCloudContext();
    try {
      const response = await context.app.request('/api/review/login-fix', {
        method: 'PUT',
        headers: headers(DEVICE_A, { 'content-type': 'application/json' }),
        body: JSON.stringify({ notes: [], padding: 'x'.repeat(70 * 1024) }),
      });
      expect(response.status).toBe(413);
      expect(await json(response)).toMatchObject({ code: 'too_large' });
    } finally {
      await cleanup(context);
    }
  });

  it('writes one log line per request without the full device id', async () => {
    const lines: string[] = [];
    const context = await makeCloudContext({ log: (line) => lines.push(line) });
    try {
      await context.app.request('/api/health');
      await context.app.request('/api/inbox', { headers: headers() });
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^\[cloud\] GET \/api\/health 200 \d+ms device=-$/);
      expect(lines[1]).toMatch(/^\[cloud\] GET \/api\/inbox 200 \d+ms device=[0-9a-f]{8}$/);
      expect(lines[1]).not.toContain(DEVICE_A);
    } finally {
      await cleanup(context);
    }
  });

  it('rate-limits a device at 120 requests per minute with Retry-After', async () => {
    const context = await makeCloudContext();
    vi.useFakeTimers();
    try {
      for (let index = 0; index < 120; index += 1) {
        const response = await context.app.request('/api/inbox', { headers: headers() });
        expect(response.status).toBe(200);
      }
      const limited = await context.app.request('/api/inbox', { headers: headers() });
      expect(limited.status).toBe(429);
      expect(await json(limited)).toMatchObject({ code: 'rate_limited' });
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(limited.headers.get('access-control-allow-origin')).toBe('*');

      await vi.advanceTimersByTimeAsync(60_000);
      const allowed = await context.app.request('/api/inbox', { headers: headers() });
      expect(allowed.status).toBe(200);
    } finally {
      vi.useRealTimers();
      await cleanup(context);
    }
  });

  it('returns an empty inbox after every sample thread has been sent', async () => {
    const context = await makeCloudContext();
    try {
      for (const threadId of ['login-fix', 'payment-upgrade', 'launch-post', 'draft-priya']) {
        const response = await send(context.app, threadId);
        expect(response.status).toBe(200);
        expect(await json(response)).toMatchObject({ ok: true, delivered: 'sample' });
      }
      expect((await inbox(context.app)).items).toEqual([]);
    } finally {
      await cleanup(context);
    }
  });
});

describe('cloud sample send and agent reply', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the composed review, removes the thread and replies after the delay', async () => {
    const context = await makeCloudContext();
    vi.useFakeTimers();
    try {
      const saved = await putNotes(context.app, 'login-fix', [
        {
          pointId: 'p4',
          verdict: 'object',
          text: "Don't sign everyone out. Just fix the broken logins.",
        },
      ]);
      expect(saved.status).toBe(200);

      const response = await send(context.app, 'login-fix');
      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ ok: true, delivered: 'sample' });

      let current = await inbox(context.app);
      expect(current.items.map((item) => item.threadId)).toEqual([
        'payment-upgrade',
        'launch-post',
        'draft-priya',
      ]);

      await vi.advanceTimersByTimeAsync(4_999);
      current = await inbox(context.app);
      expect(current.items).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(1);
      current = await inbox(context.app);
      expect(current.items.map((item) => item.threadId)).toEqual([
        'payment-upgrade',
        'launch-post',
        'draft-priya',
        'login-fix',
      ]);
      const replyItem = current.items.find((item) => item.threadId === 'login-fix')!;
      expect(replyItem).toMatchObject({
        title: 'login-fix',
        attention: 'report',
        summary: 'agent replied',
        deckReady: true,
      });
      expect(replyItem.pointCount).toBeGreaterThanOrEqual(1);
      expect(replyItem.pointCount).toBeLessThanOrEqual(4);

      const deckResponse = await context.app.request('/api/deck/login-fix', {
        headers: headers(),
      });
      expect(deckResponse.status).toBe(200);
      const deck = await json<{
        attention: string;
        points: { id: string; quote: string; glance: string }[];
      }>(deckResponse);
      expect(deck.attention).toBe('report');

      const workspace = context.cloud.workspaceFor(DEVICE_A) as SampleDeviceWorkspace;
      const source = workspace.sourceForThread('login-fix');
      expect(source.kind).toBe('reply');
      expect(source.text).toBe(
        "Thanks. I'll apply your review. Step 4: Don't sign everyone out. Just fix the broken logins. " +
          'Everything else goes ahead as planned.',
      );
      for (const point of deck.points) {
        expect(source.text.includes(point.quote)).toBe(true);
        expect(point.glance.length).toBeLessThanOrEqual(44);
        expect(/^[\x20-\x7e]+$/.test(point.glance)).toBe(true);
      }

      // The reply opens and reviews like any other item.
      const replySaved = await putNotes(context.app, 'login-fix', [
        { pointId: deck.points[0]!.id, verdict: 'note', text: 'Good, ship it.' },
      ]);
      expect(replySaved.status).toBe(200);
      const replyPreview = await context.app.request('/api/review/login-fix/preview', {
        method: 'POST',
        headers: headers(),
      });
      expect(replyPreview.status).toBe(200);
      expect(
        ((await json<{ message: string }>(replyPreview)).message),
      ).toContain('Good, ship it.');

      // Sending the sample reply just clears it; nothing comes back.
      const replySend = await send(context.app, 'login-fix');
      expect(replySend.status).toBe(200);
      expect((await inbox(context.app)).items).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await inbox(context.app)).items).toHaveLength(3);
    } finally {
      await cleanup(context);
    }
  });

  it('answers a question with the chosen option', async () => {
    const context = await makeCloudContext();
    vi.useFakeTimers();
    try {
      const saved = await putNotes(context.app, 'payment-upgrade', [
        { pointId: 'p1', verdict: 'answer', option: 'Wait until Monday' },
      ]);
      expect(saved.status).toBe(200);

      const response = await send(context.app, 'payment-upgrade');
      expect(await json(response)).toEqual({ ok: true, delivered: 'sample' });
      await vi.advanceTimersByTimeAsync(5_000);

      const workspace = context.cloud.workspaceFor(DEVICE_A) as SampleDeviceWorkspace;
      const source = workspace.sourceForThread('payment-upgrade');
      expect(source.kind).toBe('reply');
      expect(source.text).toBe("Thanks. I'll wait until Monday.");

      const deckResponse = await context.app.request('/api/deck/payment-upgrade', {
        headers: headers(),
      });
      const deck = await json<{ points: { quote: string }[] }>(deckResponse);
      expect(deck.points.length).toBeGreaterThanOrEqual(1);
      expect(deck.points.length).toBeLessThanOrEqual(4);
      for (const point of deck.points) {
        expect(source.text.includes(point.quote)).toBe(true);
      }
    } finally {
      await cleanup(context);
    }
  });

  it('edits a Gmail draft sentence in place, saves it and sends a sample receipt', async () => {
    const context = await makeCloudContext();
    try {
      const response = await context.app.request('/api/edit/draft-priya', {
        method: 'POST',
        headers: headers(DEVICE_A, { 'content-type': 'application/json' }),
        body: JSON.stringify({ pointId: 'p2', text: 'Net-45, not net-60.' }),
      });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        ok: true,
        pointId: 'p2',
        before: "We're happy to agree to net-60 payment terms.",
        after: "We're happy to agree to net-45 payment terms.",
        method: 'replace',
      });

      const saved = await context.app.request('/api/review/draft-priya', {
        headers: headers(),
      });
      const draft = await json<{ notes: { pointId: string; after?: string }[] }>(saved);
      expect(draft.notes).toHaveLength(1);
      expect(draft.notes[0]).toMatchObject({
        pointId: 'p2',
        after: "We're happy to agree to net-45 payment terms.",
      });

      const sent = await send(context.app, 'draft-priya');
      expect(sent.status).toBe(200);
      const result = await json<{
        ok: boolean;
        delivered: string;
        receipt?: { lines: { app: string; text: string; ok: boolean; link?: string }[] };
      }>(sent);
      expect(result).toMatchObject({ ok: true, delivered: 'sample' });
      expect(result.receipt?.lines).toHaveLength(1);
      expect(result.receipt?.lines[0]).toMatchObject({
        app: 'gmail',
        text: 'Sent to Priya (sample)',
        ok: true,
      });
      expect(result.receipt?.lines[0].link).toContain('#drafts/');
      expect((await inbox(context.app)).items.map((item) => item.threadId)).not.toContain(
        'draft-priya',
      );
    } finally {
      await cleanup(context);
    }
  });

  it('returns a Notion comment and status receipt for the sample page', async () => {
    const context = await makeCloudContext();
    try {
      await putNotes(context.app, 'launch-post', [
        {
          pointId: 'p4',
          verdict: 'object',
          text: 'Not everyone today. Say 10% today and everyone by Friday.',
        },
      ]);
      const sent = await send(context.app, 'launch-post');
      expect(sent.status).toBe(200);
      const result = await json<{
        ok: boolean;
        delivered: string;
        receipt?: { lines: { app: string; text: string; ok: boolean }[] };
      }>(sent);
      expect(result).toMatchObject({ ok: true, delivered: 'sample' });
      expect(result.receipt?.lines.map((line) => line.text)).toEqual([
        '1 comment on Launch post (sample)',
        'Status: Changes requested (sample)',
      ]);
      expect(result.receipt?.lines.every((line) => line.app === 'notion')).toBe(true);
      expect((await inbox(context.app)).items.map((item) => item.threadId)).not.toContain(
        'launch-post',
      );
    } finally {
      await cleanup(context);
    }
  });
});

describe('cloud sample reset', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores the starting workspace and clears drafts, replies and pending timers', async () => {
    const context = await makeCloudContext();
    vi.useFakeTimers();
    try {
      const initial = await inbox(context.app);
      expect(initial.items.map((item) => item.threadId)).toEqual([
        'login-fix',
        'payment-upgrade',
        'launch-post',
        'draft-priya',
      ]);

      await putNotes(context.app, 'payment-upgrade', [
        { pointId: 'p1', verdict: 'answer', option: 'Wait until Monday' },
      ]);
      await send(context.app, 'login-fix');
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await inbox(context.app)).items).toHaveLength(4);

      const reset = await context.app.request('/api/sample/reset', {
        method: 'POST',
        headers: headers(),
      });
      expect(reset.status).toBe(204);
      expect(await reset.text()).toBe('');

      const restored = await inbox(context.app);
      expect(restored.items.map((item) => item.threadId)).toEqual([
        'login-fix',
        'payment-upgrade',
        'launch-post',
        'draft-priya',
      ]);
      expect(restored.items.find((item) => item.threadId === 'login-fix')).toMatchObject({
        attention: 'plan',
        summary: 'plan, 7 steps',
        draftNotes: 0,
      });
      expect(restored.items.every((item) => item.draftNotes === 0)).toBe(true);

      // A reply scheduled before reset must never appear.
      await send(context.app, 'login-fix');
      const secondReset = await context.app.request('/api/sample/reset', {
        method: 'POST',
        headers: headers(),
      });
      expect(secondReset.status).toBe(204);
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await inbox(context.app)).items.map((item) => item.threadId)).toEqual([
        'login-fix',
        'payment-upgrade',
        'launch-post',
        'draft-priya',
      ]);
    } finally {
      await cleanup(context);
    }
  });
});

describe('cloud voice limits', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects audio over 960,000 bytes with 413', async () => {
    const context = await makeCloudContext();
    try {
      const response = await voice(context.app, CLOUD_MAX_AUDIO_BYTES + 1);
      expect(response.status).toBe(413);
      expect(await json(response)).toMatchObject({ code: 'too_large' });
    } finally {
      await cleanup(context);
    }
  });

  it('accepts 30 s exactly and rate-limits the 21st voice request per minute', async () => {
    const context = await makeCloudContext();
    vi.useFakeTimers();
    try {
      const exact = await voice(context.app, CLOUD_MAX_AUDIO_BYTES);
      expect(exact.status).toBe(200);
      for (let index = 0; index < 19; index += 1) {
        expect((await voice(context.app, 160)).status).toBe(200);
      }

      const limited = await voice(context.app, 160);
      expect(limited.status).toBe(429);
      expect(await json(limited)).toMatchObject({ code: 'rate_limited' });
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(60_000);
      expect((await voice(context.app, 160)).status).toBe(200);
    } finally {
      await cleanup(context);
    }
  });

  it('queues a third transcription and returns 503 with Retry-After after 20 s', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    let twoEntered!: () => void;
    const bothRunning = new Promise<void>((resolve) => {
      twoEntered = resolve;
    });
    const voiceStub: VoiceTranscriber = {
      async transcribe() {
        entered += 1;
        if (entered === 2) twoEntered();
        await gate;
        return { text: 'No, keep everyone signed in', via: 'whisper' };
      },
    };
    const context = await makeCloudContext({ voice: voiceStub });
    vi.useFakeTimers();
    try {
      const first = voice(context.app, 160);
      const second = voice(context.app, 160);
      await bothRunning;
      const third = voice(context.app, 160);

      await vi.advanceTimersByTimeAsync(20_000);
      const rejected = await third;
      expect(rejected.status).toBe(503);
      expect(await json(rejected)).toMatchObject({ code: 'busy' });
      expect(rejected.headers.get('retry-after')).toBe('5');

      release();
      const [firstResponse, secondResponse] = await Promise.all([first, second]);
      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
    } finally {
      release();
      await cleanup(context);
    }
  });
});

describe('DeviceStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops the least recently used device past the cap', () => {
    vi.useFakeTimers();
    let next = 0;
    const store = new DeviceStore<{ n: number }>({
      maxDevices: 3,
      ttlMs: 1_000,
      create: () => ({ n: next++ }),
    });
    const a = store.get('a');
    store.get('b');
    store.get('c');
    expect(store.get('a')).toBe(a); // touch a, so b is now oldest
    store.get('d');
    expect(store.size).toBe(3);
    expect(store.has('a')).toBe(true);
    expect(store.has('b')).toBe(false);
    expect(store.has('c')).toBe(true);
    expect(store.has('d')).toBe(true);
  });

  it('treats a device idle for more than seven days as new and disposes the old state', () => {
    vi.useFakeTimers();
    const DAY = 24 * 60 * 60 * 1_000;
    const TTL = 7 * DAY;
    vi.setSystemTime(1_000_000);
    let next = 0;
    let disposed = 0;
    const store = new DeviceStore<{ n: number }>({
      maxDevices: 10,
      ttlMs: TTL,
      create: () => ({ n: next++ }),
      dispose: () => {
        disposed += 1;
      },
    });
    const first = store.get('a');
    vi.setSystemTime(1_000_000 + TTL);
    expect(store.get('a')).toBe(first);

    vi.setSystemTime(1_000_000 + 2 * TTL + 1);
    const second = store.get('a');
    expect(second).not.toBe(first);
    expect(disposed).toBe(1);
  });
});

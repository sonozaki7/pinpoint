import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import type { Splitter } from '../src/core/splitter/types.js';
import { MAX_PCM_BYTES } from '../src/voice/wav.js';
import { cleanupTestContext, makeTestContext, type TestContext } from './helpers.js';

describe('request body limits', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await makeTestContext();
  });

  afterAll(async () => {
    await cleanupTestContext(context);
  });

  it('rejects JSON bodies over 256 KB with a JSON 413', async () => {
    const app = createApp({ service: context.service });
    const response = await app.request('/api/review/auth-refresh-fix', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: [], padding: 'x'.repeat(300 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'too_large' });
  });

  it('accepts exactly 25 s of PCM and rejects one sample more', async () => {
    const app = createApp({ service: context.service });
    const exact = await app.request('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(MAX_PCM_BYTES),
    });
    expect(exact.status).toBe(200);

    const over = await app.request('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(MAX_PCM_BYTES + 2),
    });
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ code: 'too_large' });
  });
});

describe('live CORS', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    context = await makeTestContext({
      env: {
        PINPOINT_MODE: 'live',
        T3_PROJECTS: 'pinpoint',
        PINPOINT_ALLOWED_ORIGINS: 'http://127.0.0.1:4173, https://glasses.example',
      },
    });
    app = createApp({ service: context.service });
  });

  afterAll(async () => {
    await cleanupTestContext(context);
  });

  async function allowOrigin(origin: string): Promise<string | null> {
    const response = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET' },
    });
    return response.headers.get('access-control-allow-origin');
  }

  it('echoes configured glasses origins and the Even WebView pattern', async () => {
    expect(await allowOrigin('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    expect(await allowOrigin('https://glasses.example')).toBe('https://glasses.example');
    expect(await allowOrigin('https://hub.evenrealities.com')).toBe(
      'https://hub.evenrealities.com',
    );
    expect(await allowOrigin('https://app.staging.evenrealities.com')).toBe(
      'https://app.staging.evenrealities.com',
    );
  });

  it('does not reflect an arbitrary origin in live mode', async () => {
    expect(await allowOrigin('https://evil.example')).toBeNull();
    expect(await allowOrigin('http://127.0.0.1:5173')).toBeNull();
  });
});

describe('unknown thread and review routes', () => {
  it('returns 404 for a review on a thread it does not know', async () => {
    const context = await makeTestContext();
    try {
      const app = createApp({ service: context.service });
      const response = await app.request('/api/review/no-such-thread', { method: 'GET' });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'not_found' });
    } finally {
      await cleanupTestContext(context);
    }
  });
});

describe('race hardening', () => {
  it('turns a concurrent double send into one delivery and one 409', async () => {
    const context = await makeTestContext();
    const app = createApp({ service: context.service });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = context.t3.sendMessage.bind(context.t3);
    let calls = 0;
    context.t3.sendMessage = async (...args: Parameters<typeof context.t3.sendMessage>) => {
      calls += 1;
      await gate;
      return original(...args);
    };

    try {
      const first = app.request('/api/review/auth-refresh-fix/send', { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = app.request('/api/review/auth-refresh-fix/send', { method: 'POST' });
      const secondResponse = await second;
      expect(secondResponse.status).toBe(409);
      expect(await secondResponse.json()).toMatchObject({ code: 'conflict' });

      release();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
      expect(calls).toBe(1);
    } finally {
      release();
      await cleanupTestContext(context);
    }
  });

  it('dedupes concurrent deck builds for the same thread and source', async () => {
    let builds = 0;
    const splitter: Splitter = {
      label: 'slow-test',
      async split() {
        builds += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return {
          headline: 'Slow test deck',
          splitter: 'slow-test',
          points: [
            {
              kind: 'step',
              glance: 'Force-logout all users',
              quote: 'Force-logout every user by truncating the sessions table.',
            },
          ],
        };
      },
    };
    const context = await makeTestContext({
      preload: false,
      precomputed: false,
      splitter,
    });
    try {
      const app = createApp({ service: context.service });
      const [first, second] = await Promise.all([
        app.request('/api/deck/auth-refresh-fix'),
        app.request('/api/deck/auth-refresh-fix'),
      ]);
      expect([first.status, second.status]).toEqual([202, 202]);

      const ready = await context.service.inbox.getDeck('auth-refresh-fix', true);
      expect(ready.status).toBe('ready');
      expect(builds).toBe(1);

      const cached = await app.request('/api/deck/auth-refresh-fix');
      expect(cached.status).toBe(200);
      expect(builds).toBe(1);
    } finally {
      await cleanupTestContext(context);
    }
  });
});

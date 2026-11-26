import fs from 'node:fs';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { DeskHub } from '../src/cloud/deskHub.js';
import { attachDeskSocket } from '../src/cloud/deskSocketServer.js';
import { loadSampleWorkspace } from '../src/cloud/sample.js';
import { CloudService } from '../src/cloud/service.js';
import { readEnv, type Env } from '../src/core/env.js';
import { createApp } from '../src/http/app.js';
import { createCloudApp } from '../src/http/cloudApp.js';
import { DeskClient } from '../src/relay/deskClient.js';
import type { CloudToDesk, RelayRequest } from '../src/relay/protocol.js';
import { cleanupTestContext, makeTestContext, stubVoice } from './helpers.js';

const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';
const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);

interface Harness {
  dir: string;
  env: Env;
  cloud: CloudService;
  server: Server;
  base: string;
  close: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

async function makeHarness(options: { relayTimeoutMs?: number } = {}): Promise<Harness> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-relay-'));
  const env = readEnv({
    PINPOINT_MODE: 'cloud',
    PINPOINT_DATA_DIR: dir,
  });
  const cloud = new CloudService({
    env,
    sample: loadSampleWorkspace(env),
    voice: stubVoice,
    desk: new DeskHub({
      ...(options.relayTimeoutMs ? { relayTimeoutMs: options.relayTimeoutMs } : {}),
      log: () => undefined,
    }),
  });
  const app = createCloudApp({ cloud, log: () => undefined });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as unknown as Server;
  if (!server.listening) await once(server, 'listening');
  const address = server.address() as AddressInfo;

  const detach = attachDeskSocket(server, cloud.desk, {
    heartbeatMs: 60_000,
    log: () => undefined,
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    cloud.stop();
    detach();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  };
  const harness: Harness = {
    dir,
    env,
    cloud,
    server,
    base: `http://127.0.0.1:${address.port}`,
    close,
  };
  cleanups.push(close);
  return harness;
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup().catch(() => undefined);
  }
});

interface Waiter {
  predicate: (message: CloudToDesk) => boolean;
  resolve: (message: CloudToDesk) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class DeskPeer {
  readonly ws: WebSocket;
  readonly name: string;
  private readonly queue: CloudToDesk[] = [];
  private readonly waiters: Waiter[] = [];

  constructor(ws: WebSocket, name: string) {
    this.ws = ws;
    this.name = name;
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let message: CloudToDesk;
      try {
        message = JSON.parse(raw.toString()) as CloudToDesk;
      } catch {
        return;
      }
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) {
        const waiter = this.waiters.splice(index, 1)[0]!;
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.queue.push(message);
      }
    });
  }

  static async connect(port: number, secret = SECRET, name = 'Test Mac'): Promise<DeskPeer> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/desk/connect`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    await once(ws, 'open');
    const peer = new DeskPeer(ws, name);
    peer.send({ type: 'hello', name });
    return peer;
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  next(predicate: (message: CloudToDesk) => boolean = () => true, timeoutMs = 3_000): Promise<CloudToDesk> {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const at = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(new Error('Timed out waiting for a desk message'));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  async pairCode(): Promise<string> {
    this.send({ type: 'request-pair-code', id: `code-${Math.random()}` });
    const message = await this.next((entry) => entry.type === 'pair-code');
    if (message.type !== 'pair-code') throw new Error('expected pair-code');
    return message.code;
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    this.ws.close();
    await once(this.ws, 'close').catch(() => undefined);
  }
}

interface Headers {
  [name: string]: string;
}

function deviceHeaders(device = DEVICE_A, token?: string): Headers {
  return {
    'x-pinpoint-device': device,
    ...(token ? { 'x-pinpoint-token': token } : {}),
  };
}

async function pair(base: string, code: string, device = DEVICE_A): Promise<{
  status: number;
  body: { ok: boolean; token?: string; desk?: { name: string }; error?: string };
  headers: Headers;
}> {
  const response = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { ...deviceHeaders(device), 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      ok: boolean;
      token?: string;
      desk?: { name: string };
      error?: string;
    },
    headers: Object.fromEntries(response.headers.entries()),
  };
}

async function waitUntil(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for a condition');
}

/** Answer exactly one relayed request with a JSON body. */
async function answerJson(
  peer: DeskPeer,
  pending: Promise<Response>,
  handler: (request: RelayRequest) => { status?: number; body: unknown; contentType?: string },
): Promise<Response> {
  const message = await peer.next((entry) => entry.type === 'request');
  if (message.type !== 'request') throw new Error('expected request');
  const result = handler(message.request);
  peer.send({
    type: 'response',
    response: {
      id: message.request.id,
      status: result.status ?? 200,
      contentType: result.contentType ?? 'application/json',
      bodyBase64: Buffer.from(JSON.stringify(result.body)).toString('base64'),
    },
  });
  return pending;
}

function upgradeStatus(port: number, headers: Headers = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/desk/connect`, { headers });
    const timer = setTimeout(() => reject(new Error('upgrade timed out')), 3_000);
    timer.unref?.();
    ws.on('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      const status = response.statusCode ?? 0;
      response.resume();
      resolve(status);
    });
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error('upgrade unexpectedly succeeded'));
    });
    ws.on('error', () => {
      // A closed socket also reports an error; unexpected-response wins.
    });
  });
}

describe('desk WebSocket relay', () => {
  it(
    'pairs a device and relays inbox, deck and review calls to a real in-process desk app',
    { timeout: 20_000 },
    async () => {
      const context = await makeTestContext();
      const harness = await makeHarness();
      const deskApp = createApp({ service: context.service });
      const client = new DeskClient({
        cloudUrl: harness.base,
        secret: SECRET,
        name: 'Test Mac',
        answer: async (request) => deskApp.fetch(request),
        log: () => undefined,
        reconnect: false,
      });
      try {
        client.start();
        const code = await client.requestPairCode();
        const paired = await pair(harness.base, code.code);
        expect(paired.status).toBe(200);
        expect(paired.body).toMatchObject({ ok: true, desk: { name: 'Test Mac' } });
        const token = paired.body.token;
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

        const health = await fetch(`${harness.base}/api/health`, {
          headers: deviceHeaders(DEVICE_A, token),
        });
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({
          workspace: 'desk',
          pairing: true,
          desk: { name: 'Test Mac', online: true },
        });

        const inboxResponse = await fetch(`${harness.base}/api/inbox`, {
          headers: { ...deviceHeaders(DEVICE_A, token), origin: 'null' },
        });
        expect(inboxResponse.status).toBe(200);
        expect(inboxResponse.headers.get('access-control-allow-origin')).toBe('*');
        const inbox = (await inboxResponse.json()) as {
          items: { threadId: string; title: string }[];
          updatedAt: string;
        };
        expect(inbox.items.length).toBeGreaterThan(0);
        const first = inbox.items[0]!;

        const deckResponse = await fetch(
          `${harness.base}/api/deck/${encodeURIComponent(first.threadId)}`,
          { headers: deviceHeaders(DEVICE_A, token) },
        );
        expect(deckResponse.status).toBe(200);
        const deck = (await deckResponse.json()) as {
          threadId: string;
          points: { id: string; quote: string }[];
        };
        expect(deck.threadId).toBe(first.threadId);
        expect(deck.points.length).toBeGreaterThan(0);

        // Method, path, query, content type and body all survive the relay.
        const reviewResponse = await fetch(
          `${harness.base}/api/review/${encodeURIComponent(first.threadId)}?probe=1`,
          {
            method: 'PUT',
            headers: {
              ...deviceHeaders(DEVICE_A, token),
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              notes: [{ pointId: deck.points[0]!.id, verdict: 'note', text: 'Looks right' }],
            }),
          },
        );
        expect(reviewResponse.status).toBe(200);
        expect(await reviewResponse.json()).toMatchObject({
          threadId: first.threadId,
          notes: [{ pointId: deck.points[0]!.id, verdict: 'note', text: 'Looks right' }],
        });

        // A stopped desk keeps its pairing but reports offline, then relays 503.
        client.stop();
        await waitUntil(
          () => harness.cloud.desk.check(DEVICE_A, token!)?.online === false,
        );
        const offlineHealth = await fetch(`${harness.base}/api/health`, {
          headers: deviceHeaders(DEVICE_A, token),
        });
        expect(await offlineHealth.json()).toMatchObject({
          workspace: 'desk',
          desk: { name: 'Test Mac', online: false },
        });
        const offlineInbox = await fetch(`${harness.base}/api/inbox`, {
          headers: deviceHeaders(DEVICE_A, token),
        });
        expect(offlineInbox.status).toBe(503);
        expect(await offlineInbox.json()).toEqual({
          error: 'Your desk is offline. Start Pinpoint on your computer.',
          code: 'desk_offline',
        });

        // Unpair returns the device to its private sample workspace.
        const unpair = await fetch(`${harness.base}/api/pair`, {
          method: 'DELETE',
          headers: deviceHeaders(DEVICE_A, token),
        });
        expect(unpair.status).toBe(200);
        const sampleHealth = await fetch(`${harness.base}/api/health`, {
          headers: deviceHeaders(DEVICE_A, token),
        });
        expect(await sampleHealth.json()).toMatchObject({
          workspace: 'sample',
          pairing: true,
        });
        const sampleInbox = await fetch(`${harness.base}/api/inbox`, {
          headers: deviceHeaders(DEVICE_A, token),
        });
        expect(sampleInbox.status).toBe(200);
        const sample = (await sampleInbox.json()) as { items: unknown[] };
        expect(sample.items.length).toBeGreaterThan(0);
      } finally {
        client.stop();
        await harness.close();
        await cleanupTestContext(context);
      }
    },
  );

  it('rejects a missing or wrong desk secret at the upgrade', async () => {
    const harness = await makeHarness();
    try {
      const port = (harness.server.address() as AddressInfo).port;
      expect(await upgradeStatus(port)).toBe(401);
      expect(await upgradeStatus(port, { Authorization: 'Bearer short' })).toBe(401);
      expect(await upgradeStatus(port, { Authorization: 'Basic abc' })).toBe(401);
    } finally {
      await harness.close();
    }
  });

  it('replaces the old socket when the same desk secret reconnects', async () => {
    const harness = await makeHarness();
    const port = (harness.server.address() as AddressInfo).port;
    const first = await DeskPeer.connect(port);
    try {
      const replacement = await DeskPeer.connect(port, SECRET, 'Replacement');
      const [code] = await once(first.ws, 'close');
      expect(code).toBe(4001);

      const pairing = await pair(harness.base, await replacement.pairCode());
      expect(pairing.body).toMatchObject({ ok: true, desk: { name: 'Replacement' } });
      const token = pairing.body.token!;

      const pending = fetch(`${harness.base}/api/inbox`, {
        headers: deviceHeaders(DEVICE_A, token),
      });
      const answered = await answerJson(replacement, pending, () => ({
        body: { items: [], updatedAt: new Date().toISOString() },
      }));
      expect(answered.status).toBe(200);
      await replacement.close();
    } finally {
      await first.close();
      await harness.close();
    }
  });

  it('caps a relayed request at 2 MB before it reaches the desk', async () => {
    const harness = await makeHarness();
    const port = (harness.server.address() as AddressInfo).port;
    const peer = await DeskPeer.connect(port);
    try {
      const pairing = await pair(harness.base, await peer.pairCode());
      const token = pairing.body.token!;

      const tooBig = await fetch(`${harness.base}/api/review/login-fix`, {
        method: 'PUT',
        headers: {
          ...deviceHeaders(DEVICE_A, token),
          'content-type': 'application/json',
        },
        body: 'x'.repeat(2 * 1024 * 1024 + 1),
      });
      expect(tooBig.status).toBe(413);
      expect(await tooBig.json()).toMatchObject({ code: 'too_large' });
    } finally {
      await peer.close();
      await harness.close();
    }
  });

  it('rejects a desk response over 2 MB with 502', async () => {
    const harness = await makeHarness();
    const port = (harness.server.address() as AddressInfo).port;
    const peer = await DeskPeer.connect(port);
    try {
      const pairing = await pair(harness.base, await peer.pairCode());
      const token = pairing.body.token!;
      const pending = fetch(`${harness.base}/api/inbox`, {
        headers: deviceHeaders(DEVICE_A, token),
      });
      const message = await peer.next((entry) => entry.type === 'request');
      if (message.type !== 'request') throw new Error('expected request');
      peer.send({
        type: 'response',
        response: {
          id: message.request.id,
          status: 200,
          contentType: 'application/json',
          bodyBase64: Buffer.alloc(2 * 1024 * 1024 + 1, 0x61).toString('base64'),
        },
      });
      const response = await pending;
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ code: 'desk_too_large' });
    } finally {
      await peer.close();
      await harness.close();
    }
  });

  it('returns 504 when the desk never answers', async () => {
    const harness = await makeHarness({ relayTimeoutMs: 150 });
    const port = (harness.server.address() as AddressInfo).port;
    const peer = await DeskPeer.connect(port);
    try {
      const pairing = await pair(harness.base, await peer.pairCode());
      const token = pairing.body.token!;
      const response = await fetch(`${harness.base}/api/inbox`, {
        headers: deviceHeaders(DEVICE_A, token),
      });
      expect(response.status).toBe(504);
      expect(await response.json()).toMatchObject({ code: 'desk_timeout' });
    } finally {
      await peer.close();
      await harness.close();
    }
  });

  it('rate-limits wrong pairing codes per device and IP', async () => {
    const harness = await makeHarness();
    const port = (harness.server.address() as AddressInfo).port;
    const peer = await DeskPeer.connect(port);
    try {
      // A live desk with a real code, but the attacker guesses five times.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await pair(harness.base, 'AAAA-BBBB');
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ ok: false });
      }
      const limited = await pair(harness.base, 'AAAA-BBBB');
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ ok: false });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      // Even the real code cannot be redeemed after the budget is gone.
      const real = await peer.pairCode();
      expect((await pair(harness.base, real)).status).toBe(429);
    } finally {
      await peer.close();
      await harness.close();
    }
  });

  it('revokes every device paired to the desk on request', async () => {
    const harness = await makeHarness();
    const port = (harness.server.address() as AddressInfo).port;
    const peer = await DeskPeer.connect(port);
    try {
      const a = await pair(harness.base, await peer.pairCode(), DEVICE_A);
      const b = await pair(harness.base, await peer.pairCode(), DEVICE_B);
      expect(a.body.ok && b.body.ok).toBe(true);
      const tokenA = a.body.token!;
      const tokenB = b.body.token!;

      peer.send({ type: 'unpair-all', id: 'wipe-1' });
      const reply = await peer.next(
        (entry) => entry.type === 'unpaired' && entry.id === 'wipe-1',
      );
      expect(reply).toMatchObject({ type: 'unpaired', removed: 2 });

      const pairs = [
        [DEVICE_A, tokenA],
        [DEVICE_B, tokenB],
      ] as const;
      for (const [device, token] of pairs) {
        const response = await fetch(`${harness.base}/api/inbox`, {
          headers: deviceHeaders(device, token),
        });
        expect(response.status).toBe(200); // sample workspace again
      }
    } finally {
      await peer.close();
      await harness.close();
    }
  });

  it('keeps two desks with different secrets completely separate', async () => {
    const harness = await makeHarness();
    const port = (harness.server.address() as AddressInfo).port;
    const deskA = await DeskPeer.connect(port, SECRET, 'Desk A');
    const deskB = await DeskPeer.connect(port, OTHER_SECRET, 'Desk B');
    try {
      const a = await pair(harness.base, await deskA.pairCode(), DEVICE_A);
      const b = await pair(harness.base, await deskB.pairCode(), DEVICE_B);
      expect(a.body).toMatchObject({ ok: true, desk: { name: 'Desk A' } });
      expect(b.body).toMatchObject({ ok: true, desk: { name: 'Desk B' } });

      const healthA = await fetch(`${harness.base}/api/health`, {
        headers: deviceHeaders(DEVICE_A, a.body.token!),
      });
      expect(await healthA.json()).toMatchObject({
        workspace: 'desk',
        desk: { name: 'Desk A', online: true },
      });
      const healthB = await fetch(`${harness.base}/api/health`, {
        headers: deviceHeaders(DEVICE_B, b.body.token!),
      });
      expect(await healthB.json()).toMatchObject({
        workspace: 'desk',
        desk: { name: 'Desk B', online: true },
      });

      const pendingA = fetch(`${harness.base}/api/inbox`, {
        headers: deviceHeaders(DEVICE_A, a.body.token!),
      });
      const answerA = await answerJson(deskA, pendingA, () => ({
        body: { items: [{ threadId: 'from-a' }], updatedAt: new Date().toISOString() },
      }));
      expect(await answerA.json()).toMatchObject({ items: [{ threadId: 'from-a' }] });
      // Desk B never saw desk A's request.
      await expect(deskB.next(() => true, 100)).rejects.toThrow(/Timed out/);
    } finally {
      await deskA.close();
      await deskB.close();
      await harness.close();
    }
  });

  it('cannot use one device token from another device id', async () => {
    const harness = await makeHarness();
    const port = (harness.server.address() as AddressInfo).port;
    const peer = await DeskPeer.connect(port);
    try {
      const pairing = await pair(harness.base, await peer.pairCode(), DEVICE_A);
      const token = pairing.body.token!;
      const health = await fetch(`${harness.base}/api/health`, {
        headers: deviceHeaders(DEVICE_B, token),
      });
      expect(await health.json()).toMatchObject({ workspace: 'sample' });
      const response = await fetch(`${harness.base}/api/inbox`, {
        headers: deviceHeaders(DEVICE_B, token),
      });
      expect(response.status).toBe(200);
      const inbox = (await response.json()) as { items: unknown[] };
      expect(inbox.items.length).toBeGreaterThan(0); // sample, not the desk
    } finally {
      await peer.close();
      await harness.close();
    }
  });
});

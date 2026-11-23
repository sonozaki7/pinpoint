import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it, vi} from 'vitest';

import {assertLivePrivacy, readEnv} from '../src/core/env.js';
import {
  createT3Client,
  resolveProjectAllowlist,
  type ShellSnapshot,
} from '../src/t3/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/t3-shell-sample.json', import.meta.url));
const snapshot = JSON.parse(readFileSync(fixturePath, 'utf8')) as ShellSnapshot;
const NOW = Date.parse('2026-11-24T01:00:00.000Z');

/** Serve the fixture shell, count every URL, and fail the test on an unexpected read. */
function stubFetch(rows: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/orchestration/shell')) return Response.json(snapshot);
    if (url.includes('/transcript')) {
      rows.push(url);
      return Response.json({threadId: 'x', title: 'x', updatedAt: '2026-11-24T00:00:00.000Z', items: []});
    }
    if (url.includes('/api/orchestration/threads/')) {
      rows.push(url);
      return Response.json({thread: {id: 'x'}, messages: []});
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
}

describe('T3_PROJECTS privacy allowlist', () => {
  it('parses a comma-separated allowlist and ignores inline comments', () => {
    const env = readEnv({PINPOINT_MODE: 'live', T3_PROJECTS: ' pinpoint , mcp:abc # only these'});
    expect(env.t3Projects).toEqual(['pinpoint', 'mcp:abc']);
  });

  it('refuses to start live with no allowlist, but demo still runs', () => {
    expect(() => assertLivePrivacy(readEnv({PINPOINT_MODE: 'live'}))).toThrow(/T3_PROJECTS is empty/);
    expect(() => assertLivePrivacy(readEnv({PINPOINT_MODE: 'demo'}))).not.toThrow();
    expect(() =>
      assertLivePrivacy(readEnv({PINPOINT_MODE: 'live', T3_PROJECTS: 'pinpoint'})),
    ).not.toThrow();
  });

  it('does not construct a client without an allowlist', () => {
    expect(() =>
      createT3Client({T3_URL: 'http://127.0.0.1:3773', T3_TOKEN: 'test-token'}, {fetchImpl: stubFetch()}),
    ).toThrow(/T3_PROJECTS is empty/);
    expect(() =>
      createT3Client(
        {T3_URL: 'http://127.0.0.1:3773', T3_TOKEN: 'test-token', T3_PROJECTS: '   '},
        {fetchImpl: stubFetch()},
      ),
    ).toThrow(/T3_PROJECTS is empty/);
  });

  it('matches project ids and exact titles, and reports unmatched entries', () => {
    expect(resolveProjectAllowlist(snapshot, ['project-alpha']).ids).toEqual(new Set(['project-alpha']));
    expect(resolveProjectAllowlist(snapshot, ['Alpha']).ids).toEqual(new Set(['project-alpha']));
    expect(resolveProjectAllowlist(snapshot, ['alpha', 'beta']).ids.size).toBe(2);
    expect(resolveProjectAllowlist(snapshot, ['pinpoint']).unmatched).toEqual(['pinpoint']);
  });

  it('lists only threads from allowed projects', async () => {
    const client = createT3Client(
      {T3_URL: 'http://127.0.0.1:3773', T3_TOKEN: 'test-token', T3_PROJECTS: 'alpha'},
      {cliFallback: false, now: () => NOW, fetchImpl: stubFetch()},
    );
    const rows = await client.listAttention();
    expect(rows.length).toBeGreaterThan(0);
    const betaThreads = (snapshot.threads ?? [])
      .filter((thread) => thread.projectId === 'project-beta')
      .map((thread) => thread.id);
    expect(rows.some((row) => betaThreads.includes(row.threadId))).toBe(false);
    expect(rows.every((row) => row.project === 'alpha')).toBe(true);
  });

  it('never fetches a transcript for a thread outside the allowlist', async () => {
    const reads: string[] = [];
    const client = createT3Client(
      {T3_URL: 'http://127.0.0.1:3773', T3_TOKEN: 'test-token', T3_PROJECTS: 'alpha'},
      {cliFallback: false, now: () => NOW, fetchImpl: stubFetch(reads)},
    );
    await client.listAttention();
    // project-beta owns the only shell-hidden reply fixtures.
    expect(reads.filter((url) => url.includes('/transcript'))).toHaveLength(0);
  });

  it('refuses a single-thread read outside the allowlist', async () => {
    const reads: string[] = [];
    const client = createT3Client(
      {T3_URL: 'http://127.0.0.1:3773', T3_TOKEN: 'test-token', T3_PROJECTS: 'alpha'},
      {cliFallback: false, now: () => NOW, fetchImpl: stubFetch(reads)},
    );
    await expect(client.getSource('thread-report-transcript')).rejects.toThrow(/not visible in an allowed T3_PROJECTS project/);
    expect(reads.filter((url) => url.includes('/threads/'))).toHaveLength(0);
  });

  it('refuses to send to a thread outside the allowlist', async () => {
    const fetchImpl = vi.fn(stubFetch());
    const client = createT3Client(
      {T3_URL: 'http://127.0.0.1:3773', T3_TOKEN: 'test-token', T3_PROJECTS: 'alpha'},
      {cliFallback: false, now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch},
    );
    await expect(client.sendMessage('thread-failed', 'hello')).rejects.toThrow(/not visible in an allowed T3_PROJECTS project/);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('websocket-ticket'))).toBe(false);
  });

  it('refuses to answer a question outside the allowlist even if the projection read fails', async () => {
    const fetchImpl = vi.fn(stubFetch());
    const client = createT3Client(
      {T3_URL: 'http://127.0.0.1:3773', T3_TOKEN: 'test-token', T3_PROJECTS: 'alpha'},
      {cliFallback: false, now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch},
    );
    await expect(
      client.answerQuestion('thread-failed', 'runtime-request:x', {q: 'yes'}),
    ).rejects.toThrow(/not visible in an allowed T3_PROJECTS project/);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('websocket-ticket'))).toBe(false);
  });
});

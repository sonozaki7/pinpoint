import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  GoogleAuth,
  hasGoogleCredentials,
  readGoogleClient,
} from '../src/connectors/googleAuth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeCredentials(options?: { refresh?: boolean }): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pinpoint-google-'));
  dirs.push(dir);
  await writeFile(
    path.join(dir, 'google-client.json'),
    JSON.stringify({
      installed: {
        client_id: 'client-id.apps.googleusercontent.com',
        client_secret: 'client-secret',
        redirect_uris: ['http://localhost'],
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(dir, 'google-token.json'),
    JSON.stringify({
      access_token: 'old-token',
      expires_at: 1_700_000_000_000,
      ...(options?.refresh === false ? {} : { refresh_token: 'refresh-token' }),
      scope: 'scope-a',
      token_type: 'Bearer',
    }),
    { mode: 0o600 },
  );
  return dir;
}

describe('GoogleAuth', () => {
  it('refreshes an expired token once and writes it back with mode 0600', async () => {
    const dir = await makeCredentials();
    const now = 1_700_000_001_000;
    let calls = 0;
    let form = '';
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      expect(String(input)).toBe('https://oauth2.googleapis.com/token');
      form = String(init?.body);
      return jsonResponse({
        access_token: 'fresh-token',
        expires_in: 3600,
        refresh_token: 'refresh-token-2',
        scope: 'scope-a scope-b',
        token_type: 'Bearer',
      });
    }) as unknown as typeof fetch;

    const auth = GoogleAuth.fromDataDir(dir, { fetchImpl, now: () => now });
    expect(auth).not.toBeNull();
    expect(await auth!.accessToken()).toBe('fresh-token');
    expect(await auth!.accessToken()).toBe('fresh-token');
    expect(calls).toBe(1);

    expect(form).toContain('grant_type=refresh_token');
    expect(form).toContain('client_id=client-id.apps.googleusercontent.com');
    expect(form).toContain('refresh_token=refresh-token');

    const saved = JSON.parse(await readFile(path.join(dir, 'google-token.json'), 'utf8')) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };
    expect(saved.access_token).toBe('fresh-token');
    expect(saved.refresh_token).toBe('refresh-token-2');
    expect(saved.expires_at).toBe(now + 3_600_000);
    const mode = (await stat(path.join(dir, 'google-token.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('uses a still-valid token without calling Google', async () => {
    const dir = await makeCredentials();
    const fetchImpl = (async () => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    const auth = GoogleAuth.fromDataDir(dir, {
      fetchImpl,
      now: () => 1_699_999_000_000,
    });
    expect(await auth!.accessToken()).toBe('old-token');
  });

  it('handles a missing refresh token with a clear reconnect message', async () => {
    const dir = await makeCredentials({ refresh: false });
    const fetchImpl = (async () => jsonResponse({})) as unknown as typeof fetch;
    const auth = GoogleAuth.fromDataDir(dir, { fetchImpl });
    await expect(auth!.accessToken()).rejects.toThrow(
      'Google token has no refresh token; run "node scripts/connect-google.mjs" again',
    );
  });

  it('reports configured only when both files exist, and reads the desktop client', async () => {
    const dir = await makeCredentials();
    expect(hasGoogleCredentials(dir)).toBe(true);
    expect(readGoogleClient(dir)).toEqual({
      clientId: 'client-id.apps.googleusercontent.com',
      clientSecret: 'client-secret',
    });
    expect(hasGoogleCredentials(path.join(dir, 'missing'))).toBe(false);
  });
});

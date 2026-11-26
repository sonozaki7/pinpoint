import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_OPENROUTER_MODEL,
  OpenRouterConnector,
} from '../src/connectors/openrouter.js';
import { loadConnectors } from '../src/connectors/index.js';
import { readEnv } from '../src/core/env.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('OpenRouterConnector', () => {
  it('sends the Pinpoint headers and returns the message text', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      });
      return jsonResponse({ choices: [{ message: { content: 'Draft reply' } }] });
    }) as unknown as typeof fetch;

    const llm = new OpenRouterConnector({
      apiKey: 'sk-or-test',
      model: 'deepseek/deepseek-v4.1-flash',
      fetchImpl,
    });
    const text = await llm.complete({ system: 'Be brief', user: 'Draft a reply' });

    expect(text).toBe('Draft reply');
    expect(llm.name).toBe('openrouter:deepseek/deepseek-v4.1-flash');
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].headers.authorization).toBe('Bearer sk-or-test');
    expect(calls[0].headers['HTTP-Referer']).toBe('https://pinpoint.qolso.com');
    expect(calls[0].headers['X-Title']).toBe('Pinpoint');
    expect(calls[0].body).toMatchObject({
      model: 'deepseek/deepseek-v4.1-flash',
      messages: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'Draft a reply' },
      ],
    });
    expect((calls[0].body as { response_format?: unknown }).response_format).toBeUndefined();
  });

  it('asks for JSON mode and retries once on a 5xx', async () => {
    let attempt = 0;
    const bodies: unknown[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      attempt += 1;
      bodies.push(JSON.parse(String(init?.body)));
      if (attempt === 1) return jsonResponse({ error: { code: 'server_error' } }, 502);
      return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
    }) as unknown as typeof fetch;

    const llm = new OpenRouterConnector({
      apiKey: 'sk-or-test',
      fetchImpl,
      retryDelay: 0,
    });
    const text = await llm.complete({
      system: 'Return JSON',
      user: 'Give me a point',
      json: true,
      maxTokens: 128,
    });

    expect(text).toBe('{"ok":true}');
    expect(attempt).toBe(2);
    expect(bodies[0]).toMatchObject({
      response_format: { type: 'json_object' },
      max_tokens: 128,
    });
  });

  it('does not retry a 401 and never echoes the key', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: { code: 'invalid_api_key', message: 'bad key sk-or-test' } }, 401)) as unknown as typeof fetch;
    const llm = new OpenRouterConnector({ apiKey: 'sk-or-test', fetchImpl, retryDelay: 0 });
    await expect(llm.complete({ system: 's', user: 'u' })).rejects.toThrow(
      'openrouter returned HTTP 401 (invalid_api_key)',
    );
    try {
      await llm.complete({ system: 's', user: 'u' });
    } catch (error) {
      expect(String(error)).not.toContain('sk-or-test');
    }
  });
});

describe('loadConnectors', () => {
  it('builds only the configured connectors and defaults to the DeepSeek model', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pinpoint-connectors-'));
    dirs.push(dir);
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubEnv('OPENROUTER_MODEL', '');
    vi.stubEnv('NOTION_TOKEN', '');
    vi.stubEnv('NOTION_TASKS_DB', '');
    vi.stubEnv('NOTION_NOTES_ROOT', '');
    vi.stubEnv('GMAIL_QUERY', '');
    vi.stubEnv('GCAL_CALENDAR', '');
    vi.stubEnv('SPLITTER_MODEL', '');

    const connectors = loadConnectors(
      { mode: 'live', OPENROUTER_API_KEY: 'sk-or-test' },
      dir,
    );
    expect(connectors.mail).toBeUndefined();
    expect(connectors.calendar).toBeUndefined();
    expect(connectors.notes).toBeUndefined();
    expect(connectors.llm?.name).toBe(`openrouter:${DEFAULT_OPENROUTER_MODEL}`);
    expect(DEFAULT_OPENROUTER_MODEL).toBe('deepseek/deepseek-v4.1-flash');
  });

  it('returns nothing in cloud mode, even with keys set', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pinpoint-connectors-'));
    dirs.push(dir);
    const connectors = loadConnectors(
      { mode: 'cloud', OPENROUTER_API_KEY: 'sk-or-test', NOTION_TOKEN: 'ntn_x' },
      dir,
    );
    expect(connectors).toEqual({});
  });

  it('loads Google when both credential files exist and the opencode fallback otherwise', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pinpoint-connectors-'));
    dirs.push(dir);
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubEnv('NOTION_TOKEN', '');
    vi.stubEnv('SPLITTER_MODEL', 'opencode-go/deepseek-v4.1-flash');
    await writeFile(
      path.join(dir, 'google-client.json'),
      JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } }),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(dir, 'google-token.json'),
      JSON.stringify({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_at: Date.now() + 3_600_000,
      }),
      { mode: 0o600 },
    );

    const connectors = loadConnectors({ mode: 'live' }, dir);
    expect(connectors.mail).toBeDefined();
    expect(connectors.calendar).toBeDefined();
    expect(connectors.llm?.name).toBe('opencode:opencode-go/deepseek-v4.1-flash');
  });

  it('accepts the real Env object and loads configured Notion notes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pinpoint-connectors-'));
    dirs.push(dir);
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubEnv('OPENROUTER_MODEL', '');
    vi.stubEnv('SPLITTER_MODEL', '');
    const env = readEnv({ PINPOINT_MODE: 'live', PINPOINT_DATA_DIR: dir });

    const connectors = loadConnectors(
      { ...env, NOTION_TOKEN: 'ntn_test', NOTION_TASKS_DB: 'db-1', NOTION_NOTES_ROOT: 'page-1' },
      env.dataDir,
    );
    expect(connectors.notes).toBeDefined();
    expect(connectors.llm?.name.startsWith('opencode:')).toBe(true);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { createScriptedVoice, parseScriptedTranscripts } from '../src/voice/scripted.js';
import { cleanupTestContext, makeTestContext, type TestContext } from './helpers.js';

const FIXTURE = fileURLToPath(new URL('../../../demo/fixtures/transcripts.json', import.meta.url));

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-scripted-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

describe('scripted transcripts file', () => {
  it('ships the demo notes in storyboard order', () => {
    const script = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as unknown;
    const parsed = parseScriptedTranscripts(script);
    expect(parsed.delayMs).toBe(1_200);
    expect(parsed.notes.map((note) => [note.threadId, note.pointId, note.text])).toEqual([
      [
        'auth-refresh-fix',
        'p4',
        "No. Don't log everyone out. Migrate the existing sessions instead.",
      ],
      [
        'auth-refresh-fix',
        'p6',
        'Use a request queue. A mutex deadlocks with the retry path.',
      ],
      ['inbox-morning', 'p3', 'Make it Thursday, not Tuesday.'],
      ['login-fix', 'p4', "Don't sign everyone out. Just fix the broken logins."],
    ]);
  });

  it('rejects a file without notes', () => {
    expect(() => parseScriptedTranscripts({ notes: [] })).toThrow(/non-empty "notes"/);
    expect(() => parseScriptedTranscripts({ notes: [{ text: '  ' }] })).toThrow(/non-empty "text"/);
  });

  it('accepts point ids with or without the p prefix', () => {
    const parsed = parseScriptedTranscripts({
      notes: [{ pointId: '4', text: 'four' }, { pointId: 'point-6', text: 'six' }],
    });
    expect(parsed.notes.map((note) => note.pointId)).toEqual(['p4', 'p6']);
  });
});

describe('scripted voice service', () => {
  it('hands notes out in order when the client sends no point header', async () => {
    const voice = createScriptedVoice(FIXTURE, { delayMs: 0 });
    const audio = Buffer.alloc(160, 1);
    expect((await voice.transcribe(audio)).text).toBe(
      "No. Don't log everyone out. Migrate the existing sessions instead.",
    );
    expect((await voice.transcribe(audio)).text).toBe(
      'Use a request queue. A mutex deadlocks with the retry path.',
    );
    expect((await voice.transcribe(audio)).text).toBe('Make it Thursday, not Tuesday.');
  });

  it('selects the note for X-Point-Id and does not hand it out twice', async () => {
    const voice = createScriptedVoice(FIXTURE, { delayMs: 0 });
    const audio = Buffer.alloc(160, 1);
    const six = await voice.transcribe(audio, { threadId: 'auth-refresh-fix', pointId: 'p6' });
    expect(six).toEqual({
      text: 'Use a request queue. A mutex deadlocks with the retry path.',
      via: 'scripted',
    });
    const next = await voice.transcribe(audio);
    expect(next.text).toBe("No. Don't log everyone out. Migrate the existing sessions instead.");
  });

  it('waits the configured delay before answering', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'notes.json');
    fs.writeFileSync(file, JSON.stringify({ delayMs: 60, notes: [{ text: 'hello' }] }));
    const voice = createScriptedVoice(file);
    const started = Date.now();
    await voice.transcribe(Buffer.alloc(160, 1));
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('fails loudly when the script runs out', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'notes.json');
    fs.writeFileSync(file, JSON.stringify({ delayMs: 0, notes: [{ text: 'only one' }] }));
    const voice = createScriptedVoice(file);
    await voice.transcribe(Buffer.alloc(160, 1));
    await expect(voice.transcribe(Buffer.alloc(160, 1))).rejects.toThrow(/No scripted transcript left/);
  });
});

describe('POST /api/voice with scripted notes', () => {
  let context: TestContext | null = null;

  afterEach(async () => {
    if (context) await cleanupTestContext(context);
    context = null;
  });

  it('returns the note for the point header and a note verdict', async () => {
    context = await makeTestContext({ voice: createScriptedVoice(FIXTURE, { delayMs: 0 }) });
    const app = createApp({ service: context.service });
    const response = await app.request('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-point-id': 'p4', 'x-thread-id': 'auth-refresh-fix' },
      body: Buffer.alloc(160, 1),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "No. Don't log everyone out. Migrate the existing sessions instead.",
      verdict: 'object',
    });
  });

  it('works without the point headers too', async () => {
    context = await makeTestContext({ voice: createScriptedVoice(FIXTURE, { delayMs: 0 }) });
    const app = createApp({ service: context.service });
    const response = await app.request('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(160, 1),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { text: string }).text).toBe(
      "No. Don't log everyone out. Migrate the existing sessions instead.",
    );
  });
});

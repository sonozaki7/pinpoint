import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  markDeskRunning,
  runningDeskPid,
  sendDeskCommand,
  startCommandWatcher,
} from '../src/relay/control.js';
import { loadOrCreateDesk } from '../src/relay/deskCredentials.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-desk-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('desk credentials', () => {
  it('creates a mode-600 desk file once and reuses its secret', async () => {
    const dir = await tempDir();
    const first = loadOrCreateDesk({
      dataDir: dir,
      name: 'Test Desk',
      hostname: () => 'test-host.local',
    });
    expect(first.created).toBe(true);
    expect(first.credentials.name).toBe('Test Desk');
    expect(first.credentials.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(first.file).mode & 0o777).toBe(0o600);

    const second = loadOrCreateDesk({
      dataDir: dir,
      name: 'Test Desk',
      hostname: () => 'test-host.local',
    });
    expect(second.created).toBe(false);
    expect(second.credentials.secret).toBe(first.credentials.secret);

    const renamed = loadOrCreateDesk({ dataDir: dir, name: 'Renamed', hostname: () => 'x' });
    expect(renamed.credentials.name).toBe('Renamed');
    expect(renamed.credentials.secret).toBe(first.credentials.secret);
    expect((JSON.parse(fs.readFileSync(first.file, 'utf8')) as { name: string }).name).toBe(
      'Renamed',
    );
  });

  it('uses the short hostname without a domain when no name is set', async () => {
    const dir = await tempDir();
    const loaded = loadOrCreateDesk({
      dataDir: dir,
      hostname: () => 'Ana-MacBook.local',
    });
    expect(loaded.credentials.name).toBe('Ana-MacBook');
  });

  it('never overwrites an unreadable desk file', async () => {
    const dir = await tempDir();
    fs.writeFileSync(path.join(dir, 'desk.json'), 'not json', { mode: 0o600 });
    expect(() => loadOrCreateDesk({ dataDir: dir, hostname: () => 'x' })).toThrow(/not valid JSON/);
    expect(fs.readFileSync(path.join(dir, 'desk.json'), 'utf8')).toBe('not json');
  });
});

describe('desk commands', () => {
  it('routes --pair and --unpair-all through a running desk', async () => {
    const dir = await tempDir();
    const cleanupPid = markDeskRunning(dir);
    expect(runningDeskPid(dir)).toBe(process.pid);
    const stopWatcher = startCommandWatcher(dir, async (command) => {
      if (command === 'pair') {
        return { ok: true, code: 'K7Q4-2MXP', expiresAt: new Date(Date.now() + 600_000).toISOString() };
      }
      return { ok: true, removed: 3 };
    });
    try {
      const pair = await sendDeskCommand(dir, 'pair', 8_000);
      expect(pair).toMatchObject({ ok: true, code: 'K7Q4-2MXP' });
      const unpair = await sendDeskCommand(dir, 'unpair-all', 8_000);
      expect(unpair).toMatchObject({ ok: true, removed: 3 });
    } finally {
      stopWatcher();
      cleanupPid();
    }
    expect(runningDeskPid(dir)).toBeNull();
  });

  it('refuses a command when no desk is running', async () => {
    const dir = await tempDir();
    await expect(sendDeskCommand(dir, 'pair', 1_000)).rejects.toThrow(/not running/);
  });

  it('treats a stale pid file as no desk', async () => {
    const dir = await tempDir();
    fs.writeFileSync(
      path.join(dir, 'desk.pid'),
      JSON.stringify({ pid: 999_999, startedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    expect(runningDeskPid(dir)).toBeNull();
    expect(fs.existsSync(path.join(dir, 'desk.pid'))).toBe(false);
  });
});

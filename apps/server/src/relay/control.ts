import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DESK_PID_FILE = 'desk.pid';
export const DESK_COMMAND_FILE = 'desk-command.json';
export const DESK_RESULT_FILE = 'desk-command-result.json';

export type DeskCommand = 'pair' | 'unpair-all';

export interface DeskCommandResult {
  id: string;
  ok: boolean;
  code?: string;
  expiresAt?: string;
  removed?: number;
  error?: string;
}

export type DeskCommandHandler = (
  command: DeskCommand,
) => Promise<Omit<DeskCommandResult, 'id'>>;

interface CommandRequest {
  id: string;
  command: DeskCommand;
  at: number;
}

function fileFor(dataDir: string, name: string): string {
  return path.join(dataDir, name);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort.
  }
}

function removeQuietly(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone.
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The desk process recorded in .data/desk.pid, if it still exists. */
export function runningDeskPid(dataDir: string): number | null {
  const pidFile = fileFor(dataDir, DESK_PID_FILE);
  const record = readJson<{ pid?: unknown }>(pidFile);
  if (!record || typeof record.pid !== 'number' || !Number.isInteger(record.pid)) {
    return null;
  }
  if (record.pid === process.pid) return record.pid;
  if (!pidAlive(record.pid)) {
    removeQuietly(pidFile);
    return null;
  }
  return record.pid;
}

/** Write the liveness marker; returns a cleanup function. */
export function markDeskRunning(dataDir: string): () => void {
  const pidFile = fileFor(dataDir, DESK_PID_FILE);
  const existing = runningDeskPid(dataDir);
  if (existing !== null && existing !== process.pid) {
    throw new Error(
      `A desk is already running (process ${existing}). Use that terminal, or stop it first.`,
    );
  }
  writeJson(pidFile, { pid: process.pid, startedAt: new Date().toISOString() });
  return () => {
    const current = readJson<{ pid?: unknown }>(pidFile);
    if (current?.pid === process.pid) removeQuietly(pidFile);
  };
}

/**
 * The CLI writes one command request; the running desk watches for it and
 * writes the result. This keeps `--pair` and `--unpair-all` on the live socket
 * instead of opening a second connection that would replace it.
 */
export function startCommandWatcher(dataDir: string, handler: DeskCommandHandler): () => void {
  const commandFile = fileFor(dataDir, DESK_COMMAND_FILE);
  const resultFile = fileFor(dataDir, DESK_RESULT_FILE);
  const startedAt = Date.now();
  let handledId: string | null = null;
  let busy = false;

  const tick = async (): Promise<void> => {
    if (busy) return;
    const request = readJson<CommandRequest>(commandFile);
    if (!request || typeof request.id !== 'string' || request.id === handledId) return;
    if (request.command !== 'pair' && request.command !== 'unpair-all') return;
    // A request left over from before this process started is stale.
    if (typeof request.at !== 'number' || request.at < startedAt - 30_000) {
      handledId = request.id;
      return;
    }
    handledId = request.id;
    busy = true;
    try {
      const outcome = await handler(request.command);
      writeJson(resultFile, { id: request.id, ...outcome });
    } catch (error) {
      writeJson(resultFile, {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : 'The desk could not run that command.',
      });
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, 400);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    removeQuietly(commandFile);
    removeQuietly(resultFile);
  };
}

/**
 * Send one command to the running desk and wait for its result. Used by
 * `npm run desk -- --pair` and `-- --unpair-all` from another terminal.
 */
export async function sendDeskCommand(
  dataDir: string,
  command: DeskCommand,
  timeoutMs = 20_000,
): Promise<DeskCommandResult> {
  const pid = runningDeskPid(dataDir);
  if (pid === null) {
    throw new Error(
      'Your desk is not running. Start it with `npm run desk` in another terminal, then try again.',
    );
  }
  const commandFile = fileFor(dataDir, DESK_COMMAND_FILE);
  const resultFile = fileFor(dataDir, DESK_RESULT_FILE);
  const id = randomUUID();
  // Remove a result from an earlier command so a stale id cannot match.
  removeQuietly(resultFile);
  writeJson(commandFile, { id, command, at: Date.now() });

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const result = readJson<DeskCommandResult>(resultFile);
      if (result?.id === id) return result;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(
      'The desk did not answer. Check that `npm run desk` is connected to Pinpoint Cloud.',
    );
  } finally {
    const pending = readJson<CommandRequest>(commandFile);
    if (pending?.id === id) removeQuietly(commandFile);
  }
}

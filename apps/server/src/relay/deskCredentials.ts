import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanDeskName, isDeskSecret, newDeskSecret } from './protocol.js';

export const DESK_FILE = 'desk.json';

export interface DeskCredentials {
  secret: string;
  name: string;
}

export interface LoadDeskOptions {
  dataDir: string;
  /** PINPOINT_DESK_NAME; overrides the stored name when set. */
  name?: string;
  hostname?: () => string;
}

export interface LoadedDesk {
  credentials: DeskCredentials;
  file: string;
  created: boolean;
}

interface StoredDesk {
  secret: string;
  name?: string;
  createdAt?: string;
}

function defaultName(hostname: () => string): string {
  const host = hostname().split('.')[0] ?? '';
  return cleanDeskName(host);
}

function readStored(file: string): StoredDesk {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${file}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${file} is not valid JSON. Move it aside to create a new desk (every device must pair again).`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${file} is not a desk file. Move it aside and run npm run desk again.`);
  }
  const record = parsed as Partial<StoredDesk>;
  if (typeof record.secret !== 'string' || !isDeskSecret(record.secret)) {
    throw new Error(
      `${file} has no valid secret. Move it aside and run npm run desk again (every device must pair again).`,
    );
  }
  return {
    secret: record.secret,
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
  };
}

function writeStored(file: string, record: StoredDesk): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
}

/**
 * The desk secret is created once and kept only on this computer, mode 600.
 * The cloud sees its SHA-256, never the secret itself.
 */
export function loadOrCreateDesk(options: LoadDeskOptions): LoadedDesk {
  const file = path.join(options.dataDir, DESK_FILE);
  const hostname = options.hostname ?? os.hostname;
  const envName = options.name?.trim();

  if (fs.existsSync(file)) {
    const stored = readStored(file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Best effort.
    }
    const name = cleanDeskName(envName && envName.length > 0 ? envName : stored.name ?? defaultName(hostname));
    if (name !== stored.name) {
      writeStored(file, { ...stored, name });
    }
    return { credentials: { secret: stored.secret, name }, file, created: false };
  }

  const name = cleanDeskName(envName && envName.length > 0 ? envName : defaultName(hostname));
  const record: StoredDesk = {
    secret: newDeskSecret(),
    name,
    createdAt: new Date().toISOString(),
  };
  writeStored(file, record);
  return { credentials: { secret: record.secret, name }, file, created: true };
}

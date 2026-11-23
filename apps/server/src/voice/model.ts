import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Env } from '../core/env.js';

const MODEL_NAME = 'ggml-base.en.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;
const MIN_MODEL_BYTES = 10_000_000;

function expandHome(value: string): string {
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function scanModelDir(dir: string): string | null {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('ggml') && name.endsWith('.bin')) return path.join(dir, name);
    }
  } catch {
    // Folder absent.
  }
  return null;
}

export function modelCandidates(env: Env): string[] {
  const candidates: string[] = [];
  if (env.whisperModel) candidates.push(expandHome(env.whisperModel));
  candidates.push(
    path.join(env.dataDir, 'models', MODEL_NAME),
    '/opt/homebrew/share/whisper.cpp/models/' + MODEL_NAME,
    path.join(os.homedir(), '.cache/whisper.cpp', MODEL_NAME),
    path.join(os.homedir(), 'models', MODEL_NAME),
  );
  const t3Dirs = [
    'Library/Application Support/t3code/models',
    'Library/Application Support/t3code-v2/models',
    'Library/Application Support/t3code/voice/models',
  ];
  for (const dir of t3Dirs) {
    const found = scanModelDir(path.join(os.homedir(), dir));
    if (found) candidates.push(found);
  }
  return candidates;
}

export function findExistingModel(env: Env): string | null {
  for (const candidate of modelCandidates(env)) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && stat.size >= MIN_MODEL_BYTES) return candidate;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

async function downloadModel(env: Env): Promise<string> {
  const target = path.join(env.dataDir, 'models', MODEL_NAME);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.download`;
  console.info(`[voice] downloading ${MODEL_NAME} (~142 MB) to ${target}`);

  const response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok || !response.body) {
    throw new Error(`model download failed with HTTP ${response.status}`);
  }
  const file = fs.createWriteStream(tmp);
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (!file.write(buffer)) {
        await new Promise<void>((resolve) => file.once('drain', resolve));
      }
    }
    await new Promise<void>((resolve, reject) => {
      file.end(() => resolve());
      file.once('error', reject);
    });
    const stat = fs.statSync(tmp);
    if (stat.size < MIN_MODEL_BYTES) throw new Error('downloaded model is too small');
    fs.renameSync(tmp, target);
    console.info(`[voice] model ready (${Math.round(stat.size / 1_000_000)} MB)`);
    return target;
  } catch (error) {
    file.destroy();
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

export async function resolveWhisperModel(env: Env): Promise<string> {
  const existing = findExistingModel(env);
  if (existing) return existing;
  return downloadModel(env);
}

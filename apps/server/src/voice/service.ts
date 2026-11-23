import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Env } from '../core/env.js';
import { errorMessage } from '../core/errors.js';
import { resolveWhisperModel } from './model.js';
import { createScriptedVoice } from './scripted.js';
import { isWav, pcm16ToFloat32, pcmToWav, wavToPcm } from './wav.js';

export interface VoiceResult {
  text: string;
  via: 't3' | 'whisper' | 'scripted';
}

export interface VoiceHint {
  threadId?: string;
  pointId?: string;
}

export interface VoiceTranscriber {
  transcribe(audio: Buffer, hint?: VoiceHint): Promise<VoiceResult>;
}

const T3_TIMEOUT_MS = 60_000;
const WHISPER_TIMEOUT_MS = 120_000;

/** T3 expects a 4-byte JSON length, the JSON options, then raw Float32 PCM (no WAV header). */
function framePcmForT3(pcm16: Buffer): Buffer {
  const options = {
    speechLanguage: 'auto',
    speechTranslateToEnglish: false,
    speechCustomWords: [],
    speechRemoveFillerWords: true,
    speechSilenceFiltering: true,
  };
  const metadata = Buffer.from(JSON.stringify(options), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(metadata.length, 0);
  return Buffer.concat([header, metadata, pcm16ToFloat32(pcm16)]);
}

function cleanTranscript(text: string): string {
  return text
    .replace(/\[\d{2}:\d{2}:\d{2}[^\]]*\]/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function transcribeWithT3(env: Env, pcm: Buffer): Promise<string> {
  if (!env.t3Token) throw new Error('T3_TOKEN is not set');
  const response = await fetch(`${env.t3Url}/api/voice/transcribe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      authorization: `Bearer ${env.t3Token}`,
    },
    body: new Uint8Array(framePcmForT3(pcm)),
    signal: AbortSignal.timeout(T3_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`T3 voice HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('T3 voice returned a non-JSON body');
  }
  const text = (parsed as { text?: unknown }).text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('T3 voice returned no text');
  }
  return cleanTranscript(text);
}

function runWhisperCli(model: string, wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'whisper-cli',
      ['-m', model, '-f', wavPath, '-l', 'en', '-nt', '-np'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
      reject(new Error(`whisper-cli timed out after ${WHISPER_TIMEOUT_MS / 1000}s`));
    }, WHISPER_TIMEOUT_MS);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 200_000) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`whisper-cli could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = cleanTranscript(stdout);
      if (code === 0 && text.length > 0) resolve(text);
      else reject(new Error(`whisper-cli exited ${code ?? 'null'}: ${stderr.trim().slice(-300)}`));
    });
  });
}

async function transcribeWithWhisper(env: Env, wav: Buffer): Promise<string> {
  const model = await resolveWhisperModel(env);
  const dir = path.join(env.dataDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `voice-${process.pid}-${Date.now()}.wav`);
  try {
    fs.writeFileSync(file, wav);
    return await runWhisperCli(model, file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * SPEC §9: T3's local transcription first, then whisper-cli with a ggml model.
 * The glasses post raw PCM; a WAV fixture is also accepted.
 */
export function createVoiceService(env: Env): VoiceTranscriber {
  if (env.scriptedTranscripts) {
    // Recording helper: deterministic notes with a realistic latency, no model.
    return createScriptedVoice(env.scriptedTranscripts);
  }
  return {
    async transcribe(audio: Buffer): Promise<VoiceResult> {
      if (audio.length < 100) throw new Error('No audio captured');
      const pcm = isWav(audio) ? wavToPcm(audio) : audio;
      const wav = isWav(audio) ? audio : pcmToWav(pcm);
      const failures: string[] = [];

      if (env.t3Token) {
        try {
          const started = Date.now();
          const text = await transcribeWithT3(env, pcm);
          console.info(`[voice] transcribed via T3 in ${Date.now() - started}ms`);
          return { text, via: 't3' };
        } catch (error) {
          failures.push(`T3: ${errorMessage(error)}`);
          console.warn(`[voice] T3 transcription failed, trying whisper-cli: ${errorMessage(error)}`);
        }
      }

      try {
        const started = Date.now();
        const text = await transcribeWithWhisper(env, wav);
        console.info(`[voice] transcribed via whisper-cli in ${Date.now() - started}ms`);
        return { text, via: 'whisper' };
      } catch (error) {
        failures.push(`whisper: ${errorMessage(error)}`);
      }

      throw new Error(`Transcription failed. ${failures.join(' | ')}`);
    },
  };
}

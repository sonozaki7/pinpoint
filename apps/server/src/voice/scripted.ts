import fs from 'node:fs';
import path from 'node:path';
import type { VoiceHint, VoiceResult, VoiceTranscriber } from './service.js';

/**
 * Scripted voice notes for demo recordings.
 *
 * `PINPOINT_SCRIPTED_TRANSCRIPTS` points at a JSON file shaped like
 * `demo/fixtures/transcripts.json`:
 *
 *   { "delayMs": 1200, "notes": [
 *       { "threadId": "auth-refresh-fix", "pointId": "p4", "text": "..." } ] }
 *
 * /api/voice answers with the next unused note. A client that sends
 * `X-Point-Id` (and optionally `X-Thread-Id`) gets the note for that point;
 * otherwise notes are handed out in file order. The delay mimics a real
 * transcription round trip so the glasses show their "Listening..." state.
 * Exhausting the list is an error, not a silent repeat, so a broken take is
 * obvious instead of recording the wrong sentence.
 */

export interface ScriptedNote {
  threadId?: string;
  pointId?: string;
  text: string;
}

export interface ScriptedTranscripts {
  delayMs: number;
  notes: ScriptedNote[];
}

const DEFAULT_DELAY_MS = 1_200;

function canonicalPoint(value: string): string {
  const digits = value.match(/\d+/)?.[0];
  return digits ? `p${Number.parseInt(digits, 10)}` : value.trim().toLowerCase();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`"${key}" must be a string`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseScriptedTranscripts(raw: unknown): ScriptedTranscripts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('scripted transcripts must be a JSON object');
  }
  const record = raw as Record<string, unknown>;
  const rawNotes = record.notes;
  if (!Array.isArray(rawNotes) || rawNotes.length === 0) {
    throw new Error('scripted transcripts need a non-empty "notes" array');
  }
  const notes: ScriptedNote[] = [];
  for (const [index, value] of rawNotes.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`note ${index + 1} must be an object`);
    }
    const entry = value as Record<string, unknown>;
    const text = optionalString(entry, 'text');
    if (!text) throw new Error(`note ${index + 1} needs a non-empty "text"`);
    const threadId = optionalString(entry, 'threadId');
    const pointId = optionalString(entry, 'pointId');
    notes.push({
      text,
      ...(threadId ? { threadId } : {}),
      ...(pointId ? { pointId: canonicalPoint(pointId) } : {}),
    });
  }
  const rawDelay = record.delayMs;
  let delayMs = DEFAULT_DELAY_MS;
  if (typeof rawDelay === 'number' && Number.isFinite(rawDelay) && rawDelay >= 0) {
    delayMs = Math.round(rawDelay);
  }
  return { delayMs, notes };
}

export function loadScriptedTranscripts(file: string): ScriptedTranscripts {
  const resolved = path.resolve(file);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`could not read scripted transcripts at ${resolved}: ${(error as Error).message}`);
  }
  return parseScriptedTranscripts(raw);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Matches a requested point id ("4", "p4", "point-4") against a scripted note. */
function samePoint(note: ScriptedNote, pointId: string | undefined): boolean {
  if (!note.pointId || !pointId) return false;
  return note.pointId === canonicalPoint(pointId);
}

export function createScriptedVoice(file: string, options: { delayMs?: number } = {}): VoiceTranscriber {
  const script = loadScriptedTranscripts(file);
  const delayMs = options.delayMs ?? script.delayMs;
  const used = new Set<number>();

  return {
    async transcribe(_audio: Buffer, hint?: VoiceHint): Promise<VoiceResult> {
      const started = Date.now();
      const available = script.notes
        .map((note, index) => ({ note, index }))
        .filter(({ index }) => !used.has(index));
      const threadMatches = available.filter(
        ({ note }) => !hint?.threadId || !note.threadId || note.threadId === hint.threadId,
      );
      const chosen =
        threadMatches.find(({ note }) => samePoint(note, hint?.pointId)) ??
        threadMatches[0] ??
        available[0];
      if (!chosen) {
        throw new Error(
          `No scripted transcript left (used ${used.size}/${script.notes.length}) — restart the server for a fresh take`,
        );
      }
      used.add(chosen.index);
      if (delayMs > 0) await sleep(delayMs);
      const where = chosen.note.pointId ? ` point=${chosen.note.pointId}` : '';
      console.info(
        `[voice] scripted note ${used.size}/${script.notes.length}${where} after ${Date.now() - started}ms`,
      );
      return { text: chosen.note.text, via: 'scripted' };
    },
  };
}

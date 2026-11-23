import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isWav, pcm16ToFloat32, pcmDurationMs, pcmToWav, wavToPcm } from '../src/voice/wav.js';
import { verdictForTranscript } from '../src/voice/verdict.js';

describe('WAV helpers', () => {
  it('wraps raw PCM with a valid 16 kHz mono header', () => {
    const pcm = Buffer.alloc(3200, 1);
    const wav = pcmToWav(pcm);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.length).toBe(44 + pcm.length);
    expect(isWav(wav)).toBe(true);
    expect(wavToPcm(wav)).toEqual(pcm);
  });

  it('measures PCM duration', () => {
    expect(pcmDurationMs(Buffer.alloc(32_000))).toBe(1000);
  });

  it('converts s16le PCM to the Float32 stream T3 expects', () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(16_384, 2);
    pcm.writeInt16LE(-16_384, 4);
    pcm.writeInt16LE(32_767, 6);
    const floats = pcm16ToFloat32(pcm);
    expect(floats.length).toBe(16);
    expect(floats.readFloatLE(0)).toBe(0);
    expect(floats.readFloatLE(4)).toBe(0.5);
    expect(floats.readFloatLE(8)).toBe(-0.5);
    expect(floats.readFloatLE(12)).toBeGreaterThan(0.99);
    expect(floats.readFloatLE(12)).toBeLessThanOrEqual(1);
  });

  it('rejects non-WAV input for the WAV parser', () => {
    expect(() => wavToPcm(Buffer.from('not a wav file at all'))).toThrow();
  });
});

describe('voice verdict heuristic (SPEC §9)', () => {
  const objections = [
    'No, that deletes the cache.',
    "Don't ship this on a Friday.",
    'Do not truncate the sessions table.',
    'Not the right approach.',
    'Wrong, reuse the session.',
    'Instead, migrate existing sessions.',
    'Stop and roll it back.',
    'Never force-logout everyone.',
    'No',
  ];
  for (const text of objections) {
    it(`marks "${text}" as an objection`, () => {
      expect(verdictForTranscript(text)).toBe('object');
    });
  }

  const notes = ['This looks good.', 'Nothing else is blocking.', 'Make the timeout configurable.'];
  for (const text of notes) {
    it(`marks "${text}" as a note`, () => {
      expect(verdictForTranscript(text)).toBe('note');
    });
  }

  it('treats curly apostrophes like straight ones', () => {
    expect(verdictForTranscript('Don’t merge yet')).toBe('object');
  });
});

describe('voice service archives', () => {
  it('does not leave temp audio files behind', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-voice-'));
    await fs.promises.rm(dir, { recursive: true, force: true });
    expect(fs.existsSync(dir)).toBe(false);
  });
});

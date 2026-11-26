import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MAX_RECORD_BYTES, MIN_SPEECH_MS, PcmRecorder, SILENCE_STOP_MS, SilenceGate, concatPcm,
  pcmDurationMs, pcmFrame, pcmRms,
} from "../src/voice";

test("the recorder caps at 30 s of PCM and copies frames", () => {
  const recorder = new PcmRecorder();
  recorder.start();
  const frame = new Uint8Array(1_000).fill(7);
  recorder.push(frame);
  frame.fill(9); // the host reuses its audio buffer
  const oneFrame = recorder.stop();
  assert.equal(oneFrame[0], 7, "the recorder kept its own copy");

  recorder.start();
  recorder.push(new Uint8Array(MAX_RECORD_BYTES + 500));
  assert.equal(recorder.bytes, MAX_RECORD_BYTES);
  assert.equal(recorder.stop().length, MAX_RECORD_BYTES);
  assert.equal(pcmDurationMs(MAX_RECORD_BYTES), 30_000);

  recorder.stop();
  assert.equal(recorder.active, false);
  assert.equal(concatPcm([new Uint8Array([1]), new Uint8Array([2])]).length, 2);
});

test("voice stops itself after 1.2 s of silence once 0.5 s of speech was heard", () => {
  const gate = new SilenceGate();
  assert.equal(pcmRms(pcmFrame(100, 0)), 0);
  assert.ok(pcmRms(pcmFrame(100, 3_000)) > 2_000);
  for (let i = 0; i < 5; i++) gate.push(pcmFrame(100, 3_000)); // 0.5 s speech
  assert.equal(gate.speech, MIN_SPEECH_MS);
  for (let i = 0; i < 5; i++) assert.equal(gate.push(pcmFrame(200, 0)), false); // 1.0 s quiet
  assert.equal(gate.push(pcmFrame(200, 0)), true, "1.2 s quiet ends the note");
  assert.equal(gate.silence, SILENCE_STOP_MS);
});

test("a cough followed by quiet does not stop the recording", () => {
  const gate = new SilenceGate();
  for (let i = 0; i < 4; i++) gate.push(pcmFrame(100, 4_000)); // 0.4 s, below the minimum
  for (let i = 0; i < 20; i++) assert.equal(gate.push(pcmFrame(200, 0)), false);
  assert.equal(gate.speech, 400);
});

test("a short pause inside speech does not stop it, and the 30 s ceiling does", () => {
  const gate = new SilenceGate();
  for (let i = 0; i < 6; i++) gate.push(pcmFrame(100, 3_000));
  for (let i = 0; i < 5; i++) assert.equal(gate.push(pcmFrame(200, 0)), false); // 1.0 s pause
  gate.push(pcmFrame(200, 3_000));
  assert.equal(gate.silence, 0, "speech resets the quiet clock");
  for (let i = 0; i < 5; i++) assert.equal(gate.push(pcmFrame(200, 0)), false);

  const continuous = new SilenceGate();
  for (let i = 0; i < 29; i++) assert.equal(continuous.push(pcmFrame(1_000, 3_000)), false);
  assert.equal(continuous.push(pcmFrame(1_000, 3_000)), true, "hard stop at 30 s");
});

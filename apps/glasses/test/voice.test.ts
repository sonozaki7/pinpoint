import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MAX_RECORD_BYTES, PcmRecorder, concatPcm, pcmDurationMs } from "../src/voice";

test("the recorder caps at 25 s of PCM and copies frames", () => {
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
  assert.equal(pcmDurationMs(MAX_RECORD_BYTES), 25_000);

  recorder.stop();
  assert.equal(recorder.active, false);
  assert.equal(concatPcm([new Uint8Array([1]), new Uint8Array([2])]).length, 2);
});

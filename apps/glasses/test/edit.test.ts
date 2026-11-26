import { strict as assert } from "node:assert";
import { test } from "node:test";
import { editDraftSentence, MockPinpointApi } from "../src/mock";

/**
 * The glasses simulator applies the same deterministic grammar as the server,
 * from shared/edit.ts. Speech-to-text output (digits, number words, fillers)
 * must read the same as a typed note, and an unknown note fails with the short
 * on-glasses message instead of guessing.
 */

const SENTENCE = "We're happy to agree to net-60 payment terms.";
const FAILED = "Couldn't change this line";

const REPLACES: Array<[note: string, after: string]> = [
  ["Net 45, not Net 60", "We're happy to agree to net-45 payment terms."],
  ["Net forty five, not net sixty", "We're happy to agree to net-45 payment terms."],
  ["not net 60, net 45", "We're happy to agree to net-45 payment terms."],
  ["net 45 instead of net 60", "We're happy to agree to net-45 payment terms."],
  ["change net 60 to net 45", "We're happy to agree to net-45 payment terms."],
  ["um, Net 45, not Net 60 please", "We're happy to agree to net-45 payment terms."],
];

for (const [note, after] of REPLACES) {
  test(`glasses mock replaces "${note}"`, () => {
    assert.deepEqual(editDraftSentence(SENTENCE, note), {
      ok: true,
      method: "replace",
      after,
    });
  });
}

test("glasses mock swaps a weekday spoken as a bare contrast", () => {
  assert.deepEqual(editDraftSentence("We can invoice on Tuesday.", "Thursday not Tuesday"), {
    ok: true,
    method: "replace",
    after: "We can invoice on Thursday.",
  });
});

test("glasses mock understands make it … instead of …", () => {
  assert.deepEqual(
    editDraftSentence("We can invoice on Tuesday.", "make it Thursday instead of Tuesday"),
    { ok: true, method: "replace", after: "We can invoice on Thursday." },
  );
});

test("glasses mock changes a duration", () => {
  assert.deepEqual(editDraftSentence("Payment is due in 30 days.", "change 30 days to 14 days"), {
    ok: true,
    method: "replace",
    after: "Payment is due in 14 days.",
  });
});

test("glasses mock deletes the line", () => {
  for (const note of ["delete", "delete this", "remove this", "drop it", "cut this line"]) {
    assert.deepEqual(editDraftSentence(SENTENCE, note), { ok: true, method: "delete" });
  }
});

const SAYS: Array<[note: string, after: string]> = [
  ["say Please confirm by Friday", "Please confirm by Friday."],
  ["instead say We can invoice from Tuesday", "We can invoice from Tuesday."],
  ["change it to: the terms are agreed", "The terms are agreed."],
  ["replace with the terms are agreed", "The terms are agreed."],
];

for (const [note, after] of SAYS) {
  test(`glasses mock says "${note}"`, () => {
    assert.deepEqual(editDraftSentence(SENTENCE, note), {
      ok: true,
      method: "say",
      after,
    });
  });
}

test("glasses mock refuses a note it cannot read", () => {
  for (const note of ["polish this", "not net 60", "make this shorter", ""]) {
    assert.deepEqual(editDraftSentence(SENTENCE, note), { ok: false, error: FAILED });
  }
});

test("the mock API applies the shared grammar to a draft point", async () => {
  const api = new MockPinpointApi({ extended: true });
  const result = await api.edit("draft-priya", "p2", "Net 45, not Net 60");
  assert.equal(result.ok, true);
  assert.equal(result.method, "replace");
  assert.equal(result.after, "We're happy to agree to net-45 payment terms.");
});

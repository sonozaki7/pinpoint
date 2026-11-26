import { describe, expect, it } from 'vitest';
import { applyDraftEdits, draftPoints, receiptName, sentenceSpans } from '../src/core/draft.js';
import { editSentence, tidySentence } from '../src/core/edit.js';
import { applyEdit } from '../../../shared/edit.js';
import type { Deck, ReviewDraft } from '../../../shared/contract.js';

describe('edit grammar', () => {
  const sentence = "We're happy to agree to net-60 payment terms.";

  it('swaps "<new>, not <old>" inside the sentence, keeping its casing', async () => {
    const result = await editSentence({ before: sentence, note: 'Net-45, not net-60.' });
    expect(result).toEqual({
      ok: true,
      method: 'replace',
      after: "We're happy to agree to net-45 payment terms.",
    });
  });

  it('keeps a capital when the old phrase starts the sentence', async () => {
    const result = await editSentence({
      before: 'Net-60 is too long.',
      note: 'Net-45, not net-60.',
    });
    expect(result.after).toBe('Net-45 is too long.');
  });

  it('matches the old phrase case-insensitively', async () => {
    const result = await editSentence({
      before: 'The contract says Net-60.',
      note: 'net-45, not NET-60',
    });
    expect(result.after).toBe('The contract says Net-45.');
  });

  it('deletes the sentence for delete / remove this / drop it', async () => {
    for (const note of ['delete', 'Remove this.', 'drop it']) {
      const result = await editSentence({ before: sentence, note });
      expect(result).toMatchObject({ ok: true, method: 'delete' });
      expect(result.after).toBeUndefined();
    }
  });

  it('replaces the sentence for say / instead / change it to', async () => {
    expect((await editSentence({ before: sentence, note: 'Say we can invoice from Tuesday' })).after)
      .toBe('We can invoice from Tuesday.');
    expect((await editSentence({ before: sentence, note: 'Instead, make it Tuesday.' })).after)
      .toBe('Make it Tuesday.');
    expect(
      (await editSentence({ before: sentence, note: 'change it to: the terms are agreed' })).after,
    ).toBe('The terms are agreed.');
  });

  it('tidySentence capitalises and ends with one clear stop', () => {
    expect(tidySentence('  we agree ')).toBe('We agree.');
    expect(tidySentence('is it ready?')).toBe('Is it ready?');
    expect(tidySentence('"We agree,"')).toBe('We agree.');
    expect(tidySentence('')).toBe('');
  });

  it('uses the LLM only for a general note, then verifies one sentence', async () => {
    const calls: string[] = [];
    const result = await editSentence({
      before: 'The delivery date in clause 9 works for us.',
      note: 'Make this shorter.',
      llm: async ({ user }) => {
        calls.push(user);
        return 'The clause 9 date works.';
      },
    });
    expect(result).toEqual({
      ok: true,
      method: 'rewrite',
      after: 'The clause 9 date works.',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('The delivery date in clause 9 works for us.');
  });

  it('fails when the LLM returns more than one sentence', async () => {
    const result = await editSentence({
      before: sentence,
      note: 'Make this shorter.',
      llm: async () => 'We agree. We will pay.',
    });
    expect(result).toMatchObject({ ok: false, error: "Couldn't change this line" });
    expect(result.after).toBeUndefined();
  });

  it('fails when the LLM throws or no LLM is available', async () => {
    const thrown = await editSentence({
      before: sentence,
      note: 'Make this shorter.',
      llm: async () => {
        throw new Error('model down');
      },
    });
    expect(thrown.ok).toBe(false);
    expect(thrown.error).toBe("Couldn't change this line");

    const absent = await editSentence({ before: sentence, note: 'Make this shorter.' });
    expect(absent.ok).toBe(false);
  });

  it('answers the deterministic path well under 300 ms', async () => {
    const started = performance.now();
    const result = await editSentence({ before: sentence, note: 'Net-45, not net-60.' });
    expect(result.ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('shared edit grammar (applyEdit)', () => {
  type GrammarCase = [
    sentence: string,
    note: string,
    expected: { method: 'replace' | 'delete' | 'say'; after?: string } | null,
  ];

  const cases: GrammarCase[] = [
    // The bug this module exists for: Whisper writes digits, the draft says net-60.
    ["We're happy to agree to net-60 payment terms.", 'Net 45, not Net 60',
      { method: 'replace', after: "We're happy to agree to net-45 payment terms." }],
    ["We're happy to agree to net-60 payment terms.", 'Net forty five, not net sixty',
      { method: 'replace', after: "We're happy to agree to net-45 payment terms." }],
    ["We're happy to agree to net-60 payment terms.", 'Net forty-five, not net sixty.',
      { method: 'replace', after: "We're happy to agree to net-45 payment terms." }],
    ['We agree to net sixty terms.', 'Net 45, not Net 60',
      { method: 'replace', after: 'We agree to net forty-five terms.' }],
    ['We agree to net sixty terms.', 'net 45 not net 60',
      { method: 'replace', after: 'We agree to net forty-five terms.' }],
    ['We agree to NET-60 terms.', 'net 45, not net 60',
      { method: 'replace', after: 'We agree to NET-45 terms.' }],
    ['Net-60 is too long.', 'Net-45, not net-60.',
      { method: 'replace', after: 'Net-45 is too long.' }],
    ['The contract says Net-60.', 'net-45, not NET-60',
      { method: 'replace', after: 'The contract says Net-45.' }],
    ['We pay on a net\u201360 schedule.', 'Net 45, not Net 60',
      { method: 'replace', after: 'We pay on a net\u201345 schedule.' }],
    ['We can invoice on Tuesday.', 'Thursday not Tuesday',
      { method: 'replace', after: 'We can invoice on Thursday.' }],
    ['We can invoice on Tuesday.', 'make it Thursday instead of Tuesday',
      { method: 'replace', after: 'We can invoice on Thursday.' }],
    ['We can invoice on Tuesday.', 'not Tuesday, Thursday',
      { method: 'replace', after: 'We can invoice on Thursday.' }],
    ['We can invoice on Tuesday.', 'no, not Tuesday, Thursday',
      { method: 'replace', after: 'We can invoice on Thursday.' }],
    ['We can invoice on Tuesday.', 'change Tuesday to Thursday',
      { method: 'replace', after: 'We can invoice on Thursday.' }],
    ['We can invoice on Tuesday.', 'replace Tuesday with Thursday',
      { method: 'replace', after: 'We can invoice on Thursday.' }],
    ['Payment is due in 30 days.', 'change 30 days to 14 days',
      { method: 'replace', after: 'Payment is due in 14 days.' }],
    ['Payment is due in 14 days.', '30 days instead of 14 days',
      { method: 'replace', after: 'Payment is due in 30 days.' }],
    ['Payment is due in 30 days.', 'should be 14 days, not 30 days',
      { method: 'replace', after: 'Payment is due in 14 days.' }],
    ['Net-60 is too long.', 'um, net 45, not net 60 please',
      { method: 'replace', after: 'Net-45 is too long.' }],
    ['We ship 100 units.', 'change 100 to fifty',
      { method: 'replace', after: 'We ship 50 units.' }],
    ['We ship in 5 days.', 'not five days, ten days',
      { method: 'replace', after: 'We ship in 10 days.' }],
    ['We ship in five days.', '10 days rather than five days',
      { method: 'replace', after: 'We ship in ten days.' }],
    ["We're happy to agree to net-60 payment terms.", 'delete',
      { method: 'delete' }],
    ["We're happy to agree to net-60 payment terms.", 'Remove this.',
      { method: 'delete' }],
    ["We're happy to agree to net-60 payment terms.", 'drop it',
      { method: 'delete' }],
    ["We're happy to agree to net-60 payment terms.", 'cut this line',
      { method: 'delete' }],
    ["We're happy to agree to net-60 payment terms.", 'say Please confirm by Friday',
      { method: 'say', after: 'Please confirm by Friday.' }],
    ["We're happy to agree to net-60 payment terms.", 'instead say We can invoice from Tuesday',
      { method: 'say', after: 'We can invoice from Tuesday.' }],
    ["We're happy to agree to net-60 payment terms.", 'change it to: the terms are agreed',
      { method: 'say', after: 'The terms are agreed.' }],
    ["We're happy to agree to net-60 payment terms.", 'replace with the terms are agreed',
      { method: 'say', after: 'The terms are agreed.' }],
    ["We're happy to agree to net-60 payment terms.", 'polish this', null],
    ["We're happy to agree to net-60 payment terms.", 'not net 60', null],
    ['The meeting is at 9am.', 'make this shorter', null],
    ['The meeting is at 9am.', 'explain this better', null],
  ];

  it.each(cases)('%j <- %j', (sentence, note, expected) => {
    expect(applyEdit(sentence, note)).toEqual(
      expected === null
        ? { ok: false, error: "Couldn't change this line" }
        : { ok: true, ...expected },
    );
  });

  it('treats hyphens, spaces and en dashes as equivalent when matching', () => {
    const pairs: Array<[sentence: string, after: string]> = [
      ['We pay net-60 now.', 'We pay net-45 now.'],
      ['We pay net 60 now.', 'We pay net 45 now.'],
      ['We pay net\u201360 now.', 'We pay net\u201345 now.'],
    ];
    for (const [sentence, after] of pairs) {
      expect(applyEdit(sentence, 'net 45, not net 60').after).toBe(after);
    }
  });

  it('still leaves an unknown note to the server LLM fallback', async () => {
    const result = await editSentence({
      before: 'The delivery date in clause 9 works for us.',
      note: 'Make this shorter.',
      llm: async () => 'The clause 9 date works.',
    });
    expect(result).toEqual({ ok: true, method: 'rewrite', after: 'The clause 9 date works.' });
  });
});

describe('Gmail draft sentences', () => {
  const body =
    "Hi Priya,\n\nThanks for sending the revised contract over. We're happy to agree to net-60 payment terms. " +
    'We can have the signed copy back to you by Friday.\n\nBest,\nSam';

  it('makes one draft point per sentence and skips greetings and sign-offs', () => {
    const spans = sentenceSpans(body);
    expect(spans.map((span) => span.text)).toEqual([
      'Thanks for sending the revised contract over.',
      "We're happy to agree to net-60 payment terms.",
      'We can have the signed copy back to you by Friday.',
    ]);
    const points = draftPoints(body);
    expect(points.map((point) => point.kind)).toEqual(['draft', 'draft', 'draft']);
    for (const point of points) {
      expect(body.includes(point.quote)).toBe(true);
      expect(point.glance.length).toBeLessThanOrEqual(44);
    }
  });

  it('applies a saved edit and a deletion to the right sentences only', () => {
    const deck: Deck = {
      threadId: 'gmail:draft-1',
      sourceMessageId: 's',
      title: 'Draft',
      attention: 'report',
      headline: 'Draft',
      points: draftPoints(body),
      createdAt: new Date().toISOString(),
      splitter: 'sentences',
    };
    const draft: ReviewDraft = {
      threadId: 'gmail:draft-1',
      sourceMessageId: 's',
      notes: [
        { pointId: 'p2', verdict: 'note', text: 'Net-45, not net-60.', after: "We're happy to agree to net-45 payment terms." },
        { pointId: 'p3', verdict: 'note', text: 'delete', after: '' },
      ],
      seen: [],
      updatedAt: new Date().toISOString(),
    };
    const edited = applyDraftEdits(body, deck, draft);
    expect(edited.applied).toBe(2);
    expect(edited.deleted).toBe(1);
    expect(edited.text).toContain("We're happy to agree to net-45 payment terms.");
    expect(edited.text).not.toContain('net-60');
    expect(edited.text).not.toContain('signed copy back');
    expect(edited.text).toContain('Thanks for sending the revised contract over.');
  });

  it('derives the receipt name from a full name or an email', () => {
    expect(receiptName('Priya Shah')).toBe('Priya');
    expect(receiptName('priya.shah+acme@example.com')).toBe('Priya');
  });
});

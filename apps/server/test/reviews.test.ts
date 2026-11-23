import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewStore, mergeDraft } from '../src/core/reviews.js';

let dir: string;
let store: ReviewStore;

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinpoint-reviews-'));
  store = new ReviewStore(dir);
});

afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

describe('ReviewStore', () => {
  it('returns null before the first autosave', async () => {
    expect(await store.get('auth-refresh-fix')).toBeNull();
  });

  it('stores a merged draft and reads it from disk', async () => {
    const draft = mergeDraft(null, 'auth-refresh-fix', {
      sourceMessageId: 'msg-1',
      notes: [{ pointId: 'p4', verdict: 'object', text: 'Migrate sessions instead.' }],
      seen: ['p1', 'p4'],
    });
    await store.put(draft);

    const reopened = new ReviewStore(dir);
    const loaded = await reopened.get('auth-refresh-fix');
    expect(loaded?.notes).toHaveLength(1);
    expect(loaded?.notes[0].text).toBe('Migrate sessions instead.');
    expect(loaded?.seen.sort()).toEqual(['p1', 'p4']);
    expect(loaded?.sourceMessageId).toBe('msg-1');
  });

  it('keeps one note per point with the latest verdict', async () => {
    const first = mergeDraft(null, 'thread', {
      notes: [{ pointId: 'p1', verdict: 'note', text: 'First' }],
    });
    const second = mergeDraft(first, 'thread', {
      notes: [{ pointId: 'p1', verdict: 'object', text: 'Second' }],
    });
    expect(second.notes).toEqual([{ pointId: 'p1', verdict: 'object', text: 'Second' }]);
    expect(second.seen).toContain('p1');
  });

  it('clears a draft after sending', async () => {
    await store.put(
      mergeDraft(null, 'thread', {
        notes: [{ pointId: 'p1', verdict: 'note', text: 'Hello' }],
      }),
    );
    expect(await store.noteCount('thread')).toBe(1);
    await store.clear('thread');
    expect(await store.get('thread')).toBeNull();
    expect(await store.noteCount('thread')).toBe(0);
  });

  it('ignores malformed notes', async () => {
    const draft = mergeDraft(null, 'thread', {
      // @ts-expect-error deliberately invalid for the runtime guard
      notes: [{ pointId: 'p1', verdict: 'bogus', text: 'Nope' }],
    });
    expect(draft.notes).toHaveLength(0);
  });
});

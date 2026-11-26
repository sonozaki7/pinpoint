import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  Deck,
  EditResult,
  ReviewDraft,
  SendResult,
} from '../../../shared/contract.js';
import type {
  DraftConnector,
  DraftMessage,
  NoteHit,
  NotesConnector,
  ReviewConnector,
  ReviewPage,
  ReviewPageDetail,
} from '../src/connectors/types.js';
import { DeckStore } from '../src/core/decks.js';
import { loadDemoData } from '../src/core/demo.js';
import { readEnv } from '../src/core/env.js';
import { FakeTelegramNotifier, FakeT3Client } from '../src/core/fakes.js';
import { ReviewStore } from '../src/core/reviews.js';
import { PinpointService } from '../src/core/service.js';
import { createNaiveSplitter } from '../src/core/splitter/index.js';
import type { Splitter } from '../src/core/splitter/types.js';
import type { AttentionSource, AttentionThread } from '../src/core/types.js';
import { createApp } from '../src/http/app.js';
import { createSources } from '../src/sources/index.js';
import { GmailDraftSource } from '../src/sources/gmail.js';
import { NotionReviewSource } from '../src/sources/notion.js';
import type { VoiceTranscriber } from '../src/voice/service.js';

const stubVoice: VoiceTranscriber = {
  async transcribe() {
    return { text: 'No, change it', via: 't3' };
  },
};

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-sources-'));
}

function notionThread(id = 'page-1'): AttentionThread {
  return {
    threadId: `notion:${id}`,
    title: 'Launch post: Pinpoint 1.0 (draft)',
    project: 'Notion',
    attention: 'report',
    updatedAt: '2026-11-27T09:00:00.000Z',
    app: 'notion',
  };
}

const blocks = [
  { id: 'blk-1', text: 'Pinpoint turns long replies into points.' },
  { id: 'blk-2', text: 'Each point quotes the exact line it refers to.' },
  { id: 'blk-3', text: 'The launch starts with design partners.' },
  { id: 'blk-4', text: 'Available to every customer starting today.' },
];

function fakeNotion(options: { rejectBlockComment?: boolean } = {}) {
  const calls: {
    blockComments: { blockId: string; text: string }[];
    pageComments: { pageId: string; text: string }[];
    statuses: { pageId: string; status: string }[];
  } = { blockComments: [], pageComments: [], statuses: [] };
  const reviews: ReviewConnector = {
    async listReviewPages(): Promise<ReviewPage[]> {
      return [
        {
          id: 'page-1',
          url: 'https://www.notion.so/page-1',
          title: 'Launch post: Pinpoint 1.0 (draft)',
          updatedAt: '2026-11-27T09:00:00.000Z',
        },
      ];
    },
    async getReviewPage(pageId: string): Promise<ReviewPageDetail> {
      return {
        id: pageId,
        url: 'https://www.notion.so/page-1',
        title: 'Launch post: Pinpoint 1.0 (draft)',
        updatedAt: '2026-11-27T09:00:00.000Z',
        blocks: blocks.map((block) => ({ ...block })),
      };
    },
    async commentOnBlock(blockId, text) {
      if (options.rejectBlockComment) throw new Error('block comments are unsupported');
      calls.blockComments.push({ blockId, text });
    },
    async commentOnPage(pageId, text) {
      calls.pageComments.push({ pageId, text });
    },
    async setReviewStatus(pageId, status) {
      calls.statuses.push({ pageId, status });
    },
  };
  return { reviews, calls };
}

const splitter: Splitter = {
  label: 'test:notion',
  async split() {
    return {
      headline: 'Launch page: 4 claims',
      splitter: 'test:notion',
      points: blocks.map((block) => ({
        kind: 'claim',
        glance: block.text,
        quote: block.text,
      })),
    };
  },
};

async function notionDeck(source: AttentionSource): Promise<Deck> {
  const { buildDeck } = await import('../src/core/decks.js');
  return buildDeck(splitter, notionThread(), source);
}

function gmailDraft(): DraftMessage {
  return {
    id: 'draft-1',
    messageId: 'msg-1',
    threadId: 'thread-1',
    to: 'Priya Shah <priya@acme.example>',
    toName: 'Priya',
    subject: 'Re: Acme contract - net-45 terms',
    body:
      "Hi Priya,\n\nThanks for sending the revised contract over. We're happy to agree to net-60 payment terms. " +
      'We can have the signed copy back to you by Friday.\n\nBest,\nSam',
    updatedAt: '2026-11-27T09:12:00.000Z',
    link: 'https://mail.google.com/mail/u/0/#drafts/draft-1',
  };
}

function fakeGmail() {
  const calls: { updated: string[]; sent: number } = { updated: [], sent: 0 };
  const drafts: DraftConnector = {
    async listDrafts() {
      return [gmailDraft()];
    },
    async getDraft() {
      return gmailDraft();
    },
    async updateDraft(_id, body) {
      calls.updated.push(body);
      return { id: 'draft-1', link: gmailDraft().link };
    },
    async sendDraft() {
      calls.sent += 1;
      return {
        id: 'sent-1',
        threadId: 'thread-1',
        link: 'https://mail.google.com/mail/u/0/#all/thread-1',
      };
    },
  };
  const notes: NotesConnector = {
    async search(): Promise<NoteHit[]> {
      return [
        {
          id: 'note-acme',
          title: 'Acme contract',
          text: 'Acme contract: net-45 agreed with Priya on Nov 12; clause 12 to be narrowed',
          url: 'https://www.notion.so/acme',
        },
      ];
    },
    async createTask() {
      return { id: 'task', url: 'https://www.notion.so/task' };
    },
  };
  return { drafts, notes, calls };
}

describe('Notion review source', () => {
  it('anchors each point to the block containing its quote', async () => {
    const { reviews } = fakeNotion();
    const source = new NotionReviewSource({ notion: reviews });
    const threads = await source.listAttention();
    expect(threads[0]).toMatchObject({
      threadId: 'notion:page-1',
      app: 'notion',
      project: 'Notion',
    });

    const detail = await source.getSource('notion:page-1');
    expect(detail.source.text).toContain('Available to every customer starting today.');
    expect(detail.source.blocks?.map((block) => block.id)).toEqual([
      'blk-1',
      'blk-2',
      'blk-3',
      'blk-4',
    ]);

    const deck = await notionDeck(detail.source);
    expect(deck.points.map((point) => point.anchor)).toEqual([
      'blk-1',
      'blk-2',
      'blk-3',
      'blk-4',
    ]);
    expect(deck.points.find((point) => point.quote.includes('every customer'))?.flag).toBe(
      'check this',
    );
  });

  it('comments on the exact block and sets "Changes requested"', async () => {
    const { reviews, calls } = fakeNotion();
    const source = new NotionReviewSource({ notion: reviews });
    const detail = await source.getSource('notion:page-1');
    const deck = await notionDeck(detail.source);
    const point = deck.points.find((candidate) => candidate.quote.includes('every customer'))!;
    const draft: ReviewDraft = {
      threadId: 'notion:page-1',
      sourceMessageId: detail.source.sourceMessageId,
      notes: [
        {
          pointId: point.id,
          verdict: 'object',
          text: 'Say 10% today and everyone by Friday.',
        },
      ],
      seen: [],
      updatedAt: new Date().toISOString(),
    };

    const delivery = await source.deliver({
      thread: notionThread(),
      deck,
      draft,
      message: 'review',
      source: detail.source,
    });
    expect(calls.blockComments).toEqual([
      {
        blockId: 'blk-4',
        text: 'Change: Say 10% today and everyone by Friday. — via Pinpoint (G2)',
      },
    ]);
    expect(calls.statuses).toEqual([{ pageId: 'page-1', status: 'Changes requested' }]);
    expect(delivery.receipt?.lines.map((line) => line.text)).toEqual([
      '1 comment on Launch post',
      'Status: Changes requested',
    ]);
    expect(delivery.receipt?.lines.every((line) => line.ok)).toBe(true);
  });

  it('approves a page with no notes', async () => {
    const { reviews, calls } = fakeNotion();
    const source = new NotionReviewSource({ notion: reviews });
    const detail = await source.getSource('notion:page-1');
    const deck = await notionDeck(detail.source);
    const delivery = await source.deliver({
      thread: notionThread(),
      deck,
      draft: {
        threadId: 'notion:page-1',
        sourceMessageId: detail.source.sourceMessageId,
        notes: [],
        seen: [],
        updatedAt: new Date().toISOString(),
      },
      message: 'review',
      source: detail.source,
    });
    expect(calls.blockComments).toEqual([]);
    expect(calls.statuses).toEqual([{ pageId: 'page-1', status: 'Approved' }]);
    expect(delivery.receipt?.lines[0]?.text).toBe('0 comments on Launch post');
  });

  it('falls back to a page comment that quotes the sentence', async () => {
    const { reviews, calls } = fakeNotion({ rejectBlockComment: true });
    const source = new NotionReviewSource({ notion: reviews });
    const detail = await source.getSource('notion:page-1');
    const deck = await notionDeck(detail.source);
    const point = deck.points[3]!;
    const delivery = await source.deliver({
      thread: notionThread(),
      deck,
      draft: {
        threadId: 'notion:page-1',
        sourceMessageId: detail.source.sourceMessageId,
        notes: [{ pointId: point.id, verdict: 'note', text: 'Check the rollout.' }],
        seen: [],
        updatedAt: new Date().toISOString(),
      },
      message: 'review',
      source: detail.source,
    });
    expect(calls.pageComments).toHaveLength(1);
    expect(calls.pageComments[0]!.pageId).toBe('page-1');
    expect(calls.pageComments[0]!.text).toContain('"Available to every customer starting today."');
    expect(delivery.receipt?.lines[0]?.text).toBe('1 comment on Launch post');
  });
});

describe('Gmail draft source', () => {
  it('lists drafts under gmail: ids and flags a sentence the linked note contradicts', async () => {
    const { drafts, notes } = fakeGmail();
    const source = new GmailDraftSource({ drafts, notes });
    const threads = await source.listAttention();
    expect(threads[0]).toMatchObject({
      threadId: 'gmail:draft-1',
      app: 'gmail',
      project: 'Gmail',
    });

    const detail = await source.getSource('gmail:draft-1');
    const deck = await notionDeckForGmail(detail.source);
    expect(deck.points).toHaveLength(3);
    expect(deck.points.every((point) => point.kind === 'draft')).toBe(true);
    expect(deck.points.find((point) => point.quote.includes('net-60'))?.flag).toBe(
      'notes say net-45',
    );
  });

  it('edits one sentence, updates the draft and sends it', async () => {
    const { drafts, notes, calls } = fakeGmail();
    const source = new GmailDraftSource({ drafts, notes });
    const detail = await source.getSource('gmail:draft-1');
    const thread: AttentionThread = {
      threadId: 'gmail:draft-1',
      title: 'Draft reply to Priya: contract terms',
      project: 'Gmail',
      attention: 'report',
      updatedAt: '2026-11-27T09:12:00.000Z',
      app: 'gmail',
    };
    const deck = await notionDeckForGmail(detail.source);
    const point = deck.points.find((candidate) => candidate.quote.includes('net-60'))!;

    const edit = await source.edit({
      thread,
      point,
      before: point.quote,
      text: 'Net-45, not net-60.',
    });
    expect(edit).toEqual({
      ok: true,
      pointId: point.id,
      before: "We're happy to agree to net-60 payment terms.",
      after: "We're happy to agree to net-45 payment terms.",
      method: 'replace',
    });

    const draft: ReviewDraft = {
      threadId: thread.threadId,
      sourceMessageId: detail.source.sourceMessageId,
      notes: [
        {
          pointId: point.id,
          verdict: 'note',
          text: 'Net-45, not net-60.',
          after: edit.after,
        },
      ],
      seen: [],
      updatedAt: new Date().toISOString(),
    };
    const delivery = await source.deliver({
      thread,
      deck,
      draft,
      message: 'review',
      source: detail.source,
    });
    expect(calls.updated).toHaveLength(1);
    expect(calls.updated[0]).toContain("We're happy to agree to net-45 payment terms.");
    expect(calls.updated[0]).not.toContain('net-60');
    expect(calls.sent).toBe(1);
    expect(delivery.delivered).toBe('gmail');
    expect(delivery.receipt?.lines[0]).toMatchObject({
      app: 'gmail',
      text: 'Sent to Priya',
      ok: true,
      link: 'https://mail.google.com/mail/u/0/#all/thread-1',
    });
  });

  it('returns the glasses failure message for an unknown note without an LLM', async () => {
    const { drafts } = fakeGmail();
    const source = new GmailDraftSource({ drafts });
    const detail = await source.getSource('gmail:draft-1');
    const deck = await notionDeckForGmail(detail.source);
    const point = deck.points[0]!;
    const edit = await source.edit({
      thread: {
        threadId: 'gmail:draft-1',
        title: 'Draft',
        project: 'Gmail',
        attention: 'report',
        updatedAt: new Date().toISOString(),
        app: 'gmail',
      },
      point,
      before: point.quote,
      text: 'Make this friendlier.',
    });
    expect(edit).toMatchObject({ ok: false, error: "Couldn't change this line" });
  });
});

async function notionDeckForGmail(source: AttentionSource): Promise<Deck> {
  const { buildDeck } = await import('../src/core/decks.js');
  return buildDeck(createNaiveSplitter(), {
    threadId: 'gmail:draft-1',
    title: 'Draft reply to Priya: contract terms',
    project: 'Gmail',
    attention: 'report',
    updatedAt: new Date().toISOString(),
    app: 'gmail',
  }, source);
}

describe('source merging', () => {
  it('uses notion:/gmail: ids in live mode for configured sources', async () => {
    const dir = tempDir();
    try {
      const env = readEnv({
        PINPOINT_MODE: 'live',
        T3_PROJECTS: 'pinpoint',
        PINPOINT_DATA_DIR: dir,
        NOTION_TOKEN: 'test-token',
        NOTION_REVIEW_DB: 'db-1',
      });
      const { reviews } = fakeNotion();
      const { drafts, notes } = fakeGmail();
      const { sources } = createSources(env, new FakeT3Client([]), {
        connectors: { reviews, drafts, notes },
      });
      expect(sources.map((source) => source.app)).toEqual(['t3', 'notion', 'gmail']);

      const notion = sources.find((source) => source.app === 'notion')!;
      expect((await notion.listAttention())[0]?.threadId).toBe('notion:page-1');
      const gmail = sources.find((source) => source.app === 'gmail')!;
      expect((await gmail.listAttention())[0]?.threadId).toBe('gmail:draft-1');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges T3, Notion and Gmail items in one inbox and sends the right receipt', async () => {
    const dir = tempDir();
    let service: PinpointService | null = null;
    try {
      const env = readEnv({
        PINPOINT_MODE: 'demo',
        SPLITTER_PROVIDER: 'fixture',
        PINPOINT_DATA_DIR: dir,
      });
      const demo = loadDemoData(env.fixturesDir);
      const t3 = new FakeT3Client(demo.fixtures);
      const { sources } = createSources(env, t3, { demo: true });
      service = new PinpointService({
        env,
        t3,
        t3Live: false,
        telegram: new FakeTelegramNotifier(),
        splitter: createNaiveSplitter(),
        decks: new DeckStore(dir),
        reviews: new ReviewStore(dir),
        voice: stubVoice,
        precomputed: demo.precomputed,
        sources,
      });
      await service.start();
      await service.preload();

      const inbox = await service.listInbox();
      const byId = new Map(inbox.items.map((item) => [item.threadId, item]));
      expect(byId.get('auth-refresh-fix')?.app).toBe('t3');
      expect(byId.get('launch-post')?.app).toBe('notion');
      expect(byId.get('draft-priya')?.app).toBe('gmail');
      expect(byId.get('draft-priya')?.summary).toBe('draft, 6 lines');

      const draftDeck = await service.getDeckHttp('draft-priya');
      expect(draftDeck.status).toBe('ready');
      if (draftDeck.status !== 'ready') throw new Error('deck missing');
      expect(draftDeck.deck.points).toHaveLength(6);

      const app = createApp({ service });
      const editResponse = await app.request('/api/edit/draft-priya', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pointId: 'p2', text: 'Net-45, not net-60.' }),
      });
      expect(editResponse.status).toBe(200);
      expect(await editResponse.json()).toMatchObject({
        ok: true,
        after: "We're happy to agree to net-45 payment terms.",
      });

      const pageEdit = await app.request('/api/edit/launch-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pointId: 'p4', text: 'Say 10% today.' }),
      });
      expect(await pageEdit.json()).toMatchObject({
        ok: false,
        error: "This item can't be edited here",
      });

      const saved = await service.getDraft('draft-priya');
      expect(saved.notes.find((note) => note.pointId === 'p2')?.after).toBe(
        "We're happy to agree to net-45 payment terms.",
      );

      const sent: SendResult = await service.send('draft-priya');
      expect(sent).toMatchObject({ ok: true, delivered: 'demo-log' });
      expect(sent.receipt?.lines[0]).toMatchObject({
        app: 'gmail',
        text: 'Sent to Priya',
        ok: true,
      });

      const notion = await service.putDraft('launch-post', {
        notes: [{ pointId: 'p4', verdict: 'object', text: 'Not everyone today.' }],
      });
      expect(notion.notes).toHaveLength(1);
      const pageSend = await service.send('launch-post');
      expect(pageSend.receipt?.lines.map((line) => line.text)).toEqual([
        '1 comment on Launch post',
        'Status: Changes requested',
      ]);
      // Demo fixtures stay in the inbox (there is no real page to change status
      // on); the receipt is what proves the notes landed.
      expect(pageSend.ok).toBe(true);
    } finally {
      await service?.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

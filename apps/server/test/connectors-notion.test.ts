import { describe, expect, it } from 'vitest';
import { NotionConnector, NOTION_API_VERSION } from '../src/connectors/notion.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const taskSchema = {
  object: 'data_source',
  id: 'ds-1',
  properties: {
    Name: { id: 'title', name: 'Name', type: 'title', title: {} },
    'Due date': { id: 'date1', name: 'Due date', type: 'date', date: {} },
    Status: { id: 'status1', name: 'Status', type: 'status', status: {} },
  },
};

describe('NotionConnector.search', () => {
  it('flattens page blocks to plain text and prefers the notes root', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.endsWith('/search')) {
        return jsonResponse({
          results: [
            {
              object: 'page',
              id: 'page-other',
              url: 'https://www.notion.so/page-other',
              parent: { type: 'workspace', workspace: true },
              properties: {
                Name: { type: 'title', title: [{ plain_text: 'Random notes' }] },
              },
            },
            {
              object: 'page',
              id: 'page-acme',
              url: 'https://www.notion.so/page-acme',
              parent: { type: 'page_id', page_id: 'notes-root' },
              properties: {
                Name: { type: 'title', title: [{ plain_text: 'Acme contract' }] },
              },
            },
            { object: 'data_source', id: 'ds-x', properties: {} },
          ],
        });
      }
      if (url.includes('/blocks/page-acme/children')) {
        return jsonResponse({
          results: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'net-45 agreed' }] },
            },
            {
              object: 'block',
              type: 'heading_2',
              heading_2: { rich_text: [{ plain_text: 'Clause 12' }] },
            },
            {
              object: 'block',
              type: 'child_page',
              child_page: { title: 'Reseller scope' },
            },
          ],
          has_more: false,
        });
      }
      if (url.includes('/blocks/page-other/children')) {
        return jsonResponse({ results: [], has_more: false });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const notion = new NotionConnector({
      token: 'secret-token',
      notesRoot: 'notes-root',
      fetchImpl,
    });
    const hits = await notion.search('Acme', 5);

    expect(hits).toHaveLength(2);
    expect(hits[0].id).toBe('page-acme');
    expect(hits[0].title).toBe('Acme contract');
    expect(hits[0].text).toContain('net-45 agreed');
    expect(hits[0].text).toContain('Clause 12');
    expect(hits[0].text).toContain('Reseller scope');
    expect(hits[1].title).toBe('Random notes');

    const searchCall = calls.find((call) => call.url.endsWith('/search'));
    expect(searchCall?.body).toMatchObject({
      query: 'Acme',
      filter: { property: 'object', value: 'page' },
    });
  });

  it('caps note text at 4,000 characters', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/search')) {
        return jsonResponse({
          results: [
            {
              object: 'page',
              id: 'long-page',
              url: 'https://www.notion.so/long',
              parent: { type: 'page_id', page_id: 'root' },
              properties: { Name: { type: 'title', title: [{ plain_text: 'Long' }] } },
            },
          ],
        });
      }
      if (url.includes('/blocks/long-page/children')) {
        return jsonResponse({
          results: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'x'.repeat(5_000) }] },
            },
          ],
          has_more: false,
        });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const notion = new NotionConnector({ token: 'secret-token', fetchImpl });
    const hits = await notion.search('Long', 1);
    expect(hits[0].text.length).toBeLessThanOrEqual(4_000);
  });
});

describe('NotionConnector review pages', () => {
  const reviewSchema = {
    object: 'data_source',
    id: 'ds-docs',
    properties: {
      Name: { id: 'title', name: 'Name', type: 'title', title: {} },
      Status: { id: 'status1', name: 'Status', type: 'status', status: {} },
    },
  };

  function reviewFetch(options?: { select?: boolean }) {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.endsWith('/databases/db-docs')) {
        return jsonResponse({
          object: 'database',
          id: 'db-docs',
          data_sources: [{ id: 'ds-docs', name: 'Docs' }],
        });
      }
      if (url.endsWith('/data_sources/ds-docs') && (!init?.method || init.method === 'GET')) {
        return jsonResponse({
          ...reviewSchema,
          properties: options?.select
            ? {
                Name: reviewSchema.properties.Name,
                Status: { id: 'select1', name: 'Status', type: 'select', select: {} },
              }
            : reviewSchema.properties,
        });
      }
      if (url.endsWith('/data_sources/ds-docs/query')) {
        return jsonResponse({
          results: [
            {
              object: 'page',
              id: 'page-1',
              url: 'https://www.notion.so/page-1',
              last_edited_time: '2026-11-27T09:00:00.000Z',
              properties: {
                Name: { type: 'title', title: [{ plain_text: 'Launch post: Pinpoint 1.0 (draft)' }] },
                Status: { type: 'status', status: { name: 'Needs review' } },
              },
            },
            {
              object: 'page',
              id: 'page-trash',
              in_trash: true,
              properties: { Name: { type: 'title', title: [{ plain_text: 'Old' }] } },
            },
          ],
        });
      }
      if (url.endsWith('/pages/page-1') && (!init?.method || init.method === 'GET')) {
        return jsonResponse({
          object: 'page',
          id: 'page-1',
          url: 'https://www.notion.so/page-1',
          last_edited_time: '2026-11-27T09:00:00.000Z',
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'Launch post: Pinpoint 1.0 (draft)' }] },
          },
        });
      }
      if (url.includes('/blocks/page-1/children')) {
        return jsonResponse({
          results: [
            {
              object: 'block',
              id: 'blk-1',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'First line.' }] },
            },
            {
              object: 'block',
              id: 'blk-2',
              type: 'heading_2',
              has_children: true,
              heading_2: { rich_text: [{ plain_text: 'A heading.' }] },
            },
          ],
          has_more: false,
        });
      }
      if (url.includes('/blocks/blk-2/children')) {
        return jsonResponse({
          results: [
            {
              object: 'block',
              id: 'blk-3',
              type: 'bulleted_list_item',
              bulleted_list_item: { rich_text: [{ plain_text: 'Nested line.' }] },
            },
          ],
          has_more: false,
        });
      }
      if (url.endsWith('/comments')) return jsonResponse({ object: 'comment', id: 'c1' });
      if (url.endsWith('/pages/page-1') && init?.method === 'PATCH') {
        return jsonResponse({ object: 'page', id: 'page-1' });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it('queries the status property and returns only live pages', async () => {
    const { calls, fetchImpl } = reviewFetch();
    const notion = new NotionConnector({
      token: 'secret-token',
      reviewDb: 'db-docs',
      fetchImpl,
    });
    const pages = await notion.listReviewPages();
    expect(pages).toEqual([
      {
        id: 'page-1',
        url: 'https://www.notion.so/page-1',
        title: 'Launch post: Pinpoint 1.0 (draft)',
        updatedAt: '2026-11-27T09:00:00.000Z',
      },
    ]);
    const query = calls.find((call) => call.url.endsWith('/query'));
    expect(query?.body).toMatchObject({
      filter: { property: 'Status', status: { equals: 'Needs review' } },
      page_size: 25,
    });
  });

  it('reads the page blocks with ids, including nested blocks', async () => {
    const { fetchImpl } = reviewFetch();
    const notion = new NotionConnector({ token: 'secret-token', fetchImpl });
    const page = await notion.getReviewPage('page-1');
    expect(page.blocks).toEqual([
      { id: 'blk-1', text: 'First line.' },
      { id: 'blk-2', text: 'A heading.' },
      { id: 'blk-3', text: 'Nested line.' },
    ]);
  });

  it('comments on a block, falls back to the page, and sets the status', async () => {
    const { calls, fetchImpl } = reviewFetch();
    const notion = new NotionConnector({ token: 'secret-token', reviewDb: 'db-docs', fetchImpl });
    await notion.commentOnBlock('blk-1', 'Change: Use 10% today. — via Pinpoint (G2)');
    await notion.commentOnPage('page-1', '"First line." — Change: Use 10% today.');
    await notion.setReviewStatus('page-1', 'Changes requested');

    const comments = calls.filter((call) => call.url.endsWith('/comments'));
    expect(comments).toHaveLength(2);
    expect(comments[0]!.body).toMatchObject({
      parent: { block_id: 'blk-1' },
      rich_text: [{ type: 'text', text: { content: 'Change: Use 10% today. — via Pinpoint (G2)' } }],
    });
    expect(comments[1]!.body).toMatchObject({ parent: { page_id: 'page-1' } });

    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      properties: { Status: { status: { name: 'Changes requested' } } },
    });
  });

  it('uses a select property when the database has one', async () => {
    const { calls, fetchImpl } = reviewFetch({ select: true });
    const notion = new NotionConnector({ token: 'secret-token', reviewDb: 'db-docs', fetchImpl });
    await notion.setReviewStatus('page-1', 'Approved');
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      properties: { Status: { select: { name: 'Approved' } } },
    });
  });
});

describe('NotionConnector.createTask', () => {
  it('discovers the data source and maps title/date/details to the schema', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.endsWith('/databases/db-1')) {
        return jsonResponse({
          object: 'database',
          id: 'db-1',
          data_sources: [{ id: 'ds-1', name: 'Tasks' }],
        });
      }
      if (url.endsWith('/data_sources/ds-1')) return jsonResponse(taskSchema);
      if (url.endsWith('/pages') && init?.method === 'POST') {
        return jsonResponse({
          object: 'page',
          id: 'task-page-1',
          url: 'https://www.notion.so/task-page-1',
        });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const notion = new NotionConnector({
      token: 'secret-token',
      tasksDb: 'db-1',
      fetchImpl,
    });
    const task = await notion.createTask({
      title: 'Send revised Acme draft',
      due: '2026-12-04',
      details: 'Narrow clause 12 to reseller scope\nShare with Priya',
      sourceUrl: 'https://mail.google.com/mail/u/0/#all/t1',
    });

    expect(task).toEqual({
      id: 'task-page-1',
      url: 'https://www.notion.so/task-page-1',
    });

    const create = calls.find((call) => call.url.endsWith('/pages'));
    expect(create).toBeDefined();
    const body = create!.body as {
      parent: { type: string; data_source_id: string };
      properties: Record<string, unknown>;
      children: Array<{ paragraph: { rich_text: Array<{ text: { content: string } }> } }>;
    };
    expect(body.parent).toEqual({ type: 'data_source_id', data_source_id: 'ds-1' });
    expect(body.properties).toMatchObject({
      Name: { title: [{ type: 'text', text: { content: 'Send revised Acme draft' } }] },
      'Due date': { date: { start: '2026-12-04' } },
    });
    expect(body.children).toHaveLength(3);
    expect(body.children[0].paragraph.rich_text[0].text.content).toBe(
      'Narrow clause 12 to reseller scope',
    );
    expect(body.children[1].paragraph.rich_text[0].text.content).toBe('Share with Priya');
    expect(body.children[2].paragraph.rich_text[0].text.content).toContain('/#all/t1');

    for (const call of calls) {
      expect(call.headers.authorization).toBe('Bearer secret-token');
      expect(call.headers['notion-version']).toBe(NOTION_API_VERSION);
    }
    expect(NOTION_API_VERSION).toBe('2026-03-11');
  });

  it('accepts a data source id directly when the database lookup fails', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/databases/ds-direct')) {
        return jsonResponse({ object: 'error', status: 404, code: 'object_not_found' }, 404);
      }
      if (url.endsWith('/data_sources/ds-direct')) {
        return jsonResponse({ object: 'data_source', id: 'ds-direct', properties: taskSchema.properties });
      }
      if (url.endsWith('/pages') && init?.method === 'POST') {
        return jsonResponse({ object: 'page', id: 'p9', url: 'https://www.notion.so/p9' });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const notion = new NotionConnector({
      token: 'secret-token',
      tasksDb: 'ds-direct',
      fetchImpl,
    });
    const task = await notion.createTask({ title: 'No due date' });
    expect(task.id).toBe('p9');
    expect(calls.some((url) => url.endsWith('/data_sources/ds-direct'))).toBe(true);
  });
});

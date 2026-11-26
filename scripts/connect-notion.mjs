#!/usr/bin/env node
// Prepare the Notion demo workspace. Finds or creates, under NOTION_NOTES_ROOT:
//   - a "Pinpoint demo" page
//   - a "Tasks" database (Name, Due date, Status)
//   - an "Acme contract" note
// Prints only the ids to put in apps/server/.env. Never prints the token or
// page contents.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(SCRIPT_DIR, '..', 'apps', 'server');
const ENV_FILE = path.join(SERVER_ROOT, '.env');
const NOTION_VERSION = '2026-03-11';
const API = 'https://api.notion.com/v1';

const NOTE_TEXT =
  'Acme contract: net-45 agreed with Priya on Nov 12; clause 12 to be narrowed';

try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // No .env yet: the steps below explain how to create it.
}

const token = (process.env.NOTION_TOKEN ?? '').trim();
const rootValue = (process.env.NOTION_NOTES_ROOT ?? '').trim();

function notionId(value) {
  const raw = String(value ?? '').trim();
  const hex = raw.replace(/-/g, '').match(/[0-9a-f]{32}/i);
  if (!hex) return '';
  const id = hex[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function setupSteps() {
  console.log(`Notion setup for Pinpoint (about 3 minutes)

1. Open https://www.notion.so/my-integrations -> "New integration".
   Name it "Pinpoint", pick your workspace, enable Read and Insert content,
   and copy the Internal Integration Secret (starts with ntn_).
2. In Notion, create or choose a page (for example "Pinpoint").
   Open it -> "..." menu -> Connections -> add your Pinpoint integration.
3. Copy that page's link. Put both values in ${ENV_FILE}:
   NOTION_TOKEN=ntn_...
   NOTION_NOTES_ROOT=<the page link or id>
4. Run this script again:
   node scripts/connect-notion.mjs`);
}

async function main() {
  if (!token) {
    console.error('NOTION_TOKEN is not set.\n');
    setupSteps();
    process.exitCode = 1;
    return;
  }
  const rootId = notionId(rootValue);
  if (!rootId) {
    console.error('NOTION_NOTES_ROOT is not set to a page link or id.\n');
    setupSteps();
    process.exitCode = 1;
    return;
  }

  const root = await notion('GET', `/pages/${rootId}`);
  const rootTitle = pageTitle(root);
  let demoId = rootTitle.toLowerCase() === 'pinpoint demo' ? rootId : '';

  if (!demoId) {
    const children = await listChildren(rootId);
    const existing = children.find(
      (block) =>
        block.type === 'child_page' &&
        String(block.child_page?.title ?? '').trim().toLowerCase() === 'pinpoint demo',
    );
    if (existing) {
      demoId = existing.id;
    } else {
      const created = await notion('POST', '/pages', {
        parent: { type: 'page_id', page_id: rootId },
        properties: {
          title: { title: [{ type: 'text', text: { content: 'Pinpoint demo' } }] },
        },
      });
      demoId = created.id;
      console.log('Created page: Pinpoint demo');
    }
  }
  if (!demoId) throw new Error('Could not find or create the Pinpoint demo page.');

  const demoChildren = await listChildren(demoId);
  let tasksId = demoChildren.find(
    (block) =>
      block.type === 'child_database' &&
      String(block.child_database?.title ?? '').trim().toLowerCase() === 'tasks',
  )?.id;

  if (!tasksId) {
    const database = await notion('POST', '/databases', {
      parent: { type: 'page_id', page_id: demoId },
      title: [{ type: 'text', text: { content: 'Tasks' } }],
      initial_data_source: {
        properties: {
          Name: { title: {} },
          'Due date': { date: {} },
          Status: {
            status: {
              options: [
                { name: 'To do', color: 'red' },
                { name: 'In progress', color: 'yellow' },
                { name: 'Done', color: 'green' },
              ],
            },
          },
        },
      },
    });
    tasksId = database.id;
    console.log('Created database: Tasks');
  }
  if (!tasksId) throw new Error('Could not find or create the Tasks database.');

  const note = demoChildren.find(
    (block) =>
      block.type === 'child_page' &&
      String(block.child_page?.title ?? '').trim().toLowerCase() === 'acme contract',
  );
  if (!note) {
    await notion('POST', '/pages', {
      parent: { type: 'page_id', page_id: demoId },
      properties: {
        title: { title: [{ type: 'text', text: { content: 'Acme contract' } }] },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: NOTE_TEXT } }],
          },
        },
      ],
    });
    console.log('Created note: Acme contract');
  }

  console.log(`\nDone. Add these lines to ${ENV_FILE}:\n`);
  console.log(`NOTION_TASKS_DB=${tasksId}`);
  console.log(`NOTION_NOTES_ROOT=${demoId}`);
  console.log('\nThen run: node scripts/seed-demo.mjs');
}

async function listChildren(blockId) {
  const blocks = [];
  let cursor;
  let page = 0;
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    const listing = await notion(
      'GET',
      `/blocks/${encodeURIComponent(blockId)}/children?${query.toString()}`,
    );
    blocks.push(...(Array.isArray(listing.results) ? listing.results : []));
    cursor = listing.has_more && listing.next_cursor ? listing.next_cursor : undefined;
    page += 1;
  } while (cursor && page < 5);
  return blocks;
}

async function notion(method, apiPath, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  let lastStatus = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetch(`${API}${apiPath}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'notion-version': NOTION_VERSION,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: payload,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'network error';
      throw new Error(`Notion could not be reached (${name}).`);
    }

    lastStatus = response.status;
    const text = await response.text();

    if ((response.status === 429 || response.status === 529 || response.status >= 500) && attempt === 0) {
      const retry = Number(response.headers.get('retry-after'));
      await new Promise((resolve) =>
        setTimeout(resolve, Number.isFinite(retry) ? Math.min(3000, retry * 1000) : 700),
      );
      continue;
    }

    if (!response.ok) {
      let code = '';
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.code === 'string') code = parsed.code;
      } catch {
        // Ignore non-JSON error pages.
      }
      if (response.status === 404) {
        throw new Error(
          'Notion could not find the page. Share it with the integration: page "..." menu -> Connections.',
        );
      }
      if (response.status === 403) {
        throw new Error(
          'The Notion integration is missing Read or Insert content capability. Edit the integration and try again.',
        );
      }
      throw new Error(`Notion returned HTTP ${response.status}${code ? ` (${code})` : ''}.`);
    }

    return text.trim() === '' ? {} : JSON.parse(text);
  }

  throw new Error(`Notion returned HTTP ${lastStatus}.`);
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property?.type !== 'title') continue;
    return (property.title ?? []).map((item) => item.plain_text ?? '').join('').trim();
  }
  return '';
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Notion setup failed.');
  process.exitCode = 1;
});

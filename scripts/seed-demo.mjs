#!/usr/bin/env node
// Idempotent demo data for the Pinpoint desk. It only touches the "pinpoint"
// Gmail label and the shared "Pinpoint demo" Notion page:
//   - Priya's email and the agent's draft reply (with the net-60 mistake)
//   - a "Docs" database with the launch-post page waiting for review
//   - an "Acme contract" note that records the net-45 terms
// It never sends, deletes or prints bodies, tokens or addresses.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(SCRIPT_DIR, '..', 'apps', 'server');
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ENV_FILE = path.join(SERVER_ROOT, '.env');
const NOTION_VERSION = '2026-03-11';
const NOTE_TEXT =
  'Acme contract: net-45 agreed with Priya on Nov 12; clause 12 to be narrowed';
const STATUS_OPTIONS = ['Needs review', 'Changes requested', 'Approved'];

const PRIYA_BODY =
  'Hi,\n\n' +
  'Thanks for the call on Nov 12. We agreed net-45 on the Acme contract, but ' +
  'clause 12 is still too broad. Can you narrow it to the reseller scope and ' +
  'send the revised draft before Friday?\n\n' +
  'Best,\nPriya';

// The agent's draft reply, deliberately wrong on the payment terms.
const DRAFT_BODY =
  'Hi Priya,\n\n' +
  'Thanks for sending the revised contract over. We\'re happy to agree to net-60 payment terms. ' +
  'Our finance team can start invoicing from Monday once the countersigned copy is back. ' +
  'I\'ll also ask legal to narrow clause 12 to the reseller scope. ' +
  'The delivery date in clause 9 works for us as written. ' +
  'We can have the signed copy back to you by Friday.\n\n' +
  'Best,\nSam';

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // Optional: env may come from the shell.
}

const dataDir = path.resolve(flag('--data-dir') ?? path.join(SERVER_ROOT, '.data'));
const clientPath = path.join(dataDir, 'google-client.json');
const tokenPath = path.join(dataDir, 'google-token.json');

let googleToken = null;
let googleClient = null;
let googleReady = false;
let notionReady = false;
let failures = 0;

async function main() {
  console.log('Pinpoint demo seed');

  loadGoogle();
  if (googleReady) {
    await section('Gmail', seedGmail);
  } else {
    console.log('Gmail: skipped (run "node scripts/connect-google.mjs" first)');
  }

  loadNotion();
  if (notionReady) {
    await section('Notion', seedNotion);
  } else {
    console.log('Notion: skipped (run "node scripts/connect-notion.mjs" first)');
  }

  if (!googleReady && !notionReady) {
    failures += 1;
    console.log('\nNothing was configured. Connect Google and/or Notion first.');
  } else {
    console.log('\nDone.');
  }
  if (failures > 0) process.exitCode = 1;
}

async function section(name, run) {
  try {
    await run();
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : 'failed';
    console.log(`${name}: ${message}`);
  }
}

function loadGoogle() {
  try {
    const clientRaw = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
    googleClient = clientRaw.installed ?? clientRaw.web;
    googleToken = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    googleReady = Boolean(googleClient?.client_id && googleClient?.client_secret && googleToken);
  } catch {
    googleReady = false;
  }
}

function loadNotion() {
  notionReady = Boolean(
    (process.env.NOTION_TOKEN ?? '').trim() && (process.env.NOTION_NOTES_ROOT ?? '').trim(),
  );
}

async function seedGmail() {
  const profile = await google('/gmail/v1/users/me/profile');
  const account = String(profile.emailAddress ?? '');
  if (!account.includes('@')) throw new Error('could not read the connected account');

  const labels = await google('/gmail/v1/users/me/labels');
  let label = (labels.labels ?? []).find(
    (entry) => String(entry.name ?? '').toLowerCase() === 'pinpoint',
  );
  if (!label) {
    label = await google('/gmail/v1/users/me/labels', {
      method: 'POST',
      body: {
        name: 'pinpoint',
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
  }
  if (!label?.id) throw new Error('could not create the pinpoint label');

  const priyaAddress = plusAddress(account, 'priya');

  // 1. Priya's email (only if the label has none yet).
  const foundMessages = await google(
    `/gmail/v1/users/me/messages?q=${encodeURIComponent('label:pinpoint subject:"Acme contract"')}&maxResults=1`,
  );
  let threadId = '';
  let emailCreated = 0;
  if (Array.isArray(foundMessages.messages) && foundMessages.messages.length > 0) {
    threadId = String(foundMessages.messages[0].threadId ?? '');
  } else {
    const raw = [
      `From: "Priya Shah" <${priyaAddress}>`,
      `To: ${account}`,
      'Subject: Acme contract - net-45 terms',
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <pinpoint-priya-${Date.now()}@pinpoint.local>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      PRIYA_BODY,
    ].join('\r\n');
    const inserted = await google('/gmail/v1/users/me/messages', {
      method: 'POST',
      body: {
        raw: Buffer.from(raw, 'utf8').toString('base64url'),
        labelIds: [label.id, 'INBOX'],
      },
    });
    threadId = String(inserted.threadId ?? '');
    emailCreated = 1;
  }

  // 2. The agent's draft reply, in the same thread, labelled pinpoint.
  const foundDrafts = await google(
    `/gmail/v1/users/me/drafts?q=${encodeURIComponent('label:pinpoint subject:"Acme contract"')}&maxResults=5`,
  );
  let draftCreated = 0;
  if (!Array.isArray(foundDrafts.drafts) || foundDrafts.drafts.length === 0) {
    const raw = [
      `To: "Priya Shah" <${priyaAddress}>`,
      'Subject: Re: Acme contract - net-45 terms',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      DRAFT_BODY,
    ].join('\r\n');
    const draft = await google('/gmail/v1/users/me/drafts', {
      method: 'POST',
      body: {
        message: {
          raw: Buffer.from(raw, 'utf8').toString('base64url'),
          ...(threadId ? { threadId } : {}),
        },
      },
    });
    const messageId = draft?.message?.id;
    if (messageId) {
      try {
        await google(`/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`, {
          method: 'POST',
          body: { addLabelIds: [label.id] },
        });
      } catch {
        // The draft exists; a missing label only hides it from the query.
      }
    }
    draftCreated = 1;
  }

  console.log(
    `Gmail: Priya thread ${emailCreated ? 'created' : 'already there'}, ` +
      `agent draft ${draftCreated ? 'created' : 'already there'} in label "pinpoint"`,
  );
}

async function seedNotion() {
  const token = process.env.NOTION_TOKEN.trim();
  const rootId = notionId(process.env.NOTION_NOTES_ROOT);
  if (!rootId) throw new Error('NOTION_NOTES_ROOT is not a page link or id');

  const root = await notion(token, 'GET', `/pages/${rootId}`);
  let demoId = pageTitle(root).toLowerCase() === 'pinpoint demo' ? rootId : '';
  if (!demoId) {
    const children = await notionChildren(token, rootId);
    demoId =
      children.find(
        (block) =>
          block.type === 'child_page' &&
          String(block.child_page?.title ?? '').trim().toLowerCase() === 'pinpoint demo',
      )?.id ?? '';
  }
  if (!demoId) throw new Error('Pinpoint demo page not found; run "node scripts/connect-notion.mjs" first');

  const demoChildren = await notionChildren(token, demoId);

  // Acme contract note (evidence for the net-45 flag).
  const note = demoChildren.find(
    (block) =>
      block.type === 'child_page' &&
      String(block.child_page?.title ?? '').trim().toLowerCase() === 'acme contract',
  );
  if (!note) {
    await notion(token, 'POST', '/pages', {
      parent: { type: 'page_id', page_id: demoId },
      properties: {
        title: { title: [{ type: 'text', text: { content: 'Acme contract' } }] },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: NOTE_TEXT } }] },
        },
      ],
    });
  }

  // Docs database: Name + Status (Needs review / Changes requested / Approved).
  let docsId = demoChildren.find(
    (block) =>
      block.type === 'child_database' &&
      String(block.child_database?.title ?? '').trim().toLowerCase() === 'docs',
  )?.id;
  if (!docsId) {
    const database = await notion(token, 'POST', '/databases', {
      parent: { type: 'page_id', page_id: demoId },
      title: [{ type: 'text', text: { content: 'Docs' } }],
      initial_data_source: {
        properties: {
          Name: { title: {} },
          Status: {
            status: {
              options: STATUS_OPTIONS.map((name, index) => ({
                name,
                color: ['yellow', 'red', 'green'][index] ?? 'default',
              })),
            },
          },
        },
      },
    });
    docsId = database.id;
  }
  if (!docsId) throw new Error('could not find or create the Docs database');

  const schema = await docsSchema(token, docsId);
  const launchText = launchBlocks();
  const existing = await notion(token, 'POST', `/data_sources/${encodeURIComponent(schema.dataSourceId)}/query`, {
    filter: {
      property: schema.titleProperty,
      title: { contains: 'Launch post' },
    },
    page_size: 5,
  });
  const page = Array.isArray(existing.results) ? existing.results[0] : undefined;
  let pageState = 'already there';
  if (!page?.id) {
    await notion(token, 'POST', '/pages', {
      parent: { type: 'data_source_id', data_source_id: schema.dataSourceId },
      properties: {
        [schema.titleProperty]: {
          title: [{ type: 'text', text: { content: 'Launch post: Pinpoint 1.0 (draft)' } }],
        },
        [schema.statusProperty]:
          schema.statusType === 'status'
            ? { status: { name: 'Needs review' } }
            : { select: { name: 'Needs review' } },
      },
      children: launchText.map((line) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
      })),
    });
    pageState = 'created';
  } else if (page.id) {
    // Keep the demo repeatable after a live round trip.
    try {
      await notion(token, 'PATCH', `/pages/${encodeURIComponent(page.id)}`, {
        properties: {
          [schema.statusProperty]:
            schema.statusType === 'status'
              ? { status: { name: 'Needs review' } }
              : { select: { name: 'Needs review' } },
        },
      });
      pageState = 'already there, status reset to Needs review';
    } catch {
      pageState = 'already there';
    }
  }

  console.log(`Notion: Acme note ${note ? 'already there' : 'created'}; launch page ${pageState}`);
}

/** Paragraphs copied from the launch-post fixture, so seeded pages match the deck. */
function launchBlocks() {
  try {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'demo', 'fixtures', 'launch-post.json'), 'utf8'),
    );
    const blocks = fixture?.source?.blocks;
    if (Array.isArray(blocks)) {
      return blocks
        .map((block) => (typeof block?.text === 'string' ? block.text : ''))
        .filter((line) => line.length > 0);
    }
  } catch {
    // Fall through to the short built-in copy.
  }
  return [
    'Pinpoint turns long AI replies into a short list of points you can settle from your glasses.',
    'Available to every customer starting today.',
  ];
}

async function docsSchema(token, docsId) {
  const database = await notion(token, 'GET', `/databases/${encodeURIComponent(docsId)}`);
  const sources = Array.isArray(database.data_sources) ? database.data_sources : [];
  const source = sources.find((entry) => String(entry.name ?? '').toLowerCase() === 'docs') ?? sources[0];
  const dataSourceId = source?.id ?? docsId;
  const dataSource = await notion(token, 'GET', `/data_sources/${encodeURIComponent(dataSourceId)}`);
  const properties = dataSource.properties ?? {};
  const titleEntry = Object.entries(properties).find(([, value]) => value?.type === 'title');
  const statusEntry =
    Object.entries(properties).find(
      ([name, value]) =>
        name.toLowerCase() === 'status' && (value?.type === 'status' || value?.type === 'select'),
    ) ?? Object.entries(properties).find(([, value]) => value?.type === 'status' || value?.type === 'select');
  if (!titleEntry || !statusEntry) throw new Error('Docs database needs a title and a Status property');
  return {
    dataSourceId,
    titleProperty: titleEntry[0],
    statusProperty: statusEntry[0],
    statusType: statusEntry[1].type === 'select' ? 'select' : 'status',
  };
}

// --- Google helpers -------------------------------------------------------

async function google(apiPath, options = {}) {
  const method = options.method ?? 'GET';
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  let response = await googleFetch(apiPath, method, payload);

  if (response.status === 401) {
    await accessToken(true);
    response = await googleFetch(apiPath, method, payload);
  }

  const text = await response.text();
  if (!response.ok) {
    let code = '';
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.error === 'string') code = parsed.error;
      else if (typeof parsed.error?.status === 'string') code = parsed.error.status;
    } catch {
      // Ignore non-JSON error pages.
    }
    throw new Error(`Gmail HTTP ${response.status}${code ? ` (${code})` : ''}`);
  }
  return text.trim() === '' ? {} : JSON.parse(text);
}

function googleFetch(apiPath, method, payload) {
  return accessToken(false).then((accessToken) =>
    fetch(`https://www.googleapis.com${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: payload,
    }),
  );
}

async function accessToken(force) {
  if (!force && googleToken.access_token && Number(googleToken.expires_at) - Date.now() > 60_000) {
    return googleToken.access_token;
  }
  if (!googleToken.refresh_token) {
    throw new Error('Google token has no refresh token; run "node scripts/connect-google.mjs"');
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: googleClient.client_id,
      client_secret: googleClient.client_secret,
      grant_type: 'refresh_token',
      refresh_token: googleToken.refresh_token,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    let code = '';
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.error === 'string') code = parsed.error;
    } catch {
      // Ignore.
    }
    throw new Error(`Google token refresh HTTP ${response.status}${code ? ` (${code})` : ''}`);
  }
  const payload = JSON.parse(text);
  if (typeof payload.access_token !== 'string') {
    throw new Error('Google token refresh returned no access token');
  }
  const expiresIn = Number(payload.expires_in);
  googleToken = {
    ...googleToken,
    access_token: payload.access_token,
    expires_at: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    refresh_token:
      typeof payload.refresh_token === 'string' && payload.refresh_token
        ? payload.refresh_token
        : googleToken.refresh_token,
  };
  saveToken();
  return googleToken.access_token;
}

function saveToken() {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  const temp = `${tokenPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(googleToken, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, tokenPath);
  fs.chmodSync(tokenPath, 0o600);
}

function plusAddress(account, tag) {
  const at = account.lastIndexOf('@');
  return `${account.slice(0, at)}+${tag}${account.slice(at)}`;
}

// --- Notion helpers -------------------------------------------------------

async function notion(token, method, apiPath, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`https://api.notion.com/v1${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'notion-version': NOTION_VERSION,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: payload,
    });
    lastStatus = response.status;
    const text = await response.text();
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      continue;
    }
    if (!response.ok) {
      let code = '';
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.code === 'string') code = parsed.code;
      } catch {
        // Ignore.
      }
      throw new Error(`Notion HTTP ${response.status}${code ? ` (${code})` : ''}`);
    }
    return text.trim() === '' ? {} : JSON.parse(text);
  }
  throw new Error(`Notion HTTP ${lastStatus}`);
}

async function notionChildren(token, blockId) {
  const blocks = [];
  let cursor;
  let page = 0;
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    const listing = await notion(
      token,
      'GET',
      `/blocks/${encodeURIComponent(blockId)}/children?${query.toString()}`,
    );
    blocks.push(...(Array.isArray(listing.results) ? listing.results : []));
    cursor = listing.has_more && listing.next_cursor ? listing.next_cursor : undefined;
    page += 1;
  } while (cursor && page < 5);
  return blocks;
}

function notionId(value) {
  const hex = String(value ?? '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  if (!hex) return '';
  const id = hex[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property?.type !== 'title') continue;
    return (property.title ?? []).map((item) => item.plain_text ?? '').join('').trim();
  }
  return '';
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Demo seed failed.');
  process.exitCode = 1;
});

#!/usr/bin/env node
// Idempotent demo data for the Pinpoint desk. It only touches the "pinpoint"
// Gmail label, the "Pinpoint demo" calendar, and the Notion demo page:
//   - inserts 2 unread demo emails (never sends)
//   - creates the Tuesday/Wednesday clash on a secondary calendar
//   - ensures the Acme contract note exists
// It never deletes anything and never prints bodies, tokens or addresses.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(SCRIPT_DIR, '..', 'apps', 'server');
const ENV_FILE = path.join(SERVER_ROOT, '.env');
const NOTION_VERSION = '2026-03-11';
const NOTE_TEXT =
  'Acme contract: net-45 agreed with Priya on Nov 12; clause 12 to be narrowed';

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
const timeZone =
  (process.env.PINPOINT_TZ ?? '').trim() ||
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  'UTC';

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
    await section('Calendar', seedCalendar);
  } else {
    console.log('Gmail: skipped (run "node scripts/connect-google.mjs --demo" first)');
    console.log('Calendar: skipped (run "node scripts/connect-google.mjs --demo" first)');
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
  notionReady = Boolean((process.env.NOTION_TOKEN ?? '').trim() && (process.env.NOTION_NOTES_ROOT ?? '').trim());
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

  const messages = [
    {
      who: 'Priya Shah',
      plus: 'priya',
      subject: 'Acme contract - net-45 and clause 12',
      search: 'Acme contract',
      body:
        'Hi,\n\n' +
        'Thanks for the call on Nov 12. We agreed net-45 on the Acme contract, but ' +
        'clause 12 is still too broad. Can you narrow it to the reseller scope and ' +
        'send the revised draft before Friday?\n\n' +
        'Best,\nPriya',
    },
    {
      who: 'Tomas Berg',
      plus: 'tomas',
      subject: 'Podcast recording - Tuesday 10:00?',
      search: 'Podcast recording',
      body:
        'Hey!\n\n' +
        'Tuesday 10:00 works for me for the podcast recording. Shall we lock it in? ' +
        'I can bring the mic and the outline.\n\n' +
        'Tomas',
    },
  ];

  let created = 0;
  let existing = 0;
  for (const message of messages) {
    const query = `label:pinpoint subject:"${message.search}"`;
    const found = await google(
      `/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`,
    );
    if (Array.isArray(found.messages) && found.messages.length > 0) {
      existing += 1;
      continue;
    }

    const from = plusAddress(account, message.plus);
    const raw = [
      `From: "${message.who}" <${from}>`,
      `To: ${account}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <pinpoint-${message.plus}-${Date.now()}@pinpoint.local>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.body,
    ].join('\r\n');

    await google('/gmail/v1/users/me/messages', {
      method: 'POST',
      body: {
        raw: Buffer.from(raw, 'utf8').toString('base64url'),
        labelIds: [label.id, 'INBOX', 'UNREAD'],
      },
    });
    created += 1;
  }

  console.log(`Gmail: 2 demo threads in label "pinpoint" (${created} new, ${existing} already there)`);
}

async function seedCalendar() {
  let listing;
  try {
    listing = await google('/calendar/v3/users/me/calendarList?maxResults=250');
  } catch (error) {
    if (String(error instanceof Error ? error.message : error).includes('403')) {
      throw new Error(
        'Calendar HTTP 403: run "node scripts/connect-google.mjs --demo" and allow the calendar setup permissions',
      );
    }
    throw error;
  }
  let calendar = (listing.items ?? []).find(
    (entry) => String(entry.summary ?? '').trim().toLowerCase() === 'pinpoint demo',
  );
  if (!calendar) {
    try {
      calendar = await google('/calendar/v3/calendars', {
        method: 'POST',
        body: {
          summary: 'Pinpoint demo',
          description: 'Demo calendar for Pinpoint',
          timeZone,
        },
      });
    } catch (error) {
      if (String(error instanceof Error ? error.message : error).includes('403')) {
        throw new Error(
          'Calendar HTTP 403: run "node scripts/connect-google.mjs --demo" and allow the calendar setup permissions',
        );
      }
      throw error;
    }
  }
  if (!calendar?.id) throw new Error('could not create the Pinpoint demo calendar');

  const tuesday = nextWeekday(2);
  const wednesday = addDays(tuesday, 1);
  const events = [
    {
      summary: 'Deep work block',
      start: at(tuesday, 10, 0),
      end: at(tuesday, 12, 0),
    },
    {
      summary: 'Dentist',
      start: at(wednesday, 8, 30),
      end: at(wednesday, 9, 30),
    },
    {
      summary: '1:1 with Ken',
      start: at(wednesday, 9, 0),
      end: at(wednesday, 9, 30),
    },
  ];

  const windowStart = new Date(at(tuesday, 0, 0)).toISOString();
  const windowEnd = new Date(at(addDays(wednesday, 1), 0, 0)).toISOString();
  const params = new URLSearchParams({
    timeMin: windowStart,
    timeMax: windowEnd,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const existingEvents = await google(
    `/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params.toString()}`,
  );
  const already = new Set(
    (existingEvents.items ?? [])
      .filter((event) => typeof event.start?.dateTime === 'string')
      .map(
        (event) =>
          `${String(event.summary ?? '').trim().toLowerCase()}|${Date.parse(event.start.dateTime)}`,
      ),
  );

  let created = 0;
  let existing = 0;
  for (const event of events) {
    const key = `${event.summary.toLowerCase()}|${Date.parse(event.start)}`;
    if (already.has(key)) {
      existing += 1;
      continue;
    }
    await google(`/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`, {
      method: 'POST',
      body: {
        summary: event.summary,
        start: { dateTime: event.start, timeZone },
        end: { dateTime: event.end, timeZone },
      },
    });
    created += 1;
  }

  console.log(
    `Calendar: "Pinpoint demo" ready (${created} new events, ${existing} already there)`,
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
  if (!demoId) {
    console.log('Notion: Acme note skipped (run "node scripts/connect-notion.mjs" first)');
    return;
  }

  const demoChildren = await notionChildren(token, demoId);
  const note = demoChildren.find(
    (block) =>
      block.type === 'child_page' &&
      String(block.child_page?.title ?? '').trim().toLowerCase() === 'acme contract',
  );
  if (note) {
    console.log('Notion: Acme note already there');
    return;
  }

  await notion(token, 'POST', '/pages', {
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
  console.log('Notion: Acme note created');
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
    const label = apiPath.startsWith('/gmail') ? 'Gmail' : 'Calendar';
    throw new Error(`${label} HTTP ${response.status}${code ? ` (${code})` : ''}`);
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

function nextWeekday(weekday) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  let add = (weekday - date.getDay() + 7) % 7;
  if (add === 0) add = 7;
  date.setDate(date.getDate() + add);
  return date;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function at(date, hour, minute) {
  const next = new Date(date.getTime());
  next.setHours(hour, minute, 0, 0);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}:00`;
}

function pad(value) {
  return String(value).padStart(2, '0');
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

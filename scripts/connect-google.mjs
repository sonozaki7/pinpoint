#!/usr/bin/env node
// Connect Pinpoint to Gmail with a desktop OAuth client and a loopback
// redirect. Prints setup steps, opens the consent page, saves the token to
// apps/server/.data/google-token.json (mode 0600), then verifies by printing
// counts only. Never prints tokens, mail bodies or email addresses.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(SCRIPT_DIR, '..', 'apps', 'server');

// One data scope: read/label, update and send drafts, and mark mail read.
// Pinpoint has no calendar scope and never scans the whole mailbox.
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dataDir = path.resolve(flag('--data-dir') ?? path.join(SERVER_ROOT, '.data'));
const clientPath = path.join(dataDir, 'google-client.json');
const tokenPath = path.join(dataDir, 'google-token.json');

function cloudSteps() {
  console.log(`Google Cloud setup for Pinpoint (about 5 minutes)

1. Open https://console.cloud.google.com/projectcreate
   Create a project named "Pinpoint" (or pick an existing Pinpoint project).
2. Open https://console.cloud.google.com/apis/library
   Search "Gmail API" -> Enable.
3. Open https://console.cloud.google.com/apis/credentials/consent
   Choose External, fill in app name "Pinpoint" and your support email, save.
   Under "Test users", add your own Google address. Testing mode is fine.
4. Open https://console.cloud.google.com/apis/credentials
   Create credentials -> OAuth client ID -> Application type "Desktop app"
   -> name "Pinpoint desktop" -> Create -> Download JSON.
5. Move that JSON here: ${clientPath}

Then run this script again. The request is limited to gmail.modify, so
Pinpoint cannot read calendars or delete mail permanently.`);
}

async function main() {
  if (!fs.existsSync(clientPath)) {
    cloudSteps();
    process.exitCode = 1;
    return;
  }

  let client;
  try {
    const raw = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
    client = raw.installed ?? raw.web;
  } catch {
    throw new Error(`${clientPath} is not valid JSON. Download the client JSON again.`);
  }
  if (!client?.client_id || !client?.client_secret) {
    throw new Error(
      `${clientPath} is not a desktop OAuth client (missing client_id/client_secret).`,
    );
  }

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');

  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  console.log('Opening Google consent in your browser.');
  console.log(`If it does not open, paste this URL:\n\n${authUrl.toString()}\n`);
  openBrowser(authUrl.toString());

  let token;
  try {
    token = await waitForCallback({ server, client, redirectUri, verifier, state, tokenPath });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\nGoogle connected. Token saved to ${tokenPath} (mode 0600).`);
  const [labels, drafts] = await Promise.all([
    countLabels(token.access_token).catch(() => null),
    countDrafts(token.access_token).catch(() => null),
  ]);
  console.log(`Gmail labels visible: ${labels === null ? 'unavailable' : labels}`);
  console.log(`Drafts visible: ${drafts === null ? 'unavailable' : drafts}`);
  console.log('\nNext: node scripts/seed-demo.mjs');
}

function waitForCallback({ server, client, redirectUri, verifier, state, tokenPath }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error('Timed out after 5 minutes waiting for Google consent.'));
    }, 5 * 60_000);
    timer.unref?.();

    server.on('request', async (request, response) => {
      // Base host is irrelevant here (only path and query are read); server.address() is null once
      // the server closes, and browsers send a late /favicon.ico right after the callback.
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Not found');
        return;
      }

      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        const code = String(oauthError).replace(/[^a-z0-9_.-]/gi, '').slice(0, 60);
        respond(response, 400, 'Google did not grant access', code || 'Authorization was cancelled.');
        finish(new Error(`Google returned: ${code || 'authorization error'}`));
        return;
      }

      if (url.searchParams.get('state') !== state) {
        respond(response, 400, 'Sign-in check failed', 'State did not match. Run the script again.');
        finish(new Error('OAuth state did not match.'));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        respond(response, 400, 'Sign-in failed', 'Google did not return a code.');
        finish(new Error('Google did not return an authorization code.'));
        return;
      }

      try {
        const token = await exchangeCode({ client, code, redirectUri, verifier, tokenPath });
        respond(
          response,
          200,
          'Pinpoint is connected',
          'Gmail access is saved. You can close this tab.',
        );
        finish(null, token);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Token exchange failed.';
        respond(response, 500, 'Could not finish sign-in', message.slice(0, 200));
        finish(error);
      }
    });
  });
}

async function exchangeCode({ client, code, redirectUri, verifier, tokenPath }) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    let code = '';
    try {
      const payload = JSON.parse(text);
      if (typeof payload.error === 'string') code = payload.error;
    } catch {
      // Ignore non-JSON error pages.
    }
    throw new Error(`Token exchange failed: HTTP ${response.status}${code ? ` (${code})` : ''}`);
  }

  const payload = JSON.parse(text);
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new Error('Token exchange returned no access token.');
  }

  let previousRefresh = '';
  try {
    const previous = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    if (typeof previous.refresh_token === 'string') previousRefresh = previous.refresh_token;
  } catch {
    // No previous token.
  }

  const expiresIn = Number(payload.expires_in);
  const token = {
    access_token: payload.access_token,
    expires_at: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    refresh_token:
      typeof payload.refresh_token === 'string' && payload.refresh_token
        ? payload.refresh_token
        : previousRefresh || undefined,
    scope: typeof payload.scope === 'string' ? payload.scope : SCOPES.join(' '),
    token_type: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
  };
  if (!token.refresh_token) {
    throw new Error('Google returned no refresh token. Remove the old token file and try again.');
  }

  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  const temp = `${tokenPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(token, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, tokenPath);
  fs.chmodSync(tokenPath, 0o600);
  return token;
}

async function countLabels(accessToken) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Gmail labels: HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.labels) ? payload.labels.length : 0;
}

async function countDrafts(accessToken) {
  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=1',
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error(`Gmail drafts: HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.drafts) ? payload.drafts.length : 0;
}

function respond(response, status, title, message) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><meta charset="utf-8"><title>${safeTitle}</title>
<body style="font:16px system-ui;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#111">
<h1 style="font-size:1.4rem">${safeTitle}</h1><p>${safeMessage}</p></body>`);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openBrowser(url) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch {
    // The URL is printed above; the owner can paste it.
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Google connection failed.');
  process.exitCode = 1;
});

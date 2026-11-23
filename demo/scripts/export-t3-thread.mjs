#!/usr/bin/env node
// Exports one T3 Code thread's conversation through the orchestration API, for
// the demo's live proof. Reads T3_TOKEN from the environment or apps/server/.env
// and never writes or prints it.
//
//   node demo/scripts/export-t3-thread.mjs <threadId> [--out demo/recordings/t3-live-thread.json]
//
// The output holds only this thread: metadata, messages, plans, the cited
// review and the agent's reply. No other thread is fetched.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const argv = process.argv.slice(2);
const threadId = argv[0];
const outFlag = argv.indexOf('--out');
const out = path.resolve(repo, outFlag >= 0 ? argv[outFlag + 1] : 'demo/recordings/t3-live-thread.json');
if (!threadId || threadId.startsWith('--')) {
  console.error('usage: node demo/scripts/export-t3-thread.mjs <threadId> [--out <file>]');
  process.exit(2);
}

function tokenFromEnvFile() {
  const file = path.join(repo, 'apps/server/.env');
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^T3_TOKEN=(.*)$/);
    if (match) return match[1].trim();
  }
  return '';
}

const token = process.env.T3_TOKEN?.trim() || tokenFromEnvFile();
if (!token) {
  console.error('T3_TOKEN is not set (env or apps/server/.env)');
  process.exit(1);
}
const base = (process.env.T3_URL || 'http://127.0.0.1:3773').replace(/\/+$/, '');
const headers = {
  authorization: `Bearer ${token}`,
  'x-t3-orchestration-protocol': '2',
  accept: 'application/json',
};

async function get(pathname) {
  const response = await fetch(base + pathname, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
  return response.json();
}

const environment = await get('/.well-known/t3/environment');
const shell = await get('/api/orchestration/shell?omitIdleSubagents=1&omitOlderSettled=1');
const detail = await get(`/api/orchestration/threads/${encodeURIComponent(threadId)}`);
const projection = detail.projection ?? {};
const row = (shell.threads ?? []).find((thread) => thread.id === threadId) ?? null;
const project = (shell.projects ?? []).find((candidate) => candidate.id === (row?.projectId ?? projection.thread?.projectId)) ?? null;
const messages = (projection.messages ?? []).map((message) => ({
  id: message.id,
  role: message.role,
  createdAt: message.createdAt,
  text: message.text,
}));
const review = [...messages].reverse().find((message) => message.role === 'user' && /Review from G2/.test(message.text)) ?? null;
const reply = review
  ? messages.find((message) => message.role === 'assistant' && message.createdAt > review.createdAt) ?? null
  : null;

const exported = {
  exportedAt: new Date().toISOString(),
  source: 'T3 Code orchestration API',
  environment: { id: environment.environmentId, label: environment.label, serverVersion: environment.serverVersion },
  thread: {
    id: threadId,
    title: projection.thread?.title ?? row?.title ?? null,
    project: project?.title ?? null,
    projectId: project?.id ?? null,
    status: row?.status ?? null,
    createdAt: projection.thread?.createdAt ?? row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  },
  plans: (projection.plans ?? []).map((plan) => ({ id: plan.id, kind: plan.kind, status: plan.status, markdown: plan.markdown })),
  review,
  reply,
  messages,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(exported, null, 2) + '\n');
console.log(`wrote ${out}`);
console.log(`thread "${exported.thread.title}" · ${messages.length} messages · review ${review ? 'yes' : 'no'} · reply ${reply ? 'yes' : 'no'}`);

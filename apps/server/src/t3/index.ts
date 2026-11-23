/**
 * Pinpoint's T3 Code client.
 *
 * Reads use the environment HTTP API (`GET /api/orchestration/shell` and
 * `GET /api/orchestration/threads/:id`). Writes use the same WebSocket RPC the
 * T3 web app uses (`POST /api/auth/websocket-ticket` then a JSON RPC frame on
 * `/ws`). `sendMessage` keeps a CLI fallback (`t3 thread send <id> -`) for the
 * case where the socket cannot be reached.
 *
 * Findings and payload shapes: docs/t3-api-notes.md.
 *
 * Never log, print or return the bearer token or the WebSocket ticket.
 */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';

// --- Contract (SPEC §6; owned by src/core/types.ts) -----------------------

import type {ThreadAttention} from '../../../../shared/contract.js';
import type {AttentionSource, AttentionThread, SendOptions, T3Client} from '../core/types.js';

export type {AttentionSource, AttentionThread, ThreadAttention, T3Client};

/** Local aliases kept for callers that talk about a "source" inside the T3 client. */
export type T3Source = AttentionSource;
export type T3Question = NonNullable<AttentionSource['question']>['questions'][number];

// --- Errors ---------------------------------------------------------------

export type T3ErrorCode = 'unreachable' | 'unauthorized' | 'response' | 'not_found' | 'send_failed';

export class T3ClientError extends Error {
  constructor(
    readonly code: T3ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'T3ClientError';
  }
}

// --- Raw shapes we read (only the fields the client uses) ------------------

export interface ShellLatestVisibleMessage {
  id: string;
  role: string;
  text: string;
  updatedAt: string;
}

export interface ShellThread {
  id: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  settledAt: string | null;
  settledOverride?: 'settled' | 'active' | null;
  snoozedUntil?: string | null;
  pendingRuntimeRequest?: {id: string; kind: string; blocking?: boolean} | null;
  hasActionableProposedPlan?: boolean;
  latestVisibleMessage?: ShellLatestVisibleMessage | null;
  latestUserAuthoredMessageAt?: string | null;
  latestUserMessageAt?: string | null;
  lineage?: {
    parentThreadId: string | null;
    relationshipToParent: 'fork' | 'subagent' | null;
    sideChat?: boolean;
  } | null;
}

export interface ShellProject {
  id: string;
  title: string;
  workspaceRoot?: string;
}

export interface ShellSnapshot {
  threads: ShellThread[];
  projects?: ShellProject[];
  archivedThreads?: unknown;
}

interface ProjectedItem {
  position: number;
  visibility: string;
  item: {
    id: string;
    type: string;
    role?: string;
    text?: string;
    updatedAt?: string;
    createdAt?: string;
    streaming?: boolean;
    requestId?: string;
    questions?: RawQuestion[];
    markdown?: string;
    planId?: string;
  };
}

interface RawQuestion {
  id: string;
  header?: string;
  question: string;
  options?: {label: string; description?: string; value?: string}[];
  multiSelect?: boolean;
}

interface RawPlan {
  id: string;
  kind: 'proposed_plan' | 'todo_list';
  status: 'draft' | 'active' | 'completed' | 'superseded';
  markdown?: string;
}

interface RawMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  streaming?: boolean;
  updatedAt?: string;
  createdAt?: string;
}

interface RawRuntimeRequest {
  id: string;
  kind: string;
  status: 'pending' | 'resolved' | 'expired' | 'cancelled';
  createdAt?: string;
  unresolvedAt?: string | null;
}

export interface ThreadProjection {
  thread: {id: string; title?: string; projectId?: string};
  messages?: RawMessage[];
  plans?: RawPlan[];
  turnItems?: ProjectedItem['item'][] | ProjectedItem[];
  runtimeRequests?: RawRuntimeRequest[];
}

export interface TranscriptItem {
  position: number;
  visibility: string;
  item: {
    id: string;
    type: string;
    role?: string;
    text?: string;
    updatedAt?: string;
    createdAt?: string;
  };
}

// --- Attention rules (SPEC §6) --------------------------------------------

const REPORT_STATUSES = new Set(['idle', 'completed']);
const ATTENTION_PRIORITY: Record<ThreadAttention, number> = {
  question: 0,
  plan: 1,
  failed: 2,
  report: 3,
};

function parseTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSettled(thread: ShellThread): boolean {
  if (thread.settledOverride === 'active') return false;
  if (thread.settledOverride === 'settled') return true;
  return thread.settledAt !== null && thread.settledAt !== undefined;
}

function isSnoozed(thread: ShellThread, nowMs: number): boolean {
  const until = parseTime(thread.snoozedUntil);
  return until !== null && until > nowMs;
}

function isSubagentChild(thread: ShellThread): boolean {
  return thread.lineage?.relationshipToParent === 'subagent' || thread.lineage?.sideChat === true;
}

/** A thread qualifies only if it is not archived, deleted, settled, snoozed, or a subagent child. */
export function isAttentionEligible(thread: ShellThread, nowMs: number): boolean {
  const archived = thread.archivedAt !== null && thread.archivedAt !== undefined;
  const deleted = thread.deletedAt !== null && thread.deletedAt !== undefined;
  return !archived && !deleted && !isSettled(thread) && !isSnoozed(thread, nowMs) && !isSubagentChild(thread);
}

/**
 * Kind of attention for one eligible thread, or null.
 *
 * `latest` is the latest visible conversation message. The shell usually leaves
 * `latestVisibleMessage` null (see docs/t3-api-notes.md), so callers pass the
 * newest user/assistant message from the transcript instead.
 */
export function attentionKind(
  thread: ShellThread,
  latest: ShellLatestVisibleMessage | null,
  nowMs: number,
): ThreadAttention | null {
  if (!isAttentionEligible(thread, nowMs)) return null;
  if (thread.pendingRuntimeRequest?.kind === 'user_input') return 'question';
  if (thread.hasActionableProposedPlan === true) return 'plan';
  if (thread.status === 'failed') return 'failed';
  if (!REPORT_STATUSES.has(thread.status)) return null;
  if (latest === null || latest.role !== 'assistant') return null;
  const assistantAt = parseTime(latest.updatedAt);
  if (assistantAt === null) return null;
  const userAt = parseTime(thread.latestUserAuthoredMessageAt);
  if (userAt !== null && assistantAt <= userAt) return null;
  return 'report';
}

/** Latest visible user/assistant message in a transcript, or null. */
export function latestVisibleFromTranscript(
  items: readonly TranscriptItem[],
): ShellLatestVisibleMessage | null {
  let best: {position: number; message: ShellLatestVisibleMessage} | null = null;
  for (const entry of items) {
    if (entry.item.type !== 'user_message' && entry.item.type !== 'assistant_message') continue;
    if (entry.visibility === 'synthetic') continue;
    const role = entry.item.type === 'user_message' ? 'user' : 'assistant';
    const text = typeof entry.item.text === 'string' ? entry.item.text : '';
    const updatedAt = entry.item.updatedAt ?? entry.item.createdAt ?? '';
    if (parseTime(updatedAt) === null) continue;
    if (best === null || entry.position >= best.position) {
      best = {
        position: entry.position,
        message: {id: entry.item.id, role, text, updatedAt},
      };
    }
  }
  return best?.message ?? null;
}

/**
 * Build attention rows from a shell snapshot plus already-resolved latest
 * messages (threadId → message). Threads with no resolved message and no shell
 * `latestVisibleMessage` are checked again by the caller with transcript data.
 */
export function attentionFromSnapshot(
  snapshot: ShellSnapshot,
  latestByThread: ReadonlyMap<string, ShellLatestVisibleMessage | null>,
  nowMs: number,
): {rows: AttentionThread[]; needsTranscript: ShellThread[]} {
  const projects = new Map<string, ShellProject>();
  for (const project of snapshot.projects ?? []) projects.set(project.id, project);

  const rows: AttentionThread[] = [];
  const needsTranscript: ShellThread[] = [];
  const seen = new Set<string>();

  for (const thread of snapshot.threads ?? []) {
    if (typeof thread.id !== 'string' || seen.has(thread.id)) continue;
    seen.add(thread.id);
    if (!isAttentionEligible(thread, nowMs)) continue;

    const shellLatest = normalizeLatest(thread.latestVisibleMessage);
    const latest = shellLatest ?? latestByThread.get(thread.id) ?? null;
    const kind = attentionKind(thread, latest, nowMs);
    if (kind === null) {
      // A plain reply needs the transcript when the shell hides the message.
      if (REPORT_STATUSES.has(thread.status) && shellLatest === null) {
        needsTranscript.push(thread);
      }
      continue;
    }
    rows.push(toAttentionRow(thread, kind, projects));
  }
  return {rows, needsTranscript};
}

function normalizeLatest(raw: ShellLatestVisibleMessage | null | undefined): ShellLatestVisibleMessage | null {
  if (!raw || typeof raw.role !== 'string' || typeof raw.updatedAt !== 'string') return null;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    role: raw.role,
    text: typeof raw.text === 'string' ? raw.text : '',
    updatedAt: raw.updatedAt,
  };
}

function toAttentionRow(
  thread: ShellThread,
  kind: ThreadAttention,
  projects: ReadonlyMap<string, ShellProject>,
): AttentionThread {
  const project = projects.get(thread.projectId);
  return {
    threadId: thread.id,
    title: thread.title || 'Untitled thread',
    project: project?.title || project?.workspaceRoot?.split('/').filter(Boolean).at(-1) || 'Unknown project',
    attention: kind,
    updatedAt: thread.updatedAt,
  };
}

export function sortAttention(rows: AttentionThread[]): AttentionThread[] {
  return [...rows].sort((a, b) => {
    const priority = ATTENTION_PRIORITY[a.attention] - ATTENTION_PRIORITY[b.attention];
    if (priority !== 0) return priority;
    return (parseTime(b.updatedAt) ?? 0) - (parseTime(a.updatedAt) ?? 0);
  });
}

// --- Source extraction ----------------------------------------------------

function turnItemBody(item: ProjectedItem | ProjectedItem['item']): ProjectedItem['item'] {
  if ('item' in item && item.item !== null && typeof item.item === 'object') {
    return item.item;
  }
  return item as ProjectedItem['item'];
}

function findPendingUserInput(projection: ThreadProjection): RawRuntimeRequest | null {
  const pending = (projection.runtimeRequests ?? []).filter(
    (request) => request.kind === 'user_input' && request.status === 'pending',
  );
  return pending.at(-1) ?? null;
}

function questionsForRequest(projection: ThreadProjection, requestId: string): RawQuestion[] {
  const items = (projection.turnItems ?? []).map(turnItemBody);
  const matching = items.filter(
    (item) => item.type === 'user_input_request' && item.requestId === requestId,
  );
  const last = matching.at(-1);
  return Array.isArray(last?.questions) ? last.questions : [];
}

function toQuestions(raw: readonly RawQuestion[]): T3Question[] {
  return raw.map((question) => ({
    id: question.id,
    question: question.question,
    options: (question.options ?? []).map((option) => option.label),
  }));
}

/** Source for the review deck: a pending question, an active proposed plan, or the latest reply. */
export function sourceFromProjection(projection: ThreadProjection): T3Source {
  const pending = findPendingUserInput(projection);
  if (pending !== null) {
    const rawQuestions = questionsForRequest(projection, pending.id);
    if (rawQuestions.length > 0) {
      const questions = toQuestions(rawQuestions);
      return {
        sourceMessageId: `${pending.id}`,
        text: questions.map((question) => question.question).join('\n\n'),
        kind: 'question',
        question: {requestId: pending.id, questions},
      };
    }
  }

  const plan = (projection.plans ?? [])
    .filter((artifact) => artifact.kind === 'proposed_plan' && artifact.status === 'active')
    .at(-1);
  if (plan !== undefined && typeof plan.markdown === 'string' && plan.markdown.trim().length > 0) {
    return {sourceMessageId: plan.id, text: plan.markdown, kind: 'plan'};
  }

  const messages = projection.messages ?? [];
  const assistant = [...messages].reverse().find(
    (message) => message.role === 'assistant' && message.streaming !== true && message.text.trim().length > 0,
  );
  if (assistant !== undefined) {
    return {sourceMessageId: assistant.id, text: assistant.text, kind: 'reply'};
  }

  const turnItems = (projection.turnItems ?? []).map(turnItemBody);
  const assistantItem = [...turnItems].reverse().find(
    (item) => item.type === 'assistant_message' && typeof item.text === 'string' && item.text.trim().length > 0,
  );
  if (assistantItem !== undefined) {
    return {sourceMessageId: assistantItem.id, text: assistantItem.text ?? '', kind: 'reply'};
  }

  throw new T3ClientError('not_found', 'This thread has no message to review yet.');
}

/**
 * Map drawer answers to provider answers: a label that matches a listed option
 * becomes that option's value (T3 stores option values, not labels).
 */
export function normalizeAnswers(
  questions: readonly RawQuestion[],
  answers: Record<string, string>,
): Record<string, string> {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const normalized: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(answers)) {
    if (typeof answer !== 'string') continue;
    const question = byId.get(questionId);
    const match = question?.options?.find(
      (option) => option.value === answer || option.label === answer,
    );
    normalized[questionId] = match?.value ?? match?.label ?? answer;
  }
  return normalized;
}

// --- Transport ------------------------------------------------------------

const ORCHESTRATION_PROTOCOL = '2';
const DEFAULT_URL = 'http://127.0.0.1:3773';
const DEFAULT_TIMEOUT_MS = 15_000;
const SHELL_CACHE_MS = 2_000;
const TRANSCRIPT_CACHE_MS = 30_000;

export interface T3ClientConfig {
  /** Override the T3 origin (defaults to env.T3_URL or http://127.0.0.1:3773). */
  url?: string;
  /** Override the bearer token (defaults to env.T3_TOKEN). */
  token?: string;
  timeoutMs?: number;
  /** Path to the t3 CLI used by the send fallback. */
  cliPath?: string;
  /** Set false in tests to keep sends from spawning a process. */
  cliFallback?: boolean;
  /**
   * Privacy allowlist (project ids or exact titles). Defaults to T3_PROJECTS /
   * env.t3Projects. Required: the client refuses to exist without it.
   */
  projects?: string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CachedTranscript {
  threadUpdatedAt: string;
  latest: ShellLatestVisibleMessage | null;
  at: number;
}

function firstEnv(env: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** Read a project allowlist from either a comma-separated string or a string array. */
function firstProjectList(env: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = env[key];
    const entries = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : typeof value === 'string'
        ? value.split(',')
        : [];
    const cleaned = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    if (cleaned.length > 0) return cleaned;
  }
  return [];
}

interface ResolvedProjects {
  /** Project ids the allowlist names, matched by id or exact title. */
  ids: Set<string>;
  /** Allowlist entries that matched no project in the snapshot. */
  unmatched: string[];
}

/** Match allowlist entries (project ids or exact titles, case-insensitive for titles). */
export function resolveProjectAllowlist(
  snapshot: Pick<ShellSnapshot, 'projects'>,
  allowed: readonly string[],
): ResolvedProjects {
  const ids = new Set<string>();
  const unmatched: string[] = [];
  const projects = snapshot.projects ?? [];
  for (const entry of allowed) {
    const wanted = entry.trim();
    if (wanted.length === 0) continue;
    const lower = wanted.toLocaleLowerCase();
    const matches = projects.filter(
      (project) => project.id === wanted || project.title?.trim().toLocaleLowerCase() === lower,
    );
    if (matches.length === 0) {
      unmatched.push(wanted);
      continue;
    }
    for (const project of matches) ids.add(project.id);
  }
  return {ids, unmatched};
}


/**
 * Create a client from environment variables.
 *
 * Accepts both the process environment (`T3_URL`, `T3_TOKEN`) and the core's
 * typed `Env` object (`t3Url`, `t3Token`), so `loadT3Client` can pass either.
 */
export function createT3Client(
  env: Record<string, unknown> = process.env,
  config: T3ClientConfig = {},
): T3Client {
  const rawUrl =
    config.url ?? firstEnv(env, 'T3_URL', 'T3_BASE_URL', 't3Url') ?? DEFAULT_URL;
  let origin: string;
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    throw new T3ClientError('response', 'T3_URL is not a valid URL.');
  }
  const token = config.token ?? firstEnv(env, 'T3_TOKEN', 't3Token');
  if (token === undefined) {
    throw new T3ClientError('unauthorized', 'T3_TOKEN is not set. Mint one with `t3 auth session issue`.');
  }
  const projectAllowlist = config.projects ?? firstProjectList(env, 'T3_PROJECTS', 't3Projects');
  if (projectAllowlist.length === 0) {
    throw new T3ClientError(
      'unauthorized',
      'T3_PROJECTS is empty. Refusing to read T3 threads without a project allowlist.',
    );
  }

  const configuredTimeout = Number(firstEnv(env, 'T3_TIMEOUT_MS'));
  const timeoutMs =
    config.timeoutMs ??
    (Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS);
  const doFetch = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const cliPath = config.cliPath ?? firstEnv(env, 'T3_CLI') ?? join(homedir(), '.t3', 'bin', 't3');
  const cliFallback = config.cliFallback ?? true;

  let shellCache: {at: number; snapshot: ShellSnapshot} | null = null;
  let shellPending: Promise<ShellSnapshot> | null = null;
  const transcriptCache = new Map<string, CachedTranscript>();
  const warnedUnmatched = new Set<string>();

  const readOnlyHeaders = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'X-T3-Orchestration-Protocol': ORCHESTRATION_PROTOCOL,
  } as const;

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(origin + path, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
        redirect: 'error',
        cache: 'no-store',
        headers: init?.headers ?? readOnlyHeaders,
      });
    } catch {
      throw new T3ClientError('unreachable', 'T3 Code is not reachable at the configured address.');
    }
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      throw new T3ClientError('unauthorized', 'T3 Code rejected the token (expired or missing a scope).');
    }
    if (response.status === 404) {
      void response.body?.cancel().catch(() => {});
      throw new T3ClientError('not_found', 'T3 Code does not know that thread.');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new T3ClientError('response', `T3 Code returned HTTP ${response.status}.`);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new T3ClientError('response', 'T3 Code returned a response this client does not understand.');
    }
  }

  async function getShell(): Promise<ShellSnapshot> {
    const at = now();
    if (shellCache !== null && at - shellCache.at < SHELL_CACHE_MS) return shellCache.snapshot;
    if (shellPending === null) {
      shellPending = requestJson<ShellSnapshot>(
        `/api/orchestration/shell?omitIdleSubagents=1&omitOlderSettled=1`,
      )
        .then((snapshot) => {
          if (!Array.isArray(snapshot?.threads)) {
            throw new T3ClientError('response', 'T3 Code returned an unusable thread list.');
          }
          shellCache = {at: now(), snapshot};
          return snapshot;
        })
        .finally(() => {
          shellPending = null;
        });
    }
    return shellPending;
  }

  async function getThread(threadId: string): Promise<ThreadProjection> {
    // Every projection read passes the allowlist gate first.
    await assertAllowedThread(threadId);
    const detail = await requestJson<{projection?: ThreadProjection} | ThreadProjection>(
      `/api/orchestration/threads/${encodeURIComponent(threadId)}`,
    );
    const projection = 'projection' in detail && detail.projection ? detail.projection : (detail as ThreadProjection);
    if (!projection || typeof projection !== 'object') {
      throw new T3ClientError('response', 'T3 Code returned an unusable thread.');
    }
    return projection;
  }

  async function latestFor(thread: ShellThread): Promise<ShellLatestVisibleMessage | null> {
    const at = now();
    const cached = transcriptCache.get(thread.id);
    if (cached !== undefined && cached.threadUpdatedAt === thread.updatedAt && at - cached.at < TRANSCRIPT_CACHE_MS) {
      return cached.latest;
    }
    try {
      const transcript = await requestJson<{items?: TranscriptItem[]}>(
        `/api/orchestration/threads/${encodeURIComponent(thread.id)}/transcript`,
      );
      if (!Array.isArray(transcript?.items)) return null;
      const latest = latestVisibleFromTranscript(transcript.items);
      transcriptCache.set(thread.id, {threadUpdatedAt: thread.updatedAt, latest, at});
      return latest;
    } catch {
      // One thread's unreadable transcript must not empty the whole inbox.
      return null;
    }
  }

  /**
   * Project ids named by T3_PROJECTS. Resolved against the shell's project list
   * so ids and exact titles both work. An entry that matches nothing is logged
   * once (it is a config mistake, not thread content).
   */
  async function allowedProjectIds(snapshot: ShellSnapshot): Promise<Set<string>> {
    const {ids, unmatched} = resolveProjectAllowlist(snapshot, projectAllowlist);
    for (const entry of unmatched) {
      if (warnedUnmatched.has(entry)) continue;
      warnedUnmatched.add(entry);
      console.warn(`[t3] T3_PROJECTS entry "${entry}" matched no T3 project; nothing from it is read`);
    }
    return ids;
  }

  /** Privacy gate for single-thread reads (deck, preview, send, phone). */
  async function assertAllowedThread(threadId: string): Promise<void> {
    const snapshot = await getShell();
    const ids = await allowedProjectIds(snapshot);
    const thread = (snapshot.threads ?? []).find((candidate) => candidate.id === threadId);
    if (thread === undefined || !ids.has(thread.projectId)) {
      throw new T3ClientError(
        'not_found',
        'That thread is not visible in an allowed T3_PROJECTS project, so Pinpoint will not read it.',
      );
    }
  }

  async function listAttention(): Promise<AttentionThread[]> {
    const snapshot = await getShell();
    const allowedIds = await allowedProjectIds(snapshot);
    // Privacy allowlist applies before attention rules, transcript reads and
    // deck builds, so a thread from another project never leaves this function.
    const scoped: ShellSnapshot = {
      ...snapshot,
      threads: (snapshot.threads ?? []).filter((thread) => allowedIds.has(thread.projectId)),
    };
    const {rows, needsTranscript} = attentionFromSnapshot(scoped, new Map(), now());

    // Resolve only threads that could still turn out to be plain replies.
    const resolved = new Map<string, ShellLatestVisibleMessage | null>();
    const limit = 6;
    for (let index = 0; index < needsTranscript.length; index += limit) {
      const batch = needsTranscript.slice(index, index + limit);
      const results = await Promise.all(batch.map((thread) => latestFor(thread)));
      batch.forEach((thread, offset) => resolved.set(thread.id, results[offset] ?? null));
    }

    const retried = attentionFromSnapshot(scoped, resolved, now());
    const merged = new Map<string, AttentionThread>();
    for (const row of [...rows, ...retried.rows]) merged.set(row.threadId, row);
    return sortAttention([...merged.values()]);
  }

  async function getSource(threadId: string): Promise<T3Source> {
    await assertAllowedThread(threadId);
    return sourceFromProjection(await getThread(threadId));
  }

  async function sendMessage(threadId: string, text: string, options?: SendOptions): Promise<void> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new T3ClientError('send_failed', 'Refusing to send an empty message.');
    }
    await assertAllowedThread(threadId);
    try {
      await dispatchCommand({
        type: 'message.dispatch',
        commandId: randomUUID(),
        threadId,
        messageId: randomUUID(),
        text,
        attachments: [],
        createdBy: 'user',
        creationSource: 'web',
        dispatchMode: {type: 'start_immediately'},
        deliveryIntent: 'auto',
        ...(options?.sourcePlanId === undefined
          ? {}
          : {sourcePlanRef: {threadId, planId: options.sourcePlanId}}),
      });
      return;
    } catch (error) {
      if (!cliFallback) throw error;
      await sendViaCli(threadId, text, cliPath, timeoutMs);
    }
  }

  async function answerQuestion(
    threadId: string,
    requestId: string,
    answers: Record<string, string>,
  ): Promise<void> {
    if (typeof requestId !== 'string' || requestId.length === 0 || Object.keys(answers ?? {}).length === 0) {
      throw new T3ClientError('send_failed', 'Refusing to answer with no request id or answers.');
    }
    // Gate before the read that may fail: the answer write must never reach a
    // thread outside T3_PROJECTS just because the projection read failed.
    await assertAllowedThread(threadId);
    let questions: RawQuestion[] = [];
    try {
      questions = questionsForRequest(await getThread(threadId), requestId);
    } catch {
      // The socket may still accept the answer; do not block on a read failure.
    }
    await dispatchCommand({
      type: 'runtime-request.respond',
      commandId: randomUUID(),
      threadId,
      requestId,
      answers: normalizeAnswers(questions, answers),
    });
  }

  // --- WebSocket dispatch (same path as the T3 web app) ---

  async function websocketTicket(): Promise<string> {
    const ticket = await requestJson<{ticket?: string}>('/api/auth/websocket-ticket', {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`},
    });
    if (typeof ticket?.ticket !== 'string' || ticket.ticket.length === 0) {
      throw new T3ClientError('response', 'T3 Code did not issue a WebSocket ticket.');
    }
    return ticket.ticket;
  }

  async function dispatchCommand(payload: Record<string, unknown>): Promise<void> {
    if (typeof WebSocket !== 'function') {
      throw new T3ClientError('send_failed', 'This Node build has no WebSocket support.');
    }
    const ticket = await websocketTicket();
    const wsOrigin = origin.replace(/^http/, 'ws');
    const url = `${wsOrigin}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL}&wsTicket=${encodeURIComponent(ticket)}`;
    const requestId = 1;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      const finish = (error?: T3ClientError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket?.close();
        } catch {
          // Ignore: closing an already-closed socket.
        }
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new T3ClientError('send_failed', 'T3 Code did not confirm the command in time.')),
        timeoutMs,
      );

      try {
        socket = new WebSocket(url);
      } catch {
        return finish(new T3ClientError('send_failed', 'Could not open a WebSocket to T3 Code.'));
      }

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            _tag: 'Request',
            id: requestId,
            tag: 'orchestration.dispatchCommand',
            payload,
            headers: [],
          }),
        );
      };

      socket.onmessage = (event) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const tag = message._tag;
        if (tag === 'Chunk') {
          // Unary commands should not stream; acknowledge so the server window advances.
          socket.send(JSON.stringify({_tag: 'Ack', requestId}));
          return;
        }
        if (tag === 'Exit') {
          const exit = message.exit as {_tag?: string; cause?: unknown} | undefined;
          if (exit?._tag === 'Success') return finish();
          return finish(new T3ClientError('send_failed', describeRpcFailure(exit)));
        }
        if (tag === 'Defect') {
          return finish(new T3ClientError('send_failed', 'T3 Code failed to run that command.'));
        }
      };

      socket.onerror = () => finish(new T3ClientError('send_failed', 'The T3 Code socket failed.'));
      socket.onclose = () => finish(new T3ClientError('send_failed', 'T3 Code closed the socket before confirming.'));
    });
  }

  return {listAttention, getSource, sendMessage, answerQuestion};
}

function describeRpcFailure(exit: {cause?: unknown} | undefined): string {
  const causes = Array.isArray(exit?.cause) ? exit.cause : [];
  for (const reason of causes) {
    if (reason && typeof reason === 'object' && (reason as {_tag?: string})._tag === 'Fail') {
      const error = (reason as {error?: {message?: unknown}}).error;
      const message = error?.message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return `T3 Code rejected the command: ${message.slice(0, 300)}`;
      }
    }
  }
  return 'T3 Code rejected the command.';
}

/** Fallback used only when the WebSocket path fails. */
async function sendViaCli(
  threadId: string,
  text: string,
  cliPath: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    let settled = false;
    let child: ReturnType<typeof spawn>;
    const finish = (error?: T3ClientError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => {
        child?.kill('SIGTERM');
        finish(new T3ClientError('send_failed', 'The t3 CLI did not finish in time.'));
      },
      Math.max(timeoutMs, 30_000),
    );

    try {
      child = spawn(cliPath, ['thread', 'send', threadId, '-'], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
    } catch {
      return finish(new T3ClientError('send_failed', 'Could not start the t3 CLI.'));
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString('utf8');
    });
    child.on('error', () => finish(new T3ClientError('send_failed', 'Could not start the t3 CLI.')));
    child.on('close', (code) => {
      if (code === 0) return finish();
      if (code === 2) return finish(new T3ClientError('send_failed', 'The thread is waiting for an answer.'));
      finish(new T3ClientError('send_failed', 'The t3 CLI could not deliver the message.'));
    });
    child.stdin?.on('error', () => {
      // The CLI may exit before reading stdin; the close handler reports the failure.
    });
    child.stdin?.end(text);
  });
}

// Gmail integration: reads only the configured query (default: the demo
// label), replies in-thread and marks the original read. Plain fetch, OAuth
// token from GoogleAuth. Message bodies are never logged.

import {
  ConnectorError,
  clampCount,
  type AccessTokenProvider,
  type DraftConnector,
  type DraftMessage,
  type EmailThread,
  type MailConnector,
} from './types.js';
import { requestJson, type FetchLike } from './http.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
const DEFAULT_QUERY = 'label:pinpoint is:unread';
const DEFAULT_DRAFTS_QUERY = 'label:pinpoint';

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailPart[];
  };
}

interface GmailThread {
  id?: string;
  snippet?: string;
  messages?: GmailMessage[];
}

interface GmailThreadList {
  threads?: Array<{ id?: string; snippet?: string }>;
}

interface GmailDraft {
  id?: string;
  message?: GmailMessage;
}

interface GmailDraftList {
  drafts?: Array<{ id?: string; message?: { id?: string; threadId?: string } }>;
}

export interface GmailConnectorOptions {
  auth: AccessTokenProvider;
  /** GMAIL_QUERY: used when a caller passes an empty query. */
  query?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export class GmailConnector implements MailConnector, DraftConnector {
  private readonly auth: AccessTokenProvider;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly defaultQuery: string;

  constructor(options: GmailConnectorOptions) {
    this.auth = options.auth;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? GMAIL_BASE;
    this.defaultQuery = options.query?.trim() || DEFAULT_QUERY;
  }

  async listNeedsReply(opts: { query: string; max: number }): Promise<EmailThread[]> {
    const query = opts.query?.trim() || this.defaultQuery;
    const max = clampCount(opts.max, 1, 50, 5);
    const params = new URLSearchParams({ q: query, maxResults: String(max) });

    const list = await this.get<GmailThreadList>(`/users/me/threads?${params.toString()}`);
    const entries = Array.isArray(list?.threads) ? list.threads : [];
    const threads: EmailThread[] = [];

    for (const entry of entries) {
      if (!entry.id) continue;
      try {
        const full = await this.get<GmailThread>(
          `/users/me/threads/${encodeURIComponent(entry.id)}?format=full`,
        );
        const mapped = mapThread(full, entry.id);
        if (mapped) threads.push(mapped);
      } catch (error) {
        // One malformed thread must not hide the rest of the morning brief.
        if (threads.length === 0 && entries.length === 1) throw error;
      }
      if (threads.length >= max) break;
    }

    if (threads.length === 0 && entries.length > 0) {
      throw new ConnectorError('gmail', 'gmail returned threads but none could be read');
    }
    return threads;
  }

  async sendReply(input: {
    threadId: string;
    messageId: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<{ id: string; link: string }> {
    if (!input.threadId) throw new ConnectorError('gmail', 'reply has no thread id');
    const to = sanitizeHeader(input.to);
    if (!to || !to.includes('@')) throw new ConnectorError('gmail', 'reply has no valid recipient');
    const subject = sanitizeHeader(input.subject);
    const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject || '(no subject)'}`;

    const context = await this.replyContext(input.messageId);
    const rfcMessageId = context.messageId || `<${input.messageId}@mail.gmail.com>`;
    const references = context.references
      ? `${context.references} ${rfcMessageId}`.trim()
      : rfcMessageId;

    const raw = [
      `To: ${to}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${rfcMessageId}`,
      `References: ${references}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      normalizeNewlines(input.body),
    ].join('\r\n');

    const sent = await this.post<{ id?: string; threadId?: string }>('/users/me/messages/send', {
      raw: Buffer.from(raw, 'utf8').toString('base64url'),
      threadId: input.threadId,
    });

    if (!sent.id) throw new ConnectorError('gmail', 'gmail send returned no message id');

    // The reply is already delivered at this point. A failed "mark read" must
    // not make the caller retry and send a duplicate, so it is best-effort.
    try {
      await this.post(`/users/me/messages/${encodeURIComponent(input.messageId)}/modify`, {
        removeLabelIds: ['UNREAD'],
      });
    } catch {
      // Keep the successful send; the owned thread is simply still unread.
    }

    return { id: sent.id, link: threadLink(input.threadId) };
  }

  // --- Gmail drafts: review an agent-authored draft, never compose one ----

  async listDrafts(opts: { query: string; max: number }): Promise<DraftMessage[]> {
    const query = opts.query?.trim() || DEFAULT_DRAFTS_QUERY;
    const max = clampCount(opts.max, 1, 20, 10);
    const params = new URLSearchParams({ q: query, maxResults: String(max) });
    const list = await this.get<GmailDraftList>(`/users/me/drafts?${params.toString()}`);
    const entries = Array.isArray(list?.drafts) ? list.drafts : [];
    const drafts: DraftMessage[] = [];
    for (const entry of entries) {
      if (!entry.id) continue;
      try {
        drafts.push(await this.getDraft(entry.id));
      } catch (error) {
        // One unreadable draft must not hide the others.
        if (entries.length === 1) throw error;
      }
      if (drafts.length >= max) break;
    }
    return drafts;
  }

  async getDraft(draftId: string): Promise<DraftMessage> {
    if (!draftId) throw new ConnectorError('gmail', 'draft has no id');
    const draft = await this.get<GmailDraft>(
      `/users/me/drafts/${encodeURIComponent(draftId)}?format=full`,
    );
    const mapped = mapDraft(draft, draftId);
    if (!mapped) throw new ConnectorError('gmail', 'gmail draft could not be read');
    return mapped;
  }

  async updateDraft(draftId: string, body: string): Promise<{ id: string; link: string }> {
    if (!draftId) throw new ConnectorError('gmail', 'draft has no id');
    const current = await this.getDraft(draftId);
    const raw = buildDraftRaw(current, body);
    const saved = await this.send<{ id?: string }>(
      `/users/me/drafts/${encodeURIComponent(draftId)}`,
      { message: { raw: Buffer.from(raw, 'utf8').toString('base64url'), threadId: current.threadId } },
      'PUT',
    );
    return { id: saved?.id ?? draftId, link: draftLink(draftId) };
  }

  async sendDraft(draftId: string): Promise<{ id: string; threadId: string; link: string }> {
    if (!draftId) throw new ConnectorError('gmail', 'draft has no id');
    const sent = await this.post<{ id?: string; threadId?: string }>('/users/me/drafts/send', {
      id: draftId,
    });
    if (!sent?.id) throw new ConnectorError('gmail', 'gmail send returned no message id');
    const threadId = sent.threadId ?? (await this.getDraft(draftId).catch(() => null))?.threadId ?? '';
    return {
      id: sent.id,
      threadId,
      link: threadId ? threadLink(threadId) : draftLink(draftId),
    };
  }

  private async replyContext(
    messageId: string,
  ): Promise<{ messageId: string; references: string }> {
    try {
      const meta = await this.get<GmailMessage>(
        `/users/me/messages/${encodeURIComponent(messageId)}` +
          '?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References',
      );
      const headers = headerMap(meta?.payload?.headers);
      const rfc = angleBrackets(headers['message-id'] ?? '');
      const refs = (headers['references'] ?? '')
        .split(/\s+/)
        .map((part) => angleBrackets(part))
        .filter(Boolean)
        .join(' ');
      return { messageId: rfc, references: refs };
    } catch {
      // Threading still works through threadId; headers are a nicety.
      return { messageId: '', references: '' };
    }
  }

  private async get<T>(path: string): Promise<T> {
    return (await this.request<T>(path)) as T;
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return (await this.request<T>(path, body)) as T;
  }

  private async send<T = unknown>(
    path: string,
    body: unknown,
    method: 'POST' | 'PUT',
  ): Promise<T> {
    return (await this.request<T>(path, body, method)) as T;
  }

  private async request<T>(
    path: string,
    body?: unknown,
    method?: 'POST' | 'PUT',
  ): Promise<T | null> {
    const token = await this.auth.accessToken();
    return (await requestJson(this.fetchImpl, `${this.baseUrl}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { authorization: `Bearer ${token}` },
      body,
      label: 'gmail',
    })) as T | null;
  }
}

function threadLink(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

function draftLink(draftId: string): string {
  return `https://mail.google.com/mail/u/0/#drafts/${encodeURIComponent(draftId)}`;
}

function firstName(raw: string): string {
  const { name, email } = parseAddress(raw);
  const base = name && name !== email ? name : email;
  const clean = base.includes('@') ? base.split('@')[0]!.split('+')[0]!.replace(/[._-]+/g, ' ').trim() : base;
  const first = clean.split(/[\s,]+/).filter(Boolean)[0] ?? '';
  if (first.length === 0) return 'them';
  return `${first[0]!.toUpperCase()}${first.slice(1)}`;
}

function mapDraft(draft: GmailDraft, fallbackId: string): DraftMessage | null {
  const message = draft.message;
  if (!message) return null;
  const headers = headerMap(message.payload?.headers);
  const threadId = message.threadId ?? '';
  const receivedMs = Number(message.internalDate);
  const updatedAt =
    Number.isFinite(receivedMs) && receivedMs > 0
      ? new Date(receivedMs).toISOString()
      : new Date(headers.date ? Date.parse(headers.date) : Date.now()).toISOString();
  return {
    id: draft.id ?? fallbackId,
    messageId: message.id ?? '',
    threadId,
    to: headers.to ?? '',
    toName: firstName(headers.to ?? ''),
    ...(headers.cc ? { cc: headers.cc } : {}),
    ...(headers.bcc ? { bcc: headers.bcc } : {}),
    subject: headers.subject ?? '(no subject)',
    body: extractBody(message.payload),
    updatedAt: Number.isNaN(Date.parse(updatedAt)) ? new Date().toISOString() : updatedAt,
    link: draftLink(draft.id ?? fallbackId),
  };
}

/** Rebuild a plain-text draft with the same recipient, subject and thread. */
function buildDraftRaw(draft: DraftMessage, body: string): string {
  const lines = [`To: ${sanitizeHeader(draft.to)}`];
  if (draft.cc) lines.push(`Cc: ${sanitizeHeader(draft.cc)}`);
  if (draft.bcc) lines.push(`Bcc: ${sanitizeHeader(draft.bcc)}`);
  lines.push(
    `Subject: ${sanitizeHeader(draft.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizeNewlines(body),
  );
  return lines.join('\r\n');
}

function sanitizeHeader(value: string): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function normalizeNewlines(value: string): string {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
}

function angleBrackets(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  return `<${trimmed.replace(/[<>]/g, '')}>`;
}

function headerMap(headers: GmailHeader[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (typeof header.name !== 'string' || typeof header.value !== 'string') continue;
    map[header.name.toLowerCase()] = header.value;
  }
  return map;
}

function mapThread(thread: GmailThread, fallbackThreadId: string): EmailThread | null {
  const messages = thread.messages ?? [];
  if (messages.length === 0) return null;
  const latest = messages[messages.length - 1];
  const headers = headerMap(latest.payload?.headers);
  const from = parseAddress(headers.from ?? '');
  const receivedMs = Number(latest.internalDate);
  const parsed = Number.isFinite(receivedMs) && receivedMs > 0
    ? new Date(receivedMs)
    : new Date(headers.date ? Date.parse(headers.date) : Date.now());
  const receivedAt = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();

  return {
    threadId: thread.id ?? latest.threadId ?? fallbackThreadId,
    messageId: latest.id ?? '',
    from,
    to: headers.to ?? '',
    subject: headers.subject ?? '(no subject)',
    snippet: decodeEntities(latest.snippet ?? thread.snippet ?? '').trim(),
    body: stripQuotedHistory(extractBody(latest.payload)),
    receivedAt,
    link: threadLink(thread.id ?? fallbackThreadId),
  };
}

function parseAddress(value: string): { name: string; email: string } {
  const trimmed = value.trim();
  const match = /^(.*?)<([^>]+)>\s*$/.exec(trimmed);
  if (match) {
    const name = match[1].trim().replace(/^"(.*)"$/s, '$1').trim();
    const email = match[2].trim();
    return { name: name || email, email };
  }
  const email = trimmed.replace(/^"(.*)"$/s, '$1').trim();
  return { name: email, email };
}

function extractBody(payload: GmailMessage['payload']): string {
  if (!payload) return '';
  const plain: string[] = [];
  const html: string[] = [];
  collectParts(payload, plain, html);
  if (plain.length > 0) return plain.join('\n').trim();
  if (html.length > 0) return htmlToText(html.join('\n')).trim();
  return '';
}

function collectParts(part: GmailPart, plain: string[], html: string[]): void {
  const data = part.body?.data;
  if (typeof data === 'string' && data.length > 0) {
    if (part.mimeType === 'text/plain') plain.push(decodeBase64(data));
    else if (part.mimeType === 'text/html') html.push(decodeBase64(data));
  }
  for (const child of part.parts ?? []) collectParts(child, plain, html);
}

function decodeBase64(data: string): string {
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Remove the quoted previous conversation from a mail body. Keeps the reply
 * itself, drops "On ... wrote:" / "-----Original Message-----" tails and
 * leading ">" lines.
 */
export function stripQuotedHistory(text: string): string {
  let output = normalizeLf(text);
  const cutPatterns = [
    /^On .{4,400} wrote:\s*$/m,
    /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^From: .+\r?\nSent: .+/im,
    /^_{10,}\s*$/m,
  ];
  let cut = output.length;
  for (const pattern of cutPatterns) {
    const match = pattern.exec(output);
    if (match && match.index >= 0 && match.index < cut) cut = match.index;
  }
  output = output.slice(0, cut);
  output = output
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
  return output.replace(/\n{3,}/g, '\n\n').trim();
}

function htmlToText(html: string): string {
  const withoutHead = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  return decodeEntities(
    withoutHead
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

function normalizeLf(text: string): string {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : '';
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

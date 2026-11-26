import { describe, expect, it } from 'vitest';
import { GmailConnector, stripQuotedHistory } from '../src/connectors/gmail.js';
import type { AccessTokenProvider } from '../src/connectors/types.js';

const auth: AccessTokenProvider = { accessToken: async () => 'test-token' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

describe('GmailConnector.listNeedsReply', () => {
  it('reads the latest message, decodes text/plain and strips quoted history', async () => {
    const calls: string[] = [];
    const body = [
      'Hi,',
      '',
      'Can you narrow clause 12 and confirm net-45?',
      '',
      'On Tue, Nov 25, 2026 at 9:12 AM Priya Shah <priya@example.com> wrote:',
      '> Old quoted text that must not reach the glasses.',
    ].join('\n');

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/users/me/threads?')) {
        return jsonResponse({ threads: [{ id: 't1', snippet: 'fallback snippet' }] });
      }
      if (url.includes('/users/me/threads/t1')) {
        return jsonResponse({
          id: 't1',
          messages: [
            {
              id: 'm0',
              internalDate: String(Date.parse('2026-11-25T08:00:00.000Z')),
              payload: {
                headers: [
                  { name: 'From', value: 'Priya Shah <priya@example.com>' },
                  { name: 'Subject', value: 'Older message' },
                ],
                mimeType: 'text/plain',
                body: { data: base64url('older') },
              },
            },
            {
              id: 'm1',
              threadId: 't1',
              internalDate: String(Date.parse('2026-11-26T08:00:00.000Z')),
              snippet: 'Can you narrow clause 12 &amp; confirm net-45?',
              payload: {
                headers: [
                  { name: 'From', value: '"Priya Shah" <priya+acme@example.com>' },
                  { name: 'To', value: 'owner@example.com' },
                  { name: 'Subject', value: 'Acme contract terms' },
                  { name: 'Date', value: 'Thu, 26 Nov 2026 09:00:00 +0100' },
                ],
                mimeType: 'multipart/alternative',
                parts: [
                  { mimeType: 'text/plain', body: { data: base64url(body) } },
                  { mimeType: 'text/html', body: { data: base64url('<p>html copy</p>') } },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const gmail = new GmailConnector({ auth, fetchImpl });
    const threads = await gmail.listNeedsReply({ query: 'label:pinpoint is:unread', max: 5 });

    expect(threads).toHaveLength(1);
    const thread = threads[0];
    expect(thread.threadId).toBe('t1');
    expect(thread.messageId).toBe('m1');
    expect(thread.from).toEqual({ name: 'Priya Shah', email: 'priya+acme@example.com' });
    expect(thread.to).toBe('owner@example.com');
    expect(thread.subject).toBe('Acme contract terms');
    expect(thread.snippet).toBe('Can you narrow clause 12 & confirm net-45?');
    expect(thread.receivedAt).toBe('2026-11-26T08:00:00.000Z');
    expect(thread.link).toBe('https://mail.google.com/mail/u/0/#all/t1');
    expect(thread.body).toContain('confirm net-45');
    expect(thread.body).not.toContain('Old quoted text');
    expect(thread.body).not.toContain('html copy');
    expect(calls[0]).toContain('q=label%3Apinpoint+is%3Aunread');
    expect(calls[0]).toContain('maxResults=5');
  });

  it('uses GMAIL_QUERY when the caller passes an empty query', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return jsonResponse({ threads: [] });
    }) as unknown as typeof fetch;

    const gmail = new GmailConnector({
      auth,
      fetchImpl,
      query: 'label:pinpoint is:unread',
    });
    await gmail.listNeedsReply({ query: '', max: 3 });
    expect(calls[0]).toContain('q=label%3Apinpoint+is%3Aunread');
    expect(calls[0]).toContain('maxResults=3');
  });
});

describe('GmailConnector.sendReply', () => {
  it('sends an RFC 2822 reply in the thread and marks the original read', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/messages/m1?format=metadata')) {
        return jsonResponse({
          payload: {
            headers: [
              { name: 'Message-ID', value: '<abc123@mail.gmail.com>' },
              { name: 'References', value: '<root@mail.gmail.com>' },
            ],
          },
        });
      }
      if (url.endsWith('/users/me/messages/send')) {
        return jsonResponse({ id: 'sent-1', threadId: 't1' });
      }
      if (url.includes('/messages/m1/modify')) {
        return jsonResponse({ id: 'm1' });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const gmail = new GmailConnector({ auth, fetchImpl });
    const result = await gmail.sendReply({
      threadId: 't1',
      messageId: 'm1',
      to: 'priya+acme@example.com',
      subject: 'Acme contract terms',
      body: 'Thanks, narrowing clause 12 today.\n- Ken',
    });

    expect(result.id).toBe('sent-1');
    expect(result.link).toBe('https://mail.google.com/mail/u/0/#all/t1');

    const sendCall = calls.find((call) => call.url.endsWith('/users/me/messages/send'));
    expect(sendCall).toBeDefined();
    const payload = JSON.parse(String(sendCall!.init?.body)) as {
      raw: string;
      threadId: string;
    };
    expect(payload.threadId).toBe('t1');
    const raw = Buffer.from(payload.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: priya+acme@example.com');
    expect(raw).toContain('Subject: Re: Acme contract terms');
    expect(raw).toContain('In-Reply-To: <abc123@mail.gmail.com>');
    expect(raw).toContain('References: <root@mail.gmail.com> <abc123@mail.gmail.com>');
    expect(raw).toContain('Thanks, narrowing clause 12 today.');

    const modifyCall = calls.find((call) => call.url.includes('/messages/m1/modify'));
    expect(modifyCall).toBeDefined();
    expect(JSON.parse(String(modifyCall!.init?.body))).toEqual({
      removeLabelIds: ['UNREAD'],
    });
  });

  it('does not let a failed mark-read turn a delivered reply into an error', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/messages/send')) return jsonResponse({ id: 'sent-2', threadId: 't2' });
      if (url.includes('/messages/m2?')) return jsonResponse({}, 500);
      if (url.includes('/messages/m2/modify')) return jsonResponse({}, 403);
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const gmail = new GmailConnector({ auth, fetchImpl });
    const result = await gmail.sendReply({
      threadId: 't2',
      messageId: 'm2',
      to: 'person@example.com',
      subject: 'Re: hello',
      body: 'ok',
    });
    expect(result.id).toBe('sent-2');
  });
});

describe('quoted history', () => {
  it('cuts the standard Gmail quote block and keeps the reply', () => {
    const text = 'Yes, works for me.\n\nOn Wed, 26 Nov 2026 at 10:00, Tomas wrote:\n> hello';
    expect(stripQuotedHistory(text)).toBe('Yes, works for me.');
  });

  it('cuts an Outlook original-message block', () => {
    const text = 'Confirmed.\n\n-----Original Message-----\nFrom: someone\nSent: today';
    expect(stripQuotedHistory(text)).toBe('Confirmed.');
  });
});

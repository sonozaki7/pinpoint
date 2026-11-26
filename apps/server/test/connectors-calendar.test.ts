import { describe, expect, it } from 'vitest';
import { GoogleCalendarConnector } from '../src/connectors/calendar.js';
import type { AccessTokenProvider } from '../src/connectors/types.js';

const auth: AccessTokenProvider = { accessToken: async () => 'test-token' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const eventPayload = {
  items: [
    {
      id: 'e1',
      summary: 'Focus block',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=e1',
      start: { dateTime: '2026-12-01T10:00:00Z' },
      end: { dateTime: '2026-12-01T12:00:00Z' },
      attendees: [{ email: 'ken@example.com' }, {}],
    },
    {
      id: 'e2',
      summary: 'Overlap',
      start: { dateTime: '2026-12-01T11:00:00Z' },
      end: { dateTime: '2026-12-01T13:00:00Z' },
    },
    {
      id: 'gone',
      status: 'cancelled',
      summary: 'Cancelled',
      start: { dateTime: '2026-12-01T09:00:00Z' },
      end: { dateTime: '2026-12-01T09:30:00Z' },
    },
  ],
};

describe('GoogleCalendarConnector', () => {
  it('resolves the Pinpoint demo calendar by summary and lists events', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/users/me/calendarList')) {
        return jsonResponse({
          items: [
            { id: 'primary', summary: 'Primary', primary: true },
            { id: 'demo-id', summary: 'Pinpoint demo' },
          ],
        });
      }
      if (url.includes('/calendars/demo-id/events?')) return jsonResponse(eventPayload);
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const calendar = new GoogleCalendarConnector({ auth, fetchImpl });
    const events = await calendar.listEvents({
      from: '2026-12-01T00:00:00Z',
      to: '2026-12-02T00:00:00Z',
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      calendarId: 'demo-id',
      eventId: 'e1',
      title: 'Focus block',
      start: '2026-12-01T10:00:00Z',
      end: '2026-12-01T12:00:00Z',
      attendees: ['ken@example.com'],
      link: 'https://calendar.google.com/calendar/event?eid=e1',
    });
    expect(events[1].title).toBe('Overlap');
    expect(calls.some((url) => url.includes('/calendars/demo-id/events?'))).toBe(true);
    expect(calls.some((url) => url.includes('singleEvents=true'))).toBe(true);
    expect(calls.some((url) => url.includes('orderBy=startTime'))).toBe(true);
  });

  it('derives merged busy intervals from event times', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/users/me/calendarList')) {
        return jsonResponse({ items: [{ id: 'demo-id', summary: 'Pinpoint demo' }] });
      }
      if (url.includes('/calendars/demo-id/events?')) return jsonResponse(eventPayload);
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const calendar = new GoogleCalendarConnector({ auth, fetchImpl });
    const busy = await calendar.freeBusy({
      from: '2026-12-01T00:00:00Z',
      to: '2026-12-02T00:00:00Z',
    });

    expect(busy).toEqual([{ start: '2026-12-01T10:00:00.000Z', end: '2026-12-01T13:00:00.000Z' }]);
  });

  it('patches a move and keeps the original duration when no end is given', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.endsWith('/calendars/demo-id/events/e1') && method === 'GET') {
        return jsonResponse({
          id: 'e1',
          summary: 'Dentist',
          htmlLink: 'https://calendar.google.com/calendar/event?eid=e1',
          start: { dateTime: '2026-12-02T08:30:00+01:00', timeZone: 'Europe/Amsterdam' },
          end: { dateTime: '2026-12-02T09:30:00+01:00', timeZone: 'Europe/Amsterdam' },
        });
      }
      if (url.endsWith('/calendars/demo-id/events/e1') && method === 'PATCH') {
        return jsonResponse({
          id: 'e1',
          htmlLink: 'https://calendar.google.com/calendar/event?eid=e1',
        });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const calendar = new GoogleCalendarConnector({ auth, fetchImpl });
    const result = await calendar.moveEvent({
      calendarId: 'demo-id',
      eventId: 'e1',
      start: '2026-12-02T10:00:00+01:00',
      end: '',
    });

    expect(result.link).toBe('https://calendar.google.com/calendar/event?eid=e1');
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch).toBeDefined();
    const body = patch!.body as {
      start: { dateTime: string; timeZone?: string };
      end: { dateTime: string; timeZone?: string };
    };
    expect(body.start.dateTime).toBe('2026-12-02T10:00:00+01:00');
    expect(Date.parse(body.end.dateTime) - Date.parse(body.start.dateTime)).toBe(60 * 60_000);
    expect(body.start.timeZone).toBe('Europe/Amsterdam');
    expect(body.end.timeZone).toBe('Europe/Amsterdam');
  });

  it('honours an explicit new end (still keeping the caller duration)', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.endsWith('/calendars/demo-id/events/e2') && method === 'GET') {
        return jsonResponse({
          id: 'e2',
          start: { dateTime: '2026-12-02T09:00:00Z' },
          end: { dateTime: '2026-12-02T09:30:00Z' },
        });
      }
      if (url.endsWith('/calendars/demo-id/events/e2') && method === 'PATCH') {
        return jsonResponse({ htmlLink: 'https://calendar.google.com/calendar/event?eid=e2' });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const calendar = new GoogleCalendarConnector({ auth, fetchImpl });
    await calendar.moveEvent({
      calendarId: 'demo-id',
      eventId: 'e2',
      start: '2026-12-02T11:00:00Z',
      end: '2026-12-02T13:00:00Z',
    });
    const patch = calls.find((call) => call.method === 'PATCH');
    const body = patch!.body as { start: { dateTime: string }; end: { dateTime: string } };
    expect(Date.parse(body.end.dateTime) - Date.parse(body.start.dateTime)).toBe(2 * 60 * 60_000);
  });

  it('falls back to the configured id when calendarList is forbidden', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/users/me/calendarList')) return jsonResponse({}, 403);
      if (url.includes('/calendars/my-calendar/events?')) return jsonResponse({ items: [] });
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const calendar = new GoogleCalendarConnector({
      auth,
      fetchImpl,
      calendar: 'my-calendar',
    });
    const events = await calendar.listEvents({
      from: '2026-12-01T00:00:00Z',
      to: '2026-12-02T00:00:00Z',
    });
    expect(events).toEqual([]);
    expect(calls.some((url) => url.includes('/calendars/my-calendar/events?'))).toBe(true);
  });
});

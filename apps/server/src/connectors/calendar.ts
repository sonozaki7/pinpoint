// Google Calendar integration. Uses calendar.events for listing and moving
// events. freeBusy() is derived from events.list because the dedicated
// freebusy endpoint needs a broader scope (calendar.freebusy / calendar.readonly)
// than Pinpoint asks for. Moving keeps the original duration unless the caller
// supplies an explicit end.

import {
  ConnectorError,
  type AccessTokenProvider,
  type CalEvent,
  type CalendarConnector,
} from './types.js';
import { requestJson, type FetchLike } from './http.js';

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const DEMO_CALENDAR_SUMMARY = 'pinpoint demo';

interface CalendarListEntry {
  id?: string;
  summary?: string;
}

interface CalendarListResponse {
  items?: CalendarListEntry[];
  nextPageToken?: string;
}

interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  attendees?: Array<{ email?: string }>;
}

interface EventsResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

export interface GoogleCalendarConnectorOptions {
  auth: AccessTokenProvider;
  /** GCAL_CALENDAR: a calendar id or summary. Empty = find "Pinpoint demo", else primary. */
  calendar?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export class GoogleCalendarConnector implements CalendarConnector {
  private readonly auth: AccessTokenProvider;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly configuredCalendar: string;
  private resolvedCalendar: Promise<string> | undefined;

  constructor(options: GoogleCalendarConnectorOptions) {
    this.auth = options.auth;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? CALENDAR_BASE;
    this.configuredCalendar = (options.calendar ?? '').trim();
  }

  async listEvents(opts: { from: string; to: string }): Promise<CalEvent[]> {
    assertRange(opts.from, opts.to);
    const calendarId = await this.resolveCalendarId();
    const events: CalEvent[] = [];
    let pageToken: string | undefined;
    let page = 0;

    do {
      const params = new URLSearchParams({
        timeMin: opts.from,
        timeMax: opts.to,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        showDeleted: 'false',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const payload = await this.get<EventsResponse>(
        `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      );
      for (const event of payload?.items ?? []) {
        const mapped = mapEvent(calendarId, event);
        if (mapped) events.push(mapped);
      }
      pageToken = payload?.nextPageToken;
      page += 1;
    } while (pageToken && page < 5);

    return events;
  }

  async freeBusy(opts: { from: string; to: string }): Promise<Array<{ start: string; end: string }>> {
    const events = await this.listEvents(opts);
    const intervals = events
      .map((event) => ({ start: Date.parse(event.start), end: Date.parse(event.end) }))
      .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end))
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start);

    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of intervals) {
      const previous = merged[merged.length - 1];
      if (previous && interval.start <= previous.end) {
        previous.end = Math.max(previous.end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    }
    return merged.map((interval) => ({
      start: new Date(interval.start).toISOString(),
      end: new Date(interval.end).toISOString(),
    }));
  }

  async moveEvent(input: {
    calendarId: string;
    eventId: string;
    start: string;
    end: string;
  }): Promise<{ link: string }> {
    if (!input.calendarId) throw new ConnectorError('calendar', 'move has no calendar id');
    if (!input.eventId) throw new ConnectorError('calendar', 'move has no event id');
    const startMs = Date.parse(input.start);
    if (!Number.isFinite(startMs)) {
      throw new ConnectorError('calendar', 'move start is not a valid date/time');
    }

    const current = (await this.get<GoogleEvent>(
      `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    )) ?? {};
    const currentStart = Date.parse(current.start?.dateTime ?? current.start?.date ?? '');
    const currentEnd = Date.parse(current.end?.dateTime ?? current.end?.date ?? '');
    const existingDuration =
      Number.isFinite(currentStart) && Number.isFinite(currentEnd) && currentEnd > currentStart
        ? currentEnd - currentStart
        : 30 * 60_000;

    const requestedEnd = Date.parse(input.end);
    const endMs =
      Number.isFinite(requestedEnd) && requestedEnd > startMs
        ? requestedEnd
        : startMs + existingDuration;

    const timeZone = current.start?.timeZone ?? current.end?.timeZone;
    const start: Record<string, string> = { dateTime: input.start };
    const end: Record<string, string> = { dateTime: new Date(endMs).toISOString() };
    if (timeZone) {
      start.timeZone = timeZone;
      end.timeZone = timeZone;
    }

    const updated = (await this.patch<GoogleEvent>(
      `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      { start, end },
    )) ?? {};
    return { link: updated.htmlLink ?? '' };
  }

  /** Resolve GCAL_CALENDAR, else the demo calendar by summary, else primary. */
  private resolveCalendarId(): Promise<string> {
    if (!this.resolvedCalendar) {
      this.resolvedCalendar = this.findCalendar().catch(() => {
        // calendarList may be forbidden with the least-privilege scope. Fall
        // back to a configured id or the primary calendar instead of failing.
        return this.configuredCalendar || 'primary';
      });
    }
    return this.resolvedCalendar;
  }

  private async findCalendar(): Promise<string> {
    let entries: CalendarListEntry[] = [];
    let pageToken: string | undefined;
    let page = 0;
    try {
      do {
        const params = new URLSearchParams({ maxResults: '250' });
        if (pageToken) params.set('pageToken', pageToken);
        const list = await this.get<CalendarListResponse>(`/users/me/calendarList?${params.toString()}`);
        entries = entries.concat(list.items ?? []);
        pageToken = list.nextPageToken;
        page += 1;
      } while (pageToken && page < 3);
    } catch (error) {
      if (this.configuredCalendar) return this.configuredCalendar;
      throw error;
    }

    if (this.configuredCalendar) {
      const wanted = this.configuredCalendar.toLowerCase();
      const match = entries.find(
        (entry) =>
          entry.id === this.configuredCalendar || (entry.summary ?? '').toLowerCase() === wanted,
      );
      return match?.id ?? this.configuredCalendar;
    }

    const demo = entries.find(
      (entry) => (entry.summary ?? '').trim().toLowerCase() === DEMO_CALENDAR_SUMMARY,
    );
    return demo?.id ?? 'primary';
  }

  private async get<T>(path: string): Promise<T> {
    return (await this.request<T>(path)) as T;
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return (await this.request<T>(path, body)) as T;
  }

  private async request<T>(path: string, body?: unknown): Promise<T | null> {
    const token = await this.auth.accessToken();
    return (await requestJson(this.fetchImpl, `${this.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body,
      label: 'calendar',
    })) as T | null;
  }
}

function assertRange(from: string, to: string): void {
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) {
    throw new ConnectorError('calendar', 'calendar range must be two ISO date/times');
  }
  if (Date.parse(to) <= Date.parse(from)) {
    throw new ConnectorError('calendar', 'calendar range end must be after start');
  }
}

function mapEvent(calendarId: string, event: GoogleEvent): CalEvent | null {
  if (!event.id || event.status === 'cancelled') return null;
  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (!start || !end) return null;
  return {
    calendarId,
    eventId: event.id,
    title: event.summary ?? '(no title)',
    start,
    end,
    attendees: (event.attendees ?? [])
      .map((attendee) => attendee.email)
      .filter((email): email is string => typeof email === 'string' && email.length > 0),
    link: event.htmlLink ?? '',
  };
}

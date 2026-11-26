// In-memory, deterministic connectors for the demo and tests. No node: imports
// on purpose: this module runs in any JS environment, and a browser simulator
// can drive it to show what a send/move/create actually did.
//
// Demo story:
//  - Priya Shah asks about Acme net-45 terms and clause 12.
//  - Tomas Berg proposes a podcast Tuesday 10:00, when the calendar is busy.
//  - "1:1 with Ken" Wednesday 09:00 clashes with "Dentist" 08:30-09:30.
//  - A note records the Acme terms.

import type {
  CalEvent,
  CalendarConnector,
  Connectors,
  EmailThread,
  LlmConnector,
  MailConnector,
  NoteHit,
  NotesConnector,
} from './types.js';

export interface FakeSentReply {
  threadId: string;
  messageId: string;
  to: string;
  subject: string;
  body: string;
  id: string;
  link: string;
}

export interface FakeMovedEvent {
  calendarId: string;
  eventId: string;
  start: string;
  end: string;
  link: string;
}

export interface FakeCreatedTask {
  title: string;
  due?: string;
  details?: string;
  sourceUrl?: string;
  id: string;
  url: string;
}

export interface FakeLlmCall {
  system: string;
  user: string;
  json: boolean;
}

export interface FakeEffects {
  sentReplies: FakeSentReply[];
  movedEvents: FakeMovedEvent[];
  createdTasks: FakeCreatedTask[];
}

export interface FakeConnectors extends Connectors {
  readonly effects: FakeEffects;
  /** Threads that still need a reply (a sent reply removes one). */
  readonly threads: EmailThread[];
  readonly events: CalEvent[];
  readonly noteHits: NoteHit[];
  readonly tasks: FakeCreatedTask[];
  readonly llmCalls: FakeLlmCall[];
  reset(): void;
}

export interface FakeConnectorOptions {
  /** ISO instant anchoring the demo week. Defaults to Fri 2026-11-27 08:00 UTC. */
  now?: string;
  /** Changes generated ids, so parallel demos/tests do not collide. */
  seed?: number;
}

const DEFAULT_NOW = '2026-11-27T08:00:00.000Z';
const DEMO_CALENDAR = 'pinpoint-demo';
const OWNER = 'owner@pinpoint.example';

export function createFakeConnectors(
  seed?: number | string | FakeConnectorOptions,
): FakeConnectors {
  const options: FakeConnectorOptions =
    typeof seed === 'number'
      ? { seed }
      : typeof seed === 'string'
        ? { now: seed }
        : seed ?? {};
  const anchor = parseDate(options.now) ?? new Date(DEFAULT_NOW);
  const prefix = options.seed === undefined ? '' : `s${options.seed}-`;

  const tuesday = nextWeekday(anchor, 2);
  const wednesday = addDays(tuesday, 1);
  const at = (day: string, hour: number, minute: number): string =>
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

  const initialEvents: CalEvent[] = [
    {
      calendarId: DEMO_CALENDAR,
      eventId: 'evt-focus',
      title: 'Deep work block',
      start: at(tuesday, 10, 0),
      end: at(tuesday, 12, 0),
      attendees: [],
      link: eventLink('evt-focus'),
    },
    {
      calendarId: DEMO_CALENDAR,
      eventId: 'evt-dentist',
      title: 'Dentist',
      start: at(wednesday, 8, 30),
      end: at(wednesday, 9, 30),
      attendees: [],
      link: eventLink('evt-dentist'),
    },
    {
      calendarId: DEMO_CALENDAR,
      eventId: 'evt-ken',
      title: '1:1 with Ken',
      start: at(wednesday, 9, 0),
      end: at(wednesday, 9, 30),
      attendees: ['ken@pinpoint.example'],
      link: eventLink('evt-ken'),
    },
  ];

  const initialThreads: EmailThread[] = [
    {
      threadId: 'fth-priya',
      messageId: 'fmsg-priya',
      from: { name: 'Priya Shah', email: 'priya.shah@acme.example' },
      to: OWNER,
      subject: 'Re: Acme contract - net-45 terms',
      snippet: 'We agreed net-45 on the Acme contract; clause 12 is still too broad.',
      body:
        'Hi,\n\n' +
        'Thanks for the call on Nov 12. We agreed net-45 on the Acme contract, but ' +
        'clause 12 is still too broad. Can you narrow it to the reseller scope and ' +
        'send the revised draft before Friday?\n\n' +
        'Best,\nPriya',
      receivedAt: new Date(anchor.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      link: threadLink('fth-priya'),
    },
    {
      threadId: 'fth-tomas',
      messageId: 'fmsg-tomas',
      from: { name: 'Tomas Berg', email: 'tomas.berg@podcast.example' },
      to: OWNER,
      subject: 'Podcast recording - Tuesday 10:00?',
      snippet: 'Tuesday 10:00 works for me for the podcast recording. Shall we lock it in?',
      body:
        'Hey!\n\n' +
        'Tuesday 10:00 works for me for the podcast recording. Shall we lock it in? ' +
        'I can bring the mic and the outline.\n\n' +
        'Tomas',
      receivedAt: new Date(anchor.getTime() - 45 * 60 * 1000).toISOString(),
      link: threadLink('fth-tomas'),
    },
  ];

  const initialNotes: NoteHit[] = [
    {
      id: 'note-acme',
      title: 'Acme contract',
      text: 'Acme contract: net-45 agreed with Priya on Nov 12; clause 12 to be narrowed',
      url: 'https://www.notion.so/fake-acme-note',
    },
  ];

  const effects: FakeEffects = {
    sentReplies: [],
    movedEvents: [],
    createdTasks: [],
  };
  const threads: EmailThread[] = clone(initialThreads);
  const events: CalEvent[] = clone(initialEvents);
  const noteHits: NoteHit[] = clone(initialNotes);
  const tasks: FakeCreatedTask[] = [];
  const llmCalls: FakeLlmCall[] = [];
  let sentCount = 0;
  let taskCount = 0;

  const mail: MailConnector = {
    async listNeedsReply(opts) {
      const max = normalizeMax(opts.max, 5);
      const query = String(opts.query ?? '').toLowerCase();
      const terms = query
        .split(/\s+/)
        .map((term) => term.replace(/^[^\w@.]+|[^\w@.]+$/g, ''))
        .filter((term) => term.length > 2 && !/^(label|is|in|from|to|subject):/i.test(term));
      const matching = threads.filter((thread) => {
        if (terms.length === 0) return true;
        const haystack = `${thread.subject} ${thread.snippet} ${thread.body} ${thread.from.name} ${thread.from.email}`.toLowerCase();
        return terms.some((term) => haystack.includes(term));
      });
      return clone(matching.slice(0, max));
    },

    async sendReply(input) {
      sentCount += 1;
      const thread =
        threads.find((entry) => entry.threadId === input.threadId) ??
        initialThreads.find((entry) => entry.threadId === input.threadId);
      const id = `${prefix}sent-${sentCount}`;
      const link = threadLink(input.threadId || thread?.threadId || 'unknown');
      effects.sentReplies.push({
        threadId: input.threadId,
        messageId: input.messageId,
        to: input.to,
        subject: input.subject,
        body: input.body,
        id,
        link,
      });
      const index = threads.findIndex((entry) => entry.threadId === input.threadId);
      if (index >= 0) threads.splice(index, 1);
      return { id, link };
    },
  };

  const calendar: CalendarConnector = {
    async listEvents(opts) {
      const from = Date.parse(opts.from);
      const to = Date.parse(opts.to);
      return clone(
        events.filter((event) => {
          const start = Date.parse(event.start);
          const end = Date.parse(event.end);
          return (
            Number.isFinite(from) &&
            Number.isFinite(to) &&
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            start < to &&
            end > from
          );
        }),
      );
    },

    async freeBusy(opts) {
      const listed = await calendar.listEvents(opts);
      return mergeBusy(listed);
    },

    async moveEvent(input) {
      const event = events.find(
        (entry) =>
          entry.eventId === input.eventId &&
          (!input.calendarId || entry.calendarId === input.calendarId),
      );
      if (!event) throw new Error('fake calendar event not found');

      const startMs = Date.parse(input.start);
      if (!Number.isFinite(startMs)) throw new Error('fake calendar move has an invalid start');
      const originalDuration = Date.parse(event.end) - Date.parse(event.start);
      const requestedEnd = Date.parse(input.end);
      const endMs =
        Number.isFinite(requestedEnd) && requestedEnd > startMs
          ? requestedEnd
          : startMs + (Number.isFinite(originalDuration) && originalDuration > 0
              ? originalDuration
              : 30 * 60_000);

      event.start = new Date(startMs).toISOString();
      event.end = new Date(endMs).toISOString();
      const link = event.link || eventLink(event.eventId);
      effects.movedEvents.push({
        calendarId: input.calendarId,
        eventId: input.eventId,
        start: event.start,
        end: event.end,
        link,
      });
      return { link };
    },
  };

  const notes: NotesConnector = {
    async search(query, max) {
      const limit = normalizeMax(max, 5);
      const terms = String(query ?? '')
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.replace(/^[^\w]+|[^\w]+$/g, ''))
        .filter((term) => term.length > 0);
      const matching = noteHits.filter((note) => {
        if (terms.length === 0) return true;
        const haystack = `${note.title} ${note.text}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
      return clone(matching.slice(0, limit));
    },

    async createTask(input) {
      taskCount += 1;
      const id = `${prefix}task-${taskCount}`;
      const task: FakeCreatedTask = {
        title: input.title,
        ...(input.due ? { due: input.due } : {}),
        ...(input.details ? { details: input.details } : {}),
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        id,
        url: `https://www.notion.so/fake-task-${taskCount}`,
      };
      tasks.push(task);
      effects.createdTasks.push({ ...task });
      return { id: task.id, url: task.url };
    },
  };

  const llm: LlmConnector = {
    name: 'fake',
    async complete(input) {
      llmCalls.push({ system: input.system, user: input.user, json: input.json === true });
      const firstLine = String(input.user ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? '';
      const shortened = firstLine.slice(0, 120);
      if (input.json) return JSON.stringify({ text: shortened });
      return shortened ? `Draft: ${shortened}` : 'Draft ready.';
    },
  };

  return {
    mail,
    calendar,
    notes,
    llm,
    effects,
    threads,
    events,
    noteHits,
    tasks,
    llmCalls,
    reset() {
      threads.splice(0, threads.length, ...clone(initialThreads));
      events.splice(0, events.length, ...clone(initialEvents));
      noteHits.splice(0, noteHits.length, ...clone(initialNotes));
      tasks.splice(0, tasks.length);
      llmCalls.splice(0, llmCalls.length);
      effects.sentReplies.splice(0, effects.sentReplies.length);
      effects.movedEvents.splice(0, effects.movedEvents.length);
      effects.createdTasks.splice(0, effects.createdTasks.length);
      sentCount = 0;
      taskCount = 0;
    },
  };
}

/** Stable demo names exported for docs/tests. */
export const FAKE_DEMO = {
  calendarId: DEMO_CALENDAR,
  threads: { priya: 'fth-priya', tomas: 'fth-tomas' },
  events: { focus: 'evt-focus', dentist: 'evt-dentist', ken: 'evt-ken' },
  noteId: 'note-acme',
} as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeMax(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(20, Math.max(1, Math.trunc(value)));
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nextWeekday(from: Date, weekday: number): string {
  const date = new Date(from.getTime());
  date.setUTCHours(0, 0, 0, 0);
  let add = (weekday - date.getUTCDay() + 7) % 7;
  if (add === 0) add = 7;
  date.setUTCDate(date.getUTCDate() + add);
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function threadLink(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

function eventLink(eventId: string): string {
  return `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eventId)}`;
}

function mergeBusy(events: CalEvent[]): Array<{ start: string; end: string }> {
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

import { describe, expect, it } from 'vitest';
import { createFakeConnectors, FAKE_DEMO } from '../src/connectors/fake.js';

const NOW = '2026-11-27T08:00:00.000Z';

describe('fake connectors', () => {
  it('provides the deterministic morning-brief story', async () => {
    const fake = createFakeConnectors(NOW);
    const threads = await fake.mail!.listNeedsReply({
      query: 'label:pinpoint is:unread',
      max: 10,
    });

    expect(threads.map((thread) => thread.threadId)).toEqual([
      FAKE_DEMO.threads.priya,
      FAKE_DEMO.threads.tomas,
    ]);
    expect(threads[0].from.name).toBe('Priya Shah');
    expect(threads[0].body).toContain('net-45');
    expect(threads[0].body).toContain('clause 12');
    expect(threads[1].from.name).toBe('Tomas Berg');
    expect(threads[1].subject).toContain('Tuesday 10:00');

    const events = await fake.calendar!.listEvents({
      from: '2026-12-01T00:00:00Z',
      to: '2026-12-03T00:00:00Z',
    });
    expect(events.map((event) => event.title)).toEqual([
      'Deep work block',
      'Dentist',
      '1:1 with Ken',
    ]);
    const busy = await fake.calendar!.freeBusy({
      from: '2026-12-01T00:00:00Z',
      to: '2026-12-03T00:00:00Z',
    });
    expect(busy).toContainEqual({
      start: '2026-12-01T10:00:00.000Z',
      end: '2026-12-01T12:00:00.000Z',
    });
    expect(busy).toContainEqual({
      start: '2026-12-02T08:30:00.000Z',
      end: '2026-12-02T09:30:00.000Z',
    });

    const notes = await fake.notes!.search('acme net-45', 5);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain('clause 12 to be narrowed');
  });

  it('records a reply, removes the thread from what needs a reply, and links it', async () => {
    const fake = createFakeConnectors({ now: NOW, seed: 7 });
    const result = await fake.mail!.sendReply({
      threadId: FAKE_DEMO.threads.priya,
      messageId: 'fmsg-priya',
      to: 'priya.shah@acme.example',
      subject: 'Acme contract - net-45 and clause 12',
      body: 'Narrowing clause 12 today.',
    });

    expect(result.id).toBe('s7-sent-1');
    expect(result.link).toBe(`https://mail.google.com/mail/u/0/#all/${FAKE_DEMO.threads.priya}`);
    expect(fake.effects.sentReplies).toHaveLength(1);
    expect(fake.effects.sentReplies[0].body).toBe('Narrowing clause 12 today.');
    const remaining = await fake.mail!.listNeedsReply({ query: '', max: 10 });
    expect(remaining.map((thread) => thread.threadId)).not.toContain(FAKE_DEMO.threads.priya);
  });

  it('moves an event, keeping its duration when no end is supplied, and records it', async () => {
    const fake = createFakeConnectors(NOW);
    const result = await fake.calendar!.moveEvent({
      calendarId: FAKE_DEMO.calendarId,
      eventId: FAKE_DEMO.events.ken,
      start: '2026-12-02T10:00:00.000Z',
      end: '',
    });

    const ken = fake.events.find((event) => event.eventId === FAKE_DEMO.events.ken)!;
    expect(ken.start).toBe('2026-12-02T10:00:00.000Z');
    expect(ken.end).toBe('2026-12-02T10:30:00.000Z');
    expect(result.link).toContain(FAKE_DEMO.events.ken);
    expect(fake.effects.movedEvents).toEqual([
      {
        calendarId: FAKE_DEMO.calendarId,
        eventId: FAKE_DEMO.events.ken,
        start: '2026-12-02T10:00:00.000Z',
        end: '2026-12-02T10:30:00.000Z',
        link: result.link,
      },
    ]);
  });

  it('records created tasks and lets the fake LLM answer deterministically', async () => {
    const fake = createFakeConnectors(NOW);
    const task = await fake.notes!.createTask({
      title: 'Send revised Acme draft',
      due: '2026-12-04',
      details: 'Narrow clause 12',
      sourceUrl: 'https://mail.google.com/mail/u/0/#all/fth-priya',
    });
    expect(task.id).toBe('task-1');
    expect(fake.tasks).toHaveLength(1);
    expect(fake.effects.createdTasks[0].due).toBe('2026-12-04');

    const text = await fake.llm!.complete({ system: 'Be brief', user: 'Draft a reply' });
    expect(text).toBe('Draft: Draft a reply');
    expect(await fake.llm!.complete({ system: 'JSON', user: 'Point', json: true })).toBe(
      '{"text":"Point"}',
    );
    expect(fake.llmCalls).toHaveLength(2);
  });

  it('is deterministic and resettable', async () => {
    const first = createFakeConnectors(NOW);
    const second = createFakeConnectors(NOW);
    expect(await first.mail!.listNeedsReply({ query: '', max: 10 })).toEqual(
      await second.mail!.listNeedsReply({ query: '', max: 10 }),
    );
    expect(first.events).toEqual(second.events);

    await first.mail!.sendReply({
      threadId: FAKE_DEMO.threads.tomas,
      messageId: 'fmsg-tomas',
      to: 'tomas.berg@podcast.example',
      subject: 'Podcast',
      body: 'Works.',
    });
    await first.notes!.createTask({ title: 'One' });
    first.reset();
    expect(first.effects.sentReplies).toHaveLength(0);
    expect(first.effects.createdTasks).toHaveLength(0);
    expect(first.tasks).toHaveLength(0);
    expect(await first.mail!.listNeedsReply({ query: '', max: 10 })).toHaveLength(2);
  });
});

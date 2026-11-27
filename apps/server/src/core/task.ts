import { createHash } from 'node:crypto';
import type { Deck, Point } from '../../../../shared/contract.js';
import { clipText, makeGlance, oneLine, stripInlineMarkdown, toAscii } from './text.js';
import type { AttentionSource, AttentionThread } from './types.js';

/** A spoken hand-off: "Find a dentist open Saturday for the kids". */

export const MAX_TASK_CHARS = 600;
export const MAX_TASK_TITLE = 30;

/** One-line request text, or undefined when there is nothing to hand off. */
export function normalizeTaskText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = oneLine(raw).slice(0, MAX_TASK_CHARS).trim();
  return text.length >= 3 ? text : undefined;
}

const LEAD_FILLER =
  /^(?:(?:ok(?:ay)?|hey|so|please|could you|can you|would you|i need you to|i want you to|i'd like you to|go and)\s+)+/i;

/** A short plain-ASCII title for the new agent thread, at most 30 chars. */
export function taskTitle(text: string): string {
  const clean = oneLine(toAscii(stripInlineMarkdown(text)))
    .replace(LEAD_FILLER, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  const first = clean.split(/[.!?;:]\s/)[0] ?? clean;
  const titled = first.length > 0 ? `${first[0]!.toUpperCase()}${first.slice(1)}` : 'New task';
  return clipText(titled, MAX_TASK_TITLE).replace(/[\s,;:-]+$/g, '') || 'New task';
}

export function isAppointmentRequest(text: string): boolean {
  return /\b(?:dentist|dental|doctor|clinic|hair(?:cut|dresser)?|barber|appointment|pediatrician|vet)\b/i.test(
    text,
  );
}

export interface SampleTaskResult {
  thread: AttentionThread;
  source: AttentionSource;
  deck: Deck;
}

const SAMPLE_PROJECT = 'Sample';

function point(index: number, base: Omit<Point, 'id' | 'index'>): Point {
  return { id: `p${index}`, index, ...base };
}

/**
 * What the Pinpoint Cloud sample "agent" comes back with. Nothing is booked or
 * researched; every item says so. An appointment request becomes a question
 * with options, anything else a short plan.
 */
export function buildSampleTaskResult(
  text: string,
  options: { id: string; title: string; now?: Date },
): SampleTaskResult {
  const now = options.now ?? new Date();
  const digest = createHash('sha1').update(`${options.id}|${text}`).digest('hex').slice(0, 10);
  const sourceMessageId = `sample-task-${digest}`;

  if (isAppointmentRequest(text)) {
    const question = '3 dentists open Saturday: which one?';
    const choices = ['Sakura Dental, 9:00', 'Ueno Smile, 10:30', 'Midori Dental, 14:00'];
    const lines = [
      'Sample result: nothing was booked.',
      question,
      'Sakura Dental has a slot at 9:00.',
      'Ueno Smile has a slot at 10:30.',
      'Midori Dental has a slot at 14:00.',
    ];
    const body = lines.join('\n\n');
    const thread: AttentionThread = {
      threadId: options.id,
      title: options.title,
      project: SAMPLE_PROJECT,
      attention: 'question',
      updatedAt: now.toISOString(),
    };
    const source: AttentionSource = {
      sourceMessageId,
      kind: 'question',
      text: body,
      question: {
        requestId: `sample-req-${digest}`,
        questions: [{ id: 'q_pick', question, options: choices }],
      },
    };
    const deck: Deck = {
      threadId: thread.threadId,
      sourceMessageId,
      title: thread.title,
      attention: 'question',
      headline: makeGlance('Sample: pick a dentist', 44),
      points: [
        point(1, {
          kind: 'question',
          glance: question,
          quote: question,
          options: choices,
          questionId: 'q_pick',
          flag: 'your call',
          why: 'The agent needs one pick from you',
        }),
        point(2, { kind: 'claim', glance: 'Sakura Dental: 9:00', quote: lines[2]! }),
        point(3, { kind: 'claim', glance: 'Ueno Smile: 10:30', quote: lines[3]! }),
        point(4, { kind: 'claim', glance: 'Midori Dental: 14:00', quote: lines[4]! }),
        point(5, { kind: 'claim', glance: 'Sample result, nothing booked', quote: lines[0]! }),
      ],
      createdAt: now.toISOString(),
      splitter: 'sample-task',
    };
    return { thread, source, deck };
  }

  const request = clipText(toAscii(text), 90, '...');
  const lines = [
    'Sample plan: nothing was started.',
    `You asked: ${request}`,
    'Look up the options that fit.',
    'Compare price, time and distance.',
    'Pick the best two and explain why.',
    'Come back to you for the final choice.',
  ];
  const thread: AttentionThread = {
    threadId: options.id,
    title: options.title,
    project: SAMPLE_PROJECT,
    attention: 'plan',
    updatedAt: now.toISOString(),
  };
  const source: AttentionSource = {
    sourceMessageId,
    kind: 'plan',
    text: lines.map((line, index) => (index >= 2 ? `${index - 1}. ${line}` : line)).join('\n\n'),
  };
  const deck: Deck = {
    threadId: thread.threadId,
    sourceMessageId,
    title: thread.title,
    attention: 'plan',
    headline: makeGlance('Sample plan: 4 steps', 44),
    points: [
      point(1, { kind: 'step', glance: 'Look up the options that fit', quote: lines[2]! }),
      point(2, { kind: 'step', glance: 'Compare price, time, distance', quote: lines[3]! }),
      point(3, { kind: 'step', glance: 'Pick the best two, explain why', quote: lines[4]! }),
      point(4, {
        kind: 'step',
        glance: 'Come back for your final choice',
        quote: lines[5]!,
        flag: 'you decide',
        why: 'The plan ends with your final choice',
      }),
      point(5, { kind: 'claim', glance: 'Sample plan, nothing started', quote: lines[0]! }),
    ],
    createdAt: now.toISOString(),
    splitter: 'sample-task',
  };
  return { thread, source, deck };
}

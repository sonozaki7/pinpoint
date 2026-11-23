import { z } from 'zod';
import type { Deck, InboxItem, Note, ReviewDraft } from '../../../../shared/contract.js';

export const attentionSchema = z.enum(['question', 'plan', 'failed', 'report']);
export const pointKindSchema = z.enum(['step', 'claim', 'question', 'risk', 'draft']);

export const attentionThreadSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().min(1),
  project: z.string().min(1),
  attention: attentionSchema,
  updatedAt: z.string().min(1),
});

export const attentionSourceSchema = z.object({
  sourceMessageId: z.string().min(1),
  text: z.string(),
  kind: z.enum(['plan', 'reply', 'question']),
  question: z
    .object({
      requestId: z.string().min(1),
      questions: z.array(
        z.object({
          id: z.string().min(1),
          question: z.string(),
          options: z.array(z.string()),
        }),
      ),
    })
    .optional(),
});

export const noteSchema = z.object({
  pointId: z.string().min(1),
  verdict: z.enum(['object', 'note', 'answer']),
  text: z.string().max(4000).optional(),
  option: z.string().max(200).optional(),
  audioMs: z.number().finite().nonnegative().optional(),
});

export const reviewDraftSchema = z.object({
  threadId: z.string().min(1),
  sourceMessageId: z.string(),
  notes: z.array(noteSchema),
  seen: z.array(z.string()),
  updatedAt: z.string().min(1),
});

export const pointSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().positive(),
  kind: pointKindSchema,
  glance: z.string(),
  quote: z.string(),
  options: z.array(z.string()).optional(),
  questionId: z.string().optional(),
  risk: z.enum(['low', 'high']).optional(),
});

export const deckSchema = z.object({
  threadId: z.string().min(1),
  sourceMessageId: z.string().min(1),
  title: z.string().min(1),
  attention: attentionSchema,
  headline: z.string(),
  points: z.array(pointSchema),
  createdAt: z.string().min(1),
  splitter: z.string().min(1),
});

export const fixtureSchema = z.object({
  thread: attentionThreadSchema,
  source: attentionSourceSchema,
  deck: deckSchema.optional(),
});

export const draftInputSchema = z.object({
  sourceMessageId: z.string().optional(),
  notes: z.array(noteSchema).optional(),
  seen: z.array(z.string()).optional(),
});

export const rawPointSchema = z.object({
  kind: z.string().optional(),
  glance: z.string().optional(),
  quote: z.string().min(1),
  options: z.array(z.string()).optional(),
  questionId: z.string().optional(),
  risk: z.string().optional(),
});

export const splitterResponseSchema = z.object({
  headline: z.unknown().optional(),
  points: z.array(rawPointSchema),
});

export function asDeck(value: unknown): Deck | null {
  const parsed = deckSchema.safeParse(value);
  return parsed.success ? (parsed.data as Deck) : null;
}

export function asReviewDraft(value: unknown): ReviewDraft | null {
  const parsed = reviewDraftSchema.safeParse(value);
  return parsed.success ? (parsed.data as ReviewDraft) : null;
}

export function asInbox(value: unknown): InboxItem | null {
  const parsed = z
    .object({
      threadId: z.string(),
      title: z.string(),
      project: z.string(),
      attention: attentionSchema,
      summary: z.string(),
      updatedAt: z.string(),
      deckReady: z.boolean(),
      pointCount: z.number(),
      draftNotes: z.number(),
    })
    .safeParse(value);
  return parsed.success ? (parsed.data as InboxItem) : null;
}

export type NoteInput = Note;

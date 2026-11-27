import { z } from 'zod';
import type { Deck, InboxItem, Note, ReviewDraft } from '../../../../shared/contract.js';

export const attentionSchema = z.enum(['question', 'plan', 'failed', 'report']);
export const pointKindSchema = z.enum(['step', 'claim', 'question', 'risk', 'draft']);
export const appSchema = z.enum(['t3', 'notion', 'gmail', 'telegram', 'slack', 'discord']);

export const attentionThreadSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().min(1),
  project: z.string().min(1),
  attention: attentionSchema,
  updatedAt: z.string().min(1),
  app: appSchema.optional(),
});

export const sourceBlockSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
});

export const sourceEvidenceSchema = z.object({
  notes: z
    .array(
      z.object({
        title: z.string(),
        text: z.string(),
        url: z.string().optional(),
      }),
    )
    .optional(),
});

export const sourceTargetSchema = z.object({
  name: z.string().optional(),
  recipient: z.string().optional(),
  subject: z.string().optional(),
  link: z.string().optional(),
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
  app: appSchema.optional(),
  blocks: z.array(sourceBlockSchema).optional(),
  evidence: sourceEvidenceSchema.optional(),
  target: sourceTargetSchema.optional(),
});

export const noteSchema = z.object({
  pointId: z.string().min(1),
  verdict: z.enum(['object', 'note', 'answer']),
  text: z.string().max(4000).optional(),
  option: z.string().max(200).optional(),
  audioMs: z.number().finite().nonnegative().optional(),
  /**
   * The sentence after a spoken note was applied. Empty string means the
   * sentence was deleted; the send path uses that to drop it from the draft.
   */
  after: z.string().max(2000).optional(),
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
  flag: z.string().max(24).optional(),
  why: z.string().max(60).optional(),
  changed: z.boolean().optional(),
  threadRef: z.string().optional(),
  anchor: z.string().optional(),
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

export const editInputSchema = z.object({
  pointId: z.string().min(1),
  text: z.string().min(1).max(2000),
});

export const rawPointSchema = z.object({
  kind: z.string().optional(),
  glance: z.string().optional(),
  quote: z.string().min(1),
  options: z.array(z.string()).optional(),
  questionId: z.string().optional(),
  risk: z.string().optional(),
  flag: z.string().optional(),
  why: z.string().optional(),
  needsYou: z.boolean().optional(),
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
      app: appSchema.optional(),
      needsYou: z.number().optional(),
      changed: z.number().optional(),
      kind: z.enum(['review', 'catch-up']).optional(),
    })
    .safeParse(value);
  return parsed.success ? (parsed.data as InboxItem) : null;
}

export const taskInputSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
});

export const askInputSchema = z.object({
  question: z.string().trim().min(1).max(300),
});

export type NoteInput = Note;

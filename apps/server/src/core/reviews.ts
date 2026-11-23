import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Note, ReviewDraft } from '../../../../shared/contract.js';
import { asReviewDraft, noteSchema } from './schemas.js';
import { safeFileName } from './text.js';

/** `<threadId>.json` when the id is filesystem-safe; hash suffix otherwise. */
function fileNameFor(threadId: string): string {
  if (/^[A-Za-z0-9._-]{1,100}$/.test(threadId) && threadId !== '.' && threadId !== '..') {
    return `${threadId}.json`;
  }
  const hash = createHash('sha1').update(threadId).digest('hex').slice(0, 10);
  return `${safeFileName(threadId, 70)}-${hash}.json`;
}

/** One draft per thread on disk (SPEC §5: autosave notes and seen points). */
export class ReviewStore {
  private readonly dir: string;
  private readonly cache = new Map<string, ReviewDraft>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'reviews');
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (error) {
      console.warn(`[reviews] data folder unavailable: ${(error as Error).message}`);
    }
  }

  private file(threadId: string): string {
    return path.join(this.dir, fileNameFor(threadId));
  }

  async get(threadId: string): Promise<ReviewDraft | null> {
    const cached = this.cache.get(threadId);
    if (cached) return cloneDraft(cached);
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file(threadId), 'utf8'));
      const draft = asReviewDraft(raw);
      if (!draft) return null;
      this.cache.set(threadId, draft);
      return cloneDraft(draft);
    } catch {
      return null;
    }
  }

  async put(draft: ReviewDraft): Promise<ReviewDraft> {
    const clean = normalizeDraft(draft);
    this.cache.set(clean.threadId, clean);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const target = this.file(clean.threadId);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(clean, null, 2), 'utf8');
      await fs.promises.rename(tmp, target);
    } catch (error) {
      console.warn(`[reviews] could not save draft: ${(error as Error).message}`);
    }
    return clean;
  }

  async clear(threadId: string): Promise<void> {
    this.cache.delete(threadId);
    try {
      await fs.promises.rm(this.file(threadId), { force: true });
    } catch (error) {
      console.warn(`[reviews] could not clear draft: ${(error as Error).message}`);
    }
  }

  async noteCount(threadId: string): Promise<number> {
    const draft = await this.get(threadId);
    return draft?.notes.length ?? 0;
  }
}

export function emptyDraft(threadId: string, sourceMessageId = ''): ReviewDraft {
  return {
    threadId,
    sourceMessageId,
    notes: [],
    seen: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Merge an autosave body into the existing draft. Last note per point wins. */
export function mergeDraft(
  existing: ReviewDraft | null,
  threadId: string,
  input: {
    sourceMessageId?: string;
    notes?: Note[];
    seen?: string[];
  },
): ReviewDraft {
  const base = existing ?? emptyDraft(threadId, input.sourceMessageId ?? '');
  // PUT carries the whole draft from the glasses, so a provided note list
  // replaces the stored one (that is how "Clear notes" works). Omitting
  // `notes` keeps what is saved.
  const byPoint = new Map<string, Note>();
  if (input.notes === undefined) {
    for (const note of base.notes) byPoint.set(note.pointId, note);
  } else {
    for (const note of input.notes) {
      const parsed = noteSchema.safeParse(note);
      if (!parsed.success) continue;
      byPoint.set(parsed.data.pointId, parsed.data as Note);
    }
  }
  const seen = new Set<string>(base.seen);
  for (const pointId of input.seen ?? []) if (typeof pointId === 'string') seen.add(pointId);
  for (const pointId of byPoint.keys()) seen.add(pointId);
  return normalizeDraft({
    threadId,
    sourceMessageId: input.sourceMessageId ?? base.sourceMessageId,
    notes: [...byPoint.values()],
    seen: [...seen],
    updatedAt: new Date().toISOString(),
  });
}

export function normalizeDraft(draft: ReviewDraft): ReviewDraft {
  const byPoint = new Map<string, Note>();
  for (const note of draft.notes) {
    const parsed = noteSchema.safeParse(note);
    if (parsed.success) byPoint.set(parsed.data.pointId, parsed.data as Note);
  }
  const seen = [...new Set(draft.seen.filter((id) => typeof id === 'string' && id.length > 0))];
  for (const pointId of byPoint.keys()) if (!seen.includes(pointId)) seen.push(pointId);
  return {
    threadId: draft.threadId,
    sourceMessageId: draft.sourceMessageId,
    notes: [...byPoint.values()],
    seen,
    updatedAt: draft.updatedAt || new Date().toISOString(),
  };
}

function cloneDraft(draft: ReviewDraft): ReviewDraft {
  return {
    ...draft,
    notes: draft.notes.map((note) => ({ ...note })),
    seen: [...draft.seen],
  };
}

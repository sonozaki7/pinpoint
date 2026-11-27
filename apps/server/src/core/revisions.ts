import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Deck, Point } from '../../../../shared/contract.js';
import { CHANGED_WHY } from './evidence.js';
import { errorMessage } from './errors.js';

/**
 * "Changed since your review": keep the deck the user last reviewed for a
 * thread, then mark new or materially edited points on the next output.
 *
 * Similarity is a token Jaccard over normalized quotes. A step that keeps its
 * meaning ("Sign out every customer once.") stays quiet; a step whose text
 * really changed is flagged once with "changed since your review".
 */

const SIMILARITY_THRESHOLD = 0.6;

export interface ReviewedDeck {
  sourceMessageId: string;
  quotes: string[];
  reviewedAt: string;
}

interface RevisionFile {
  version: 1;
  threads: Record<string, ReviewedDeck>;
}

function quoteTokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  for (const match of lower.matchAll(/[a-z0-9]+/g)) {
    if (match[0].length > 1) out.add(match[0]);
  }
  return out;
}

/** Normalized quote similarity in [0, 1]. */
export function quoteSimilarity(a: string, b: string): number {
  const left = quoteTokens(a);
  const right = quoteTokens(b);
  if (left.size === 0 || right.size === 0) {
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  }
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

export function isChangedQuote(quote: string, previous: readonly string[]): boolean {
  return !previous.some((old) => quoteSimilarity(quote, old) >= SIMILARITY_THRESHOLD);
}

function withChanges(deck: Deck, previous: ReviewedDeck): Deck {
  if (deck.sourceMessageId === previous.sourceMessageId) return deck;
  let any = false;
  const points: Point[] = deck.points.map((point) => {
    if (!isChangedQuote(point.quote, previous.quotes)) {
      return point;
    }
    any = true;
    return {
      ...point,
      changed: true,
      why: point.why && point.why.length > 0 ? point.why : CHANGED_WHY,
    };
  });
  return any ? { ...deck, points } : deck;
}

export class RevisionTracker {
  private readonly file?: string;
  private readonly byThread = new Map<string, ReviewedDeck>();

  /** `dataDir` persists across restarts; omit it for the in-memory cloud sample. */
  constructor(dataDir?: string) {
    if (dataDir) {
      this.file = path.join(dataDir, 'revisions.json');
      this.load();
    }
  }

  private load(): void {
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<RevisionFile>;
      for (const [threadId, entry] of Object.entries(raw.threads ?? {})) {
        if (
          entry &&
          typeof entry.sourceMessageId === 'string' &&
          Array.isArray(entry.quotes) &&
          entry.quotes.every((quote) => typeof quote === 'string')
        ) {
          this.byThread.set(threadId, {
            sourceMessageId: entry.sourceMessageId,
            quotes: entry.quotes,
            reviewedAt:
              typeof entry.reviewedAt === 'string' ? entry.reviewedAt : new Date().toISOString(),
          });
        }
      }
    } catch {
      // No revision history yet, or an unreadable file: start clean.
    }
  }

  private save(): void {
    if (!this.file) return;
    const payload: RevisionFile = { version: 1, threads: {} };
    for (const [threadId, entry] of this.byThread) payload.threads[threadId] = entry;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.warn(`[revisions] could not save review history: ${errorMessage(error)}`);
    }
  }

  /** Mark new or changed points; a first review has nothing to compare against. */
  annotate(threadId: string, deck: Deck): Deck {
    const previous = this.byThread.get(threadId);
    if (!previous) return deck;
    return withChanges(deck, previous);
  }

  /** Remember the deck the user just reviewed and sent. */
  remember(deck: Deck): void {
    this.byThread.set(deck.threadId, {
      sourceMessageId: deck.sourceMessageId,
      quotes: deck.points.map((point) => point.quote),
      reviewedAt: new Date().toISOString(),
    });
    this.save();
  }

  reviewed(threadId: string): ReviewedDeck | undefined {
    return this.byThread.get(threadId);
  }

  clear(threadId?: string): void {
    if (threadId) this.byThread.delete(threadId);
    else this.byThread.clear();
    this.save();
  }
}

/** Remove "changed" once the revision has itself been reviewed. */
export function clearChanges(deck: Deck): Deck {
  return {
    ...deck,
    points: deck.points.map((point) => {
      if (!point.changed) return point;
      const next: Point = { ...point, changed: undefined };
      if (next.why === CHANGED_WHY) delete next.why;
      return next;
    }),
  };
}

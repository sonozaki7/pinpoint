import { HttpError } from '../core/errors.js';

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Fixed one-minute window per key. The window starts on the first request, so
 * a client can never get more than `limit` requests in any 60-second span that
 * begins with one of its own requests. Old buckets are pruned lazily and the
 * key map is capped so hostile IPs cannot grow memory without bound.
 */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs = 60_000, maxKeys = 50_000) {
    this.limit = Math.max(1, limit);
    this.windowMs = Math.max(1_000, windowMs);
    this.maxKeys = Math.max(100, maxKeys);
  }

  hit(key: string, now = Date.now()): RateLimitDecision {
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= this.windowMs) {
      this.buckets.delete(key);
      this.buckets.set(key, { start: now, count: 1 });
      this.trim();
      return { allowed: true };
    }
    if (bucket.count >= this.limit) {
      const remaining = bucket.start + this.windowMs - now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1_000)),
      };
    }
    bucket.count += 1;
    return { allowed: true };
  }

  private trim(): void {
    if (this.buckets.size <= this.maxKeys) return;
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= this.maxKeys) break;
      this.buckets.delete(key);
    }
  }
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

/**
 * At most `maxConcurrent` transcriptions run; the rest wait in FIFO order.
 *
 * A waiter that cannot get a slot within `maxWaitMs` gets a 503 with
 * Retry-After. The slot is handed directly from the finishing job to the next
 * waiter, so the active count never overshoots.
 */
export class TranscriptionQueue {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly maxConcurrent = 2,
    private readonly maxWaitMs = 20_000,
  ) {}

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await this.acquire();
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(
            new HttpError(
              503,
              'Voice transcription is busy, try again',
              'busy',
              { 'Retry-After': '5' },
            ),
          );
        }, this.maxWaitMs),
      };
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}

/**
 * A small LRU + idle-TTL map for per-device cloud state.
 *
 * The public server must be safe to leave running for a hackathon: every
 * device gets a private workspace, the oldest ones are dropped past the cap,
 * and devices that have not called in TTL_MS are treated as new on return.
 * Restarting the process clears everything by design.
 */
export interface DeviceStoreOptions<T> {
  maxDevices: number;
  ttlMs: number;
  create: () => T;
  dispose?: (value: T) => void;
  now?: () => number;
}

interface Entry<T> {
  value: T;
  lastSeen: number;
}

export class DeviceStore<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly maxDevices: number;
  private readonly ttlMs: number;
  private readonly create: () => T;
  private readonly dispose?: (value: T) => void;
  private readonly now: () => number;

  constructor(options: DeviceStoreOptions<T>) {
    this.maxDevices = Math.max(1, options.maxDevices);
    this.ttlMs = Math.max(1, options.ttlMs);
    this.create = options.create;
    this.dispose = options.dispose;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  /** True when a live (not expired) entry exists; does not refresh LRU order. */
  has(id: string): boolean {
    const entry = this.entries.get(id);
    return entry !== undefined && this.now() - entry.lastSeen <= this.ttlMs;
  }

  get(id: string): T {
    const now = this.now();
    const existing = this.entries.get(id);
    if (existing) {
      if (now - existing.lastSeen <= this.ttlMs) {
        // Refresh recency (Map keeps insertion order).
        existing.lastSeen = now;
        this.entries.delete(id);
        this.entries.set(id, existing);
        return existing.value;
      }
      this.remove(id);
    }

    const value = this.create();
    this.entries.set(id, { value, lastSeen: now });
    this.enforceCap();
    return value;
  }

  /** Drop every entry that has been idle longer than the TTL. Returns the count. */
  sweep(now = this.now()): number {
    let removed = 0;
    for (const [id, entry] of [...this.entries]) {
      if (now - entry.lastSeen > this.ttlMs) {
        this.remove(id);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    try {
      this.dispose?.(entry.value);
    } catch {
      // Disposal must never break an incoming request.
    }
  }

  private enforceCap(): void {
    while (this.entries.size > this.maxDevices) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }
}

import {
  PAIR_ATTEMPT_WINDOW_MS,
  PAIR_CODE_TTL_MS,
  PAIR_MAX_ATTEMPTS,
  formatPairCode,
  isDeviceToken,
  newDeviceToken,
  normalizePairCode,
  randomPairCode,
  sha256Hex,
} from '../relay/protocol.js';
import { FixedWindowRateLimiter } from './rateLimit.js';

export interface PairingStoreOptions {
  now?: () => number;
  maxAttempts?: number;
  attemptWindowMs?: number;
  maxCodes?: number;
  maxTokens?: number;
}

export interface CreatedPairCode {
  /** Formatted "K7Q4-2MXP", shown once to the user. */
  code: string;
  /** Compact "K7Q42MXP", used for hashing. */
  compact: string;
  expiresAt: number;
}

export interface PairToken {
  deviceId: string;
  deskId: string;
  createdAt: number;
}

export type PairFailureReason =
  | 'invalid_code'
  | 'unknown_desk'
  | 'rate_limited';

export type PairOutcome =
  | { ok: true; token: string; deskId: string }
  | {
      ok: false;
      reason: PairFailureReason;
      error: string;
      retryAfterSeconds?: number;
    };

interface CodeEntry {
  deskId: string;
  expiresAt: number;
}

interface TokenEntry extends PairToken {
  tokenHash: string;
}

/**
 * Pairing codes and device tokens, in memory only.
 *
 * Codes and tokens are stored as SHA-256 hashes: a memory dump or log never
 * hands out a working credential. A process restart wipes every pairing, which
 * is acceptable for the sample-workspace cloud (devices then see the sample
 * workspace until they pair again). Nothing here ever holds inbox content.
 */
export class PairingStore {
  private readonly codes = new Map<string, CodeEntry>();
  private readonly codeByDesk = new Map<string, string>();
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly tokensByDevice = new Map<string, Set<string>>();
  private readonly deviceAttempts: FixedWindowRateLimiter;
  private readonly ipAttempts: FixedWindowRateLimiter;
  private readonly now: () => number;
  private readonly maxCodes: number;
  private readonly maxTokens: number;

  constructor(options: PairingStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxCodes = Math.max(10, options.maxCodes ?? 5_000);
    this.maxTokens = Math.max(10, options.maxTokens ?? 20_000);
    const maxAttempts = Math.max(1, options.maxAttempts ?? PAIR_MAX_ATTEMPTS);
    const windowMs = Math.max(1_000, options.attemptWindowMs ?? PAIR_ATTEMPT_WINDOW_MS);
    this.deviceAttempts = new FixedWindowRateLimiter(maxAttempts, windowMs);
    this.ipAttempts = new FixedWindowRateLimiter(maxAttempts, windowMs);
  }

  get codeCount(): number {
    return this.codes.size;
  }

  get tokenCount(): number {
    return this.tokens.size;
  }

  /** One live code per desk: asking again invalidates the previous one. */
  createCode(deskId: string): CreatedPairCode {
    this.sweep();
    const previous = this.codeByDesk.get(deskId);
    if (previous) this.codes.delete(previous);

    let compact = randomPairCode();
    // ~39.6 bits is tiny, but a collision must never make one desk's code point at
    // another desk's hash entry.
    for (let attempt = 0; this.codes.has(sha256Hex(compact)) && attempt < 5; attempt += 1) {
      compact = randomPairCode();
    }
    const codeHash = sha256Hex(compact);
    const expiresAt = this.now() + PAIR_CODE_TTL_MS;
    this.codes.set(codeHash, { deskId, expiresAt });
    this.codeByDesk.set(deskId, codeHash);
    if (this.codes.size > this.maxCodes) {
      const oldest = this.codes.keys().next().value as string | undefined;
      if (oldest) this.codes.delete(oldest);
    }
    return { code: formatPairCode(compact)!, compact, expiresAt };
  }

  /**
   * Count an attempt, then redeem. Every POST /api/pair consumes one attempt for
   * both the device and the IP, whether the code was right or not.
   */
  redeem(input: {
    code: string | null | undefined;
    deviceId: string;
    ip: string;
    deskExists?: (deskId: string) => boolean;
  }): PairOutcome {
    const now = this.now();
    const deviceDecision = this.deviceAttempts.hit(`device:${input.deviceId}`, now);
    if (!deviceDecision.allowed) {
      return {
        ok: false,
        reason: 'rate_limited',
        error: 'Too many pairing attempts. Wait a few minutes and try again.',
        retryAfterSeconds: deviceDecision.retryAfterSeconds ?? 60,
      };
    }
    const ipDecision = this.ipAttempts.hit(`ip:${input.ip}`, now);
    if (!ipDecision.allowed) {
      return {
        ok: false,
        reason: 'rate_limited',
        error: 'Too many pairing attempts. Wait a few minutes and try again.',
        retryAfterSeconds: ipDecision.retryAfterSeconds ?? 60,
      };
    }

    const compact = normalizePairCode(input.code);
    if (!compact) {
      return {
        ok: false,
        reason: 'invalid_code',
        error: 'That code is wrong or has expired.',
      };
    }
    const codeHash = sha256Hex(compact);
    const entry = this.codes.get(codeHash);
    if (!entry) {
      return {
        ok: false,
        reason: 'invalid_code',
        error: 'That code is wrong or has expired.',
      };
    }
    if (entry.expiresAt <= now) {
      this.codes.delete(codeHash);
      if (this.codeByDesk.get(entry.deskId) === codeHash) {
        this.codeByDesk.delete(entry.deskId);
      }
      return {
        ok: false,
        reason: 'invalid_code',
        error: 'That code is wrong or has expired.',
      };
    }
    if (input.deskExists && !input.deskExists(entry.deskId)) {
      return {
        ok: false,
        reason: 'unknown_desk',
        error: 'That desk is no longer connected. Start Pinpoint on your computer and try again.',
      };
    }

    // Single use: remove before returning the token.
    this.codes.delete(codeHash);
    if (this.codeByDesk.get(entry.deskId) === codeHash) {
      this.codeByDesk.delete(entry.deskId);
    }

    this.revokeDevice(input.deviceId);
    const token = newDeviceToken();
    const tokenHash = sha256Hex(token);
    this.tokens.set(tokenHash, {
      tokenHash,
      deviceId: input.deviceId,
      deskId: entry.deskId,
      createdAt: now,
    });
    const bucket = this.tokensByDevice.get(input.deviceId) ?? new Set<string>();
    bucket.add(tokenHash);
    this.tokensByDevice.set(input.deviceId, bucket);
    if (this.tokens.size > this.maxTokens) this.evictOldestToken();
    return { ok: true, token, deskId: entry.deskId };
  }

  /** The pairing behind this device token, or null. Tokens never expire by time. */
  resolve(deviceId: string, token: string | null | undefined): PairToken | null {
    const value = token ?? '';
    if (!isDeviceToken(value)) return null;
    const entry = this.tokens.get(sha256Hex(value));
    if (!entry || entry.deviceId !== deviceId) return null;
    return { deviceId: entry.deviceId, deskId: entry.deskId, createdAt: entry.createdAt };
  }

  /** True when this desk still has a live code or at least one device token. */
  deskHasState(deskId: string): boolean {
    const codeHash = this.codeByDesk.get(deskId);
    if (codeHash && this.codes.has(codeHash)) return true;
    for (const entry of this.tokens.values()) {
      if (entry.deskId === deskId) return true;
    }
    return false;
  }

  /** Revoke every token for one device. Returns how many were removed. */
  revokeDevice(deviceId: string): number {
    const hashes = this.tokensByDevice.get(deviceId);
    if (!hashes) return 0;
    let removed = 0;
    for (const hash of hashes) {
      if (this.tokens.delete(hash)) removed += 1;
    }
    this.tokensByDevice.delete(deviceId);
    return removed;
  }

  /** Revoke every token and code for a desk (desk deleted or --unpair-all). */
  revokeDesk(deskId: string): number {
    let removed = 0;
    for (const [hash, entry] of [...this.tokens]) {
      if (entry.deskId !== deskId) continue;
      this.tokens.delete(hash);
      const bucket = this.tokensByDevice.get(entry.deviceId);
      bucket?.delete(hash);
      if (bucket && bucket.size === 0) this.tokensByDevice.delete(entry.deviceId);
      removed += 1;
    }
    const codeHash = this.codeByDesk.get(deskId);
    if (codeHash) this.codes.delete(codeHash);
    this.codeByDesk.delete(deskId);
    return removed;
  }

  /** Drop expired codes; called on create and redeem. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [hash, entry] of [...this.codes]) {
      if (entry.expiresAt <= now) {
        this.codes.delete(hash);
        if (this.codeByDesk.get(entry.deskId) === hash) {
          this.codeByDesk.delete(entry.deskId);
        }
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.codes.clear();
    this.codeByDesk.clear();
    this.tokens.clear();
    this.tokensByDevice.clear();
  }

  private evictOldestToken(): void {
    const oldest = this.tokens.keys().next().value as string | undefined;
    if (!oldest) return;
    const entry = this.tokens.get(oldest);
    this.tokens.delete(oldest);
    if (entry) {
      const bucket = this.tokensByDevice.get(entry.deviceId);
      bucket?.delete(oldest);
      if (bucket && bucket.size === 0) this.tokensByDevice.delete(entry.deviceId);
    }
  }
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Wire protocol between Pinpoint Cloud and a desk (the owner's computer).
 *
 * The cloud only forwards opaque HTTP request/response bytes: it never parses
 * the inbox, decks, reviews or voice. See docs/desk-pairing.md.
 */

/** A relayed request must be answered within this long (the glasses' deck timeout). */
export const RELAY_TIMEOUT_MS = 65_000;

/** Each relayed request and response body is capped at 2 MB, decoded. */
export const RELAY_MAX_BYTES = 2 * 1024 * 1024;

/** A pairing code lives for ten minutes and works once. */
export const PAIR_CODE_TTL_MS = 10 * 60_000;

/** Five attempts per device and per IP in this window. */
export const PAIR_MAX_ATTEMPTS = 5;
export const PAIR_ATTEMPT_WINDOW_MS = 10 * 60_000;

/** 32 random bytes, base64url-encoded for header transport. */
export const DEVICE_TOKEN_BYTES = 32;

/** Desk registration secrets are 32 random bytes, hex-encoded (64 chars). */
export const DESK_SECRET_BYTES = 32;
export const DESK_SECRET_MIN_LENGTH = 32;
export const DESK_SECRET_MAX_LENGTH = 256;

/**
 * Unambiguous pairing alphabet: no 0/O, 1/I/L. 31 symbols × 8 characters is
 * about 39.6 bits, and the attempt limits cap online guessing far below that.
 */
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIR_CODE_LENGTH = 8;

export interface RelayRequest {
  id: string;
  method: string;
  path: string;
  /** Raw query string without the leading "?". */
  query: string;
  contentType?: string;
  /** Opaque hash of the device id, so the desk can track "since you looked" per phone. */
  device?: string;
  bodyBase64: string;
}

export interface RelayResponse {
  id: string;
  status: number;
  contentType?: string;
  bodyBase64: string;
}

/** Cloud → desk. */
export type CloudToDesk =
  | { type: 'request'; request: RelayRequest }
  | { type: 'pair-code'; id: string; code: string; expiresAt: string }
  | { type: 'unpaired'; id: string; removed: number }
  | { type: 'error'; id?: string; error: string };

/** Desk → cloud. */
export type DeskToCloud =
  | { type: 'hello'; name: string }
  | { type: 'request-pair-code'; id: string }
  | { type: 'response'; response: RelayResponse }
  | { type: 'unpair-all'; id: string };

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Short stable id for logs. Never use it for authentication. */
export function shortHash(value: string): string {
  return sha256Hex(value).slice(0, 8);
}

export function newDeskSecret(): string {
  return randomBytes(DESK_SECRET_BYTES).toString('hex');
}

export function newDeviceToken(): string {
  return randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

export function newRequestId(): string {
  return randomUUID();
}

/** True for a plausible device token; the cloud still hashes and looks it up. */
export function isDeviceToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

/** A desk secret straight from the Authorization header; long and printable. */
export function isDeskSecret(value: string): boolean {
  return (
    value.length >= DESK_SECRET_MIN_LENGTH &&
    value.length <= DESK_SECRET_MAX_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

/** Rejection sampling keeps every symbol equally likely (256 % 31 ≠ 0). */
const RANDOM_LIMIT =
  Math.floor(256 / PAIR_CODE_ALPHABET.length) * PAIR_CODE_ALPHABET.length;

function randomSymbol(): string {
  for (;;) {
    const byte = randomBytes(1)[0]!;
    if (byte < RANDOM_LIMIT) return PAIR_CODE_ALPHABET[byte % PAIR_CODE_ALPHABET.length]!;
  }
}

/** Compact 8-character code, no dash. */
export function randomPairCode(): string {
  let code = '';
  for (let index = 0; index < PAIR_CODE_LENGTH; index += 1) {
    code += randomSymbol();
  }
  return code;
}

/**
 * Accept "K7Q4-2MXP", "k7q4 2mxp", "K7Q42MXP" and surrounding whitespace.
 * Returns the compact upper-case form, or null.
 */
export function normalizePairCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (compact.length !== PAIR_CODE_LENGTH) return null;
  for (const char of compact) {
    if (!PAIR_CODE_ALPHABET.includes(char)) return null;
  }
  return compact;
}

/** "K7Q42MXP" → "K7Q4-2MXP"; null when the input is not a valid code. */
export function formatPairCode(raw: string | null | undefined): string | null {
  const compact = normalizePairCode(raw);
  if (!compact) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/** Display name is user-facing only: trim, collapse whitespace, cap at 60. */
export function cleanDeskName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return 'Desk';
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : 'Desk';
}

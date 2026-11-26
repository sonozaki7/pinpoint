import { createHash } from 'node:crypto';

/**
 * UUID-shaped device ids. This is deliberately a little more permissive than
 * a version-4-only check: any UUID the Even app's WebView can generate is fine.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalised device id, or null when the header is missing/invalid. */
export function normalizeDeviceId(raw: string | undefined | null): string | null {
  const value = raw?.trim().toLowerCase() ?? '';
  return UUID_RE.test(value) ? value : null;
}

/** Stable 8-character id for request logs; never log the full device id. */
export function deviceHash(deviceId: string): string {
  return createHash('sha256').update(deviceId).digest('hex').slice(0, 8);
}

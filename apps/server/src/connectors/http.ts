// Small fetch wrapper shared by the connectors. It deliberately never puts a
// response body into an error: Mail bodies and Notion pages are private. Only
// the HTTP status and a short machine-readable error code are surfaced.

import { ConnectorError } from './types.js';

export type FetchLike = typeof fetch;

const SAFE_CODE = /^[a-z0-9_.:/-]{1,80}$/i;

/** Pick only a machine-readable error code from an API error body. */
export function safeErrorCode(text: string): string {
  if (!text) return '';
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['error', 'code']) {
      const value = payload[key];
      if (typeof value === 'string' && SAFE_CODE.test(value)) return value;
      if (value && typeof value === 'object') {
        const nested = (value as Record<string, unknown>).code;
        if (typeof nested === 'string' && SAFE_CODE.test(nested)) return nested;
      }
    }
  } catch {
    // Non-JSON error page: show nothing beyond the status.
  }
  return '';
}

export interface JsonRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Used in error messages, e.g. "gmail". Never contains secrets. */
  label: string;
}

/**
 * Perform one JSON request. Returns the parsed body (or null for an empty
 * successful response). Throws ConnectorError on network/HTTP/parse failures.
 */
export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  request: JsonRequest,
): Promise<unknown> {
  const headers: Record<string, string> = { ...request.headers };
  let body: string | undefined;
  if (request.body !== undefined) {
    headers['content-type'] ??= 'application/json';
    body = JSON.stringify(request.body);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: request.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body,
      signal: AbortSignal.timeout(request.timeoutMs ?? 20_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'network error';
    throw new ConnectorError(
      request.label,
      `${request.label} could not be reached (${name})`,
      { cause: error },
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new ConnectorError(request.label, `${request.label} reply could not be read`, {
      status: response.status,
      cause: error,
    });
  }

  if (!response.ok) {
    const code = safeErrorCode(text);
    throw new ConnectorError(
      request.label,
      `${request.label} returned HTTP ${response.status}${code ? ` (${code})` : ''}`,
      { status: response.status },
    );
  }

  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ConnectorError(request.label, `${request.label} returned a non-JSON reply`, {
      status: response.status,
      cause: error,
    });
  }
}

/** A short delay used by the retry helpers; injectable in tests. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Honour Retry-After seconds when small, otherwise use a default. */
export function retryDelayMs(response: Response | undefined, fallback: number): number {
  const raw = response?.headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number.parseFloat(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3_000, seconds * 1_000);
  }
  return fallback;
}

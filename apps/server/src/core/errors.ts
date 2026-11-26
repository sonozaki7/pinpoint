import { redactSecrets } from './redact.js';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra response headers, e.g. Retry-After on a rate limit. */
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    message: string,
    code = 'error',
    headers?: Record<string, string>,
  ) {
    super(redactSecrets(message));
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function errorMessage(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

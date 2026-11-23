import { HttpError } from '../core/errors.js';

/** PUT review autosaves are tiny; anything larger is a mistake or an attack. */
export const MAX_JSON_BYTES = 256 * 1024;

/**
 * Read a request body without ever holding more than `limit` bytes.
 *
 * `content-length` is checked first (a lie is still caught by the stream cap),
 * and the stream is cancelled as soon as it crosses the limit, so a chunked
 * upload cannot grow memory without bound.
 */
export async function readBodyCapped(
  request: Request,
  limit: number,
  message: string,
): Promise<Buffer> {
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, message, 'too_large');
  }
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, message, 'too_large');
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be cancelled or closed.
    }
  }
  return Buffer.concat(chunks, size);
}

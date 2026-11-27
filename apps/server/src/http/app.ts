import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HttpError, errorMessage } from '../core/errors.js';
import { askInputSchema, draftInputSchema, editInputSchema, taskInputSchema } from '../core/schemas.js';
import { LOCAL_DEVICE, type PinpointService } from '../core/service.js';
import { MAX_PCM_BYTES } from '../voice/wav.js';
import { MAX_JSON_BYTES, readBodyCapped } from './body.js';

export interface AppDeps {
  service: PinpointService;
}

/**
 * The Even Hub app runs inside the Even phone app's WebView. Hosted builds
 * are served from an evenrealities.com subdomain, covered by the pattern
 * below. Local simulator previews use 127.0.0.1 and must be listed in
 * PINPOINT_ALLOWED_ORIGINS. If your WebView reports an opaque "null" origin,
 * list `null` there as well.
 */
const EVEN_WEBVIEW_ORIGIN = /^https:\/\/(?:[a-z0-9-]+\.)*evenrealities\.com$/i;

function isAllowedLiveOrigin(origin: string, configured: readonly string[]): boolean {
  if (origin.length === 0) return false;
  if (configured.some((entry) => entry === origin)) return true;
  return EVEN_WEBVIEW_ORIGIN.test(origin);
}

async function readJson(request: Request): Promise<unknown> {
  let bytes: Buffer;
  try {
    bytes = await readBodyCapped(
      request,
      MAX_JSON_BYTES,
      'JSON body exceeds 256 KB',
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Could not read request body', 'bad_request');
  }
  const text = bytes.toString('utf8');
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON body', 'bad_request');
  }
}

/**
 * "Since you looked" is tracked per device. A direct client sends its own
 * X-Pinpoint-Device UUID; the cloud relay sends `relay-<hash>`; the desk's own
 * app sends nothing and shares one "local" device.
 */
function deviceFrom(request: Request): string {
  const raw = request.headers.get('x-pinpoint-device')?.trim().toLowerCase() ?? '';
  return /^[a-z0-9-]{8,64}$/.test(raw) ? raw : LOCAL_DEVICE;
}

export function createApp(deps: AppDeps): Hono {
  const { service } = deps;
  const app = new Hono();

  app.use(
    '*',
    cors({
      // Demo is a local, single-user showcase: every origin may call it.
      // Live never reflects an arbitrary origin; it echoes only the configured
      // glasses origins and Even's hosted WebView subdomains.
      origin: (origin) => {
        if (service.env.mode === 'demo') return '*';
        return isAllowedLiveOrigin(origin, service.env.allowedOrigins) ? origin : undefined;
      },
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Point-Id', 'X-Thread-Id', 'X-Pinpoint-Device'],
      maxAge: 86_400,
    }),
  );

  app.get('/', (c) =>
    c.json({ name: 'pinpoint-server', ok: true, docs: '/api/health' }),
  );

  app.get('/api/health', async (c) => c.json(await service.health()));

  app.get('/api/inbox', async (c) => {
    try {
      return c.json(await service.listInbox(deviceFrom(c.req.raw)));
    } catch (error) {
      throw new HttpError(502, `Could not load inbox: ${errorMessage(error)}`, 't3_error');
    }
  });

  app.get('/api/deck/:threadId', async (c) => {
    const lookup = await service.getDeckHttp(c.req.param('threadId'), deviceFrom(c.req.raw));
    if (lookup.status === 'missing') {
      throw new HttpError(404, 'Unknown thread', 'not_found');
    }
    if (lookup.status === 'pending') {
      return c.json({ pending: true }, 202);
    }
    return c.json(lookup.deck);
  });

  app.post('/api/ask/:threadId', async (c) => {
    const raw = await readJson(c.req.raw);
    const parsed = askInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(
        400,
        `Invalid question${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`,
        'bad_request',
      );
    }
    return c.json(
      await service.ask(c.req.param('threadId'), parsed.data.question, deviceFrom(c.req.raw)),
    );
  });

  app.post('/api/task', async (c) => {
    const raw = await readJson(c.req.raw);
    const parsed = taskInputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid task: text is required', 'bad_request');
    }
    const result = await service.task(parsed.data.text);
    return c.json(result, result.ok ? 200 : 502);
  });

  app.put('/api/review/:threadId', async (c) => {
    const raw = await readJson(c.req.raw);
    const parsed = draftInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(
        400,
        `Invalid review body${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`,
        'bad_request',
      );
    }
    return c.json(
      await service.putDraft(c.req.param('threadId'), parsed.data, deviceFrom(c.req.raw)),
    );
  });

  app.get('/api/review/:threadId', async (c) => {
    return c.json(await service.getDraft(c.req.param('threadId'), deviceFrom(c.req.raw)));
  });

  app.post('/api/edit/:threadId', async (c) => {
    const raw = await readJson(c.req.raw);
    const parsed = editInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(
        400,
        `Invalid edit body${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`,
        'bad_request',
      );
    }
    return c.json(
      await service.edit(c.req.param('threadId'), parsed.data.pointId, parsed.data.text),
    );
  });

  app.post('/api/review/:threadId/preview', async (c) => {
    return c.json(await service.preview(c.req.param('threadId'), deviceFrom(c.req.raw)));
  });

  app.post('/api/review/:threadId/send', async (c) => {
    const result = await service.send(c.req.param('threadId'), {
      deviceId: deviceFrom(c.req.raw),
    });
    return c.json(result, result.ok ? 200 : 502);
  });

  app.post('/api/voice', async (c) => {
    let bytes: Buffer;
    try {
      bytes = await readBodyCapped(
        c.req.raw,
        MAX_PCM_BYTES,
        'Audio exceeds 25 seconds',
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'Could not read audio body', 'bad_request');
    }
    if (bytes.length === 0) throw new HttpError(400, 'Empty audio body', 'bad_request');
    return c.json(
      await service.transcribe(bytes, {
        threadId: c.req.header('x-thread-id') || undefined,
        pointId: c.req.header('x-point-id') || undefined,
      }),
    );
  });

  app.post('/api/phone/:threadId/:pointId', async (c) => {
    return c.json(
      await service.phone(c.req.param('threadId'), c.req.param('pointId')),
    );
  });

  app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json(
        { error: error.message, code: error.code },
        error.status as ContentfulStatusCode,
      );
    }
    console.error(`[http] unhandled error: ${errorMessage(error)}`);
    return c.json({ error: 'Internal server error', code: 'internal' }, 500);
  });

  return app;
}

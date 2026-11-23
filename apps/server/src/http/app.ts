import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HttpError, errorMessage } from '../core/errors.js';
import { draftInputSchema } from '../core/schemas.js';
import type { PinpointService } from '../core/service.js';
import { MAX_PCM_BYTES } from '../voice/wav.js';

export interface AppDeps {
  service: PinpointService;
}

async function readJson(request: Request): Promise<unknown> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new HttpError(400, 'Could not read request body', 'bad_request');
  }
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON body', 'bad_request');
  }
}

export function createApp(deps: AppDeps): Hono {
  const { service } = deps;
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Point-Id', 'X-Thread-Id'],
      maxAge: 86_400,
    }),
  );

  app.get('/', (c) =>
    c.json({ name: 'pinpoint-server', ok: true, docs: '/api/health' }),
  );

  app.get('/api/health', async (c) => c.json(await service.health()));

  app.get('/api/inbox', async (c) => {
    try {
      return c.json(await service.listInbox());
    } catch (error) {
      throw new HttpError(502, `Could not load inbox: ${errorMessage(error)}`, 't3_error');
    }
  });

  app.get('/api/deck/:threadId', async (c) => {
    const lookup = await service.getDeckHttp(c.req.param('threadId'));
    if (lookup.status === 'missing') {
      throw new HttpError(404, 'Unknown thread', 'not_found');
    }
    if (lookup.status === 'pending') {
      return c.json({ pending: true }, 202);
    }
    return c.json(lookup.deck);
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
    return c.json(await service.putDraft(c.req.param('threadId'), parsed.data));
  });

  app.get('/api/review/:threadId', async (c) => {
    return c.json(await service.getDraft(c.req.param('threadId')));
  });

  app.post('/api/review/:threadId/preview', async (c) => {
    return c.json(await service.preview(c.req.param('threadId')));
  });

  app.post('/api/review/:threadId/send', async (c) => {
    const result = await service.send(c.req.param('threadId'));
    return c.json(result, result.ok ? 200 : 502);
  });

  app.post('/api/voice', async (c) => {
    const declared = Number.parseInt(c.req.header('content-length') ?? '', 10);
    if (Number.isFinite(declared) && declared > MAX_PCM_BYTES) {
      throw new HttpError(413, 'Audio exceeds 25 seconds', 'too_large');
    }
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length === 0) throw new HttpError(400, 'Empty audio body', 'bad_request');
    if (bytes.length > MAX_PCM_BYTES) {
      throw new HttpError(413, 'Audio exceeds 25 seconds', 'too_large');
    }
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
